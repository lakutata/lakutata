/**
 * Derived from joi 18.0.2 lib/ref.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert, clone, isArray, reach} from '../hoek/index.js'
import * as Common from './common.js'
import {Lazy, type LazyTemplate} from './lazy.js'
import type {MainstayLike, PathKey, Preferences, StateLike} from './model.js'

let Template: LazyTemplate | undefined

export type RefType = 'value' | 'global' | 'local'

export type RefAncestor = number | 'root'

export type RefAdjust = (value: unknown) => unknown

export interface RefPrefix {
    global?: string
    local?: string
    root?: string
}

/**
 * Options of Joi.ref()
 */
export interface RefOptions {
    adjust?: RefAdjust | null
    ancestor?: RefAncestor
    in?: boolean
    iterables?: boolean | null
    map?: [unknown, unknown][] | null
    prefix?: RefPrefix
    render?: boolean
    separator?: string | false
}

/**
 * Options of the Ref constructor (created references, clones and descriptions)
 */
interface RefSettings extends Omit<RefOptions, 'prefix' | 'map'> {
    map?: [unknown, unknown][] | Map<unknown, unknown> | null
    path: PathKey[]
    type?: RefType
    depth?: number
    key?: string | null
    root?: PathKey
    display?: string
}

export interface RefDescription {
    path: PathKey[]
    type?: RefType
    separator?: string | false
    ancestor?: RefAncestor
    map?: [unknown, unknown][]
    adjust?: RefAdjust
    iterables?: boolean
    render?: boolean
    in?: boolean
}

export interface ResolveOptions {
    in?: boolean
    shadow?: boolean
}

const defaults: { adjust: null, in: false, iterables: null, map: null, separator: string, type: RefType } = {
    adjust: null,
    in: false,
    iterables: null,
    map: null,
    separator: '.',
    type: 'value'
}

/**
 * A reference to another value (sibling key, ancestor, global context or local value)
 */
export class Ref {

    declare public adjust: RefAdjust | null

    declare public ancestor: RefAncestor | undefined

    declare public in: boolean

    declare public iterables: boolean | null

    declare public map: Map<unknown, unknown> | null

    declare public path: PathKey[]

    declare public render: boolean | undefined

    declare public separator: string | false

    declare public type: RefType

    declare public depth: number

    declare public key: string | null

    declare public root: PathKey

    declare public display: string

    constructor(options: RefSettings | Ref) {
        assert(typeof options === 'object', 'Invalid reference construction')
        Common.assertOptions(options, [
            //Copied
            'adjust', 'ancestor', 'in', 'iterables', 'map', 'path', 'render', 'separator', 'type',
            //Overridden
            'depth', 'key', 'root', 'display'
        ])
        assert([false, undefined].includes(options.separator as false | undefined) || typeof options.separator === 'string' && options.separator.length === 1, 'Invalid separator')
        assert(!options.adjust || typeof options.adjust === 'function', 'options.adjust must be a function')
        assert(!options.map || isArray(options.map), 'options.map must be an array')
        assert(!options.map || !options.adjust, 'Cannot set both map and adjust options')
        Object.assign(this, defaults, options)
        assert(this.type === 'value' || this.ancestor === undefined, 'Non-value references cannot reference ancestors')
        if (isArray(this.map)) this.map = new Map(this.map as [unknown, unknown][])
        this.depth = this.path.length
        this.key = this.path.length ? this.path.join(this.separator as string) : null
        this.root = this.path[0]
        this.updateDisplay()
    }

    public resolve(value: unknown, state: StateLike, prefs: Preferences, local: unknown, options: ResolveOptions = {}): unknown {
        assert(!this.in || options.in, 'Invalid in() reference usage')
        if (this.type === 'global') return this._resolve(prefs.context, state, options)
        if (this.type === 'local') return this._resolve(local, state, options)
        if (!this.ancestor) return this._resolve(value, state, options)
        if (this.ancestor === 'root') return this._resolve(state.ancestors[state.ancestors.length - 1], state, options)
        assert(this.ancestor <= state.ancestors.length, 'Invalid reference exceeds the schema root:', this.display)
        return this._resolve(state.ancestors[this.ancestor - 1], state, options)
    }

    protected _resolve(target: unknown, state: StateLike, options: ResolveOptions): unknown {
        let resolved: unknown
        //Like upstream: a value reference expects the state to have a mainstay
        if (this.type === 'value' && (state.mainstay as MainstayLike).shadow && options.shadow !== false) {
            resolved = ((state.mainstay as MainstayLike).shadow as { get(path: PathKey[]): unknown }).get(this.absolute(state))
        }
        if (resolved === undefined) resolved = reach(target, this.path, {iterables: !!this.iterables, functions: true})
        if (this.adjust) resolved = this.adjust(resolved)
        if (this.map) {
            const mapped: unknown = this.map.get(resolved)
            if (mapped !== undefined) resolved = mapped
        }
        if (state.mainstay) state.mainstay.tracer.resolve(state, this, resolved)
        return resolved
    }

    public toString(): string {
        return this.display
    }

    public absolute(state: StateLike): PathKey[] {
        return [...state.path.slice(0, -(this.ancestor as number)), ...this.path]
    }

    public clone(): Ref {
        return new Ref(this)
    }

    public describe(): { ref: RefDescription } {
        const ref: RefDescription = {path: this.path}
        if (this.type !== 'value') ref.type = this.type
        if (this.separator !== '.') ref.separator = this.separator
        if (this.type === 'value' && this.ancestor !== 1) ref.ancestor = this.ancestor
        if (this.map) ref.map = [...this.map]
        if (this.adjust !== null && this.adjust !== undefined) ref.adjust = this.adjust
        if (this.iterables !== null && this.iterables !== undefined) ref.iterables = this.iterables
        if (this.render !== null && this.render !== undefined) ref.render = this.render
        if (this.in !== false) ref.in = true
        return {ref}
    }

    public updateDisplay(): void {
        const key: string = this.key !== null ? this.key : ''
        if (this.type !== 'value') {
            this.display = `ref:${this.type}:${key}`
            return
        }
        if (!this.separator) {
            this.display = `ref:${key}`
            return
        }
        if (!this.ancestor) {
            this.display = `ref:${this.separator}${key}`
            return
        }
        if (this.ancestor === 'root') {
            this.display = `ref:root:${key}`
            return
        }
        if (this.ancestor === 1) {
            this.display = `ref:${key || '..'}`
            return
        }
        const lead: string = new Array(this.ancestor + 1).fill(this.separator).join('')
        this.display = `ref:${lead}${key || ''}`
    }
}

Object.defineProperty(Ref.prototype, Common.symbols.ref, {value: true, writable: true, enumerable: true, configurable: true})

interface Context {
    key: string
    type: RefType
    root?: boolean
}

function context(key: string, separator: string | false | undefined, prefix: RefPrefix | undefined = {}): Context {
    key = key.trim()
    if (prefix) {
        const globalp: string = prefix.global === undefined ? '$' : prefix.global
        if (globalp !== separator && key.startsWith(globalp)) return {key: key.slice(globalp.length), type: 'global'}
        const local: string = prefix.local === undefined ? '#' : prefix.local
        if (local !== separator && key.startsWith(local)) return {key: key.slice(local.length), type: 'local'}
        const root: string = prefix.root === undefined ? '/' : prefix.root
        if (root !== separator && key.startsWith(root)) return {key: key.slice(root.length), type: 'value', root: true}
    }
    return {key, type: 'value'}
}

function ancestor(key: string, separator: string | false | undefined): [number, number] {
    //'a_b' -> 1 (parent)
    if (!separator) return [1, 0]
    //'a.b' -> 1 (parent)
    if (key[0] !== separator) return [1, 0]
    //'.a.b' -> 0 (self)
    if (key[1] !== separator) return [0, 1]
    let i: number = 2
    while (key[i] === separator) ++i
    //'...a.b.' -> 2 (grandparent)
    return [i - 1, i]
}

/**
 * Create a reference
 * @param key
 * @param options
 */
export function create(key: string, options: RefOptions = {}): Ref {
    assert(typeof key === 'string', 'Invalid reference key:', key)
    Common.assertOptions(options, ['adjust', 'ancestor', 'in', 'iterables', 'map', 'prefix', 'render', 'separator'])
    assert(!options.prefix || typeof options.prefix === 'object', 'options.prefix must be of type object')
    const ref: RefSettings & { prefix?: RefPrefix } = Object.assign({}, defaults, options) as RefSettings & { prefix?: RefPrefix }
    delete ref.prefix
    const separator: string | false | undefined = ref.separator
    const refContext: Context = context(key, separator, options.prefix)
    ref.type = refContext.type
    let refKey: string | null = refContext.key
    if (ref.type === 'value') {
        if (refContext.root) {
            assert(!separator || refKey[0] !== separator, 'Cannot specify relative path with root prefix')
            ref.ancestor = 'root'
            if (!refKey) refKey = null
        }
        if (separator && separator === refKey) {
            refKey = null
            ref.ancestor = 0
        } else {
            if (ref.ancestor !== undefined) {
                assert(!separator || !refKey || refKey[0] !== separator, 'Cannot combine prefix with ancestor option')
            } else {
                const [refAncestor, slice] = ancestor(refKey as string, separator)
                if (slice) {
                    refKey = (refKey as string).slice(slice)
                    if (refKey === '') refKey = null
                }
                ref.ancestor = refAncestor
            }
        }
    }
    ref.path = separator ? (refKey === null ? [] : refKey.split(separator)) : [refKey as string]
    return new Ref(ref)
}

export function isRef(ref: unknown): ref is Ref {
    return ref ? !!(ref as Record<symbol, unknown>)[Common.symbols.ref] : false
}

/**
 * Create an in() reference (matching any item of the referenced array or any key of the referenced object)
 * @param key
 * @param options
 */
function inRef(key: string, options: RefOptions = {}): Ref {
    return create(key, {...options, in: true})
}

export {inRef as in}

/**
 * Build a reference from its description
 * @param desc
 */
export function build(desc: RefDescription): Ref {
    const settings: RefSettings = Object.assign({}, defaults, desc)
    if (settings.type === 'value' && settings.ancestor === undefined) settings.ancestor = 1
    return new Ref(settings)
}

export const toSibling: number = 0

export const toParent: number = 1

/**
 * A reference registered by a schema: how many levels up it points and its root key
 */
export interface RegisteredRef {
    ancestor: number
    root: PathKey
}

/**
 * Tracks the references used by a schema (0: [self refs], 1: [parent refs], 2: [grandparent refs], ...)
 */
export class Manager {

    public refs: RegisteredRef[] = []

    public register(source: unknown, target?: number): void {
        if (!source) return
        const targetLevel: number = target === undefined ? toParent : target
        //Array
        if (isArray(source)) {
            for (const ref of source) this.register(ref, targetLevel)
            return
        }
        //Schema
        if (Common.isSchema(source)) {
            for (const item of (source as unknown as { _refs: Manager })._refs.refs) {
                if (item.ancestor - targetLevel >= 0) this.refs.push({ancestor: item.ancestor - targetLevel, root: item.root})
            }
            return
        }
        //Reference
        if (isRef(source) && source.type === 'value' && (source.ancestor as number) - targetLevel >= 0) {
            this.refs.push({ancestor: (source.ancestor as number) - targetLevel, root: source.root})
        }
        //Template
        Template = Template || Lazy.template
        if ((Template as LazyTemplate).isTemplate(source)) this.register((source as { refs(): unknown[] }).refs(), targetLevel)
    }

    public get length(): number {
        return this.refs.length
    }

    public clone(): Manager {
        const copy: Manager = new Manager()
        copy.refs = clone(this.refs)
        return copy
    }

    public reset(): void {
        this.refs = []
    }

    public roots(): PathKey[] {
        return this.refs.filter((ref: RegisteredRef): boolean => !ref.ancestor).map((ref: RegisteredRef): PathKey => ref.root)
    }
}

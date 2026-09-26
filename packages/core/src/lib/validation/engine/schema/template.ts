/**
 * Derived from the upstream lib/template.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {clone, escapeHtml, isArray} from '../hoek/index.js'
import {assert, definitionException} from './assert.js'
import {type FormulaConstant, type FormulaEvaluator, type FormulaFunction, Parser} from '../formula/index.js'
import * as Common from './common.js'
import * as Errors from './errors.js'
import {Lazy} from './lazy.js'
import type {ErrorPreferences, Preferences, StateLike} from './model.js'
import * as Ref from './ref.js'
import type {Messages} from './messages.js'

const opens: string = new Array(1000).join('\u0000')
const closes: string = new Array(1000).join('\u0001')

type DateFormat = NonNullable<Preferences['dateFormat']>

const dateFormat: Record<DateFormat, (this: Date) => string> = {
    date: Date.prototype.toDateString,
    iso: Date.prototype.toISOString,
    string: Date.prototype.toString,
    time: Date.prototype.toTimeString,
    utc: Date.prototype.toUTCString
}

/**
 * Options of a template: reference options, and functions callable from the template formulas
 */
export interface TemplateOptions extends Ref.RefOptions {
    functions?: Record<string, FormulaFunction>
}

export interface TemplateDescription {
    template: string
    options?: Ref.RefOptions
    functions?: Record<string, FormulaFunction>
}

/**
 * Options of a template rendering
 */
export interface RenderOptions extends Ref.ResolveOptions {
    errors?: ErrorPreferences
    messages?: (Messages | null | undefined)[]
    arrayItems?: boolean
}

/**
 * The arguments a template resolves with, also the `this` of its formula functions
 */
type RenderContext = [value: unknown, state: StateLike, prefs: Preferences, local: unknown, options: RenderOptions]

interface RefPart {
    ref: Ref.Ref
    raw: boolean
    refs: Ref.Ref[]
    wrapped: boolean
}

interface FormulaPart {
    formula: Parser
    raw: boolean
    refs: Ref.Ref[]
    wrapped?: undefined
    ref?: undefined
}

type DynamicPart = RefPart | FormulaPart

type TemplatePart = string | DynamicPart

const constants: Record<string, FormulaConstant> = {
    true: true,
    false: false,
    null: null,
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000
}

const functions: Record<string, FormulaFunction> = {
    if(condition: unknown, then: unknown, otherwise: unknown): unknown {
        return condition ? then : otherwise
    },
    length(item: unknown): unknown {
        if (typeof item === 'string') return item.length
        if (!item || typeof item !== 'object') return null
        if (isArray(item)) return item.length
        return Object.keys(item).length
    },
    msg(this: unknown, code: unknown): unknown {
        const [value, state, prefs, local, options] = this as RenderContext
        const messages: (Messages | null | undefined)[] | undefined = options.messages
        if (!messages) return ''
        const template: unknown = Errors.template(value, messages[0], code as string, state, prefs) || Errors.template(value, messages[1], code as string, state, prefs)
        if (!template) return ''
        return (template as Template).render(value, state, prefs, local, options)
    },
    number(value: unknown): unknown {
        if (typeof value === 'number') return value
        if (typeof value === 'string') return parseFloat(value)
        if (typeof value === 'boolean') return value ? 1 : 0
        if (value instanceof Date) return value.getTime()
        return null
    }
}

function encode(string: string): string {
    return string
        .replace(/\\(\{+)/g, ($0: string, $1: string): string => opens.slice(0, $1.length))
        .replace(/\\(\}+)/g, ($0: string, $1: string): string => closes.slice(0, $1.length))
}

function decode(string: string): string {
    return string
        .replace(/\u0000/g, '{')
        .replace(/\u0001/g, '}')
}

function split(string: string): string[] {
    const parts: string[] = []
    let current: string = ''
    for (let i: number = 0; i < string.length; ++i) {
        const char: string = string[i]
        if (char === '{') {
            let next: string = ''
            while (i + 1 < string.length && string[i + 1] === '{') {
                next += '{'
                ++i
            }
            parts.push(current)
            current = next
        } else {
            current += char
        }
    }
    parts.push(current)
    return parts
}

function wrap(value: string, ends: string | false | undefined): string {
    if (!ends) return value
    if (ends.length === 1) return `${ends}${value}${ends}`
    return `${ends[0]}${value}${ends[1]}`
}

function stringify(value: unknown, original?: unknown, state?: StateLike, prefs?: Preferences, local?: unknown, options: RenderOptions = {}): string | undefined {
    const type: string = typeof value
    const wrapPrefs: NonNullable<ErrorPreferences['wrap']> = prefs && prefs.errors && prefs.errors.wrap || {}
    let skipWrap: boolean = false
    if (Ref.isRef(value) && value.render) {
        skipWrap = value.in
        value = value.resolve(original, state as StateLike, prefs as Preferences, local, {in: value.in, ...options})
    }
    if (value === null) return 'null'
    if (type === 'string') return wrap(value as string, options.arrayItems && wrapPrefs.string)
    if (type === 'number' || type === 'function' || type === 'symbol') return (value as { toString(): string }).toString()
    if (type !== 'object') return JSON.stringify(value)
    if (value instanceof Date) return Template.date(value, prefs as Preferences)
    if (value instanceof Map) {
        const pairs: string[] = []
        for (const [key, sym] of value.entries()) pairs.push(`${(key as { toString(): string }).toString()} -> ${(sym as { toString(): string }).toString()}`)
        value = pairs
    }
    if (!isArray(value)) return (value as { toString(): string }).toString()
    const values: (string | undefined)[] = []
    for (const item of value) values.push(stringify(item, original, state, prefs, local, {arrayItems: true, ...options}))
    return wrap(values.join(', '), !skipWrap && wrapPrefs.array)
}

/**
 * A message template: text with {references} and {{escaped references}}, which may be formulas
 */
export class Template {

    declare public isImmutable: true

    public source: string

    public rendered: string

    protected _template: TemplatePart[] | null

    protected _settings: Ref.RefOptions | undefined

    protected _functions: Record<string, FormulaFunction> | undefined

    constructor(source: string, options?: TemplateOptions) {
        assert(typeof source === 'string', 'Template source must be a string')
        assert(!source.includes('\u0000') && !source.includes('\u0001'), 'Template source cannot contain reserved control characters')
        this.source = source
        this.rendered = source
        this._template = null
        if (options) {
            const {functions: templateFunctions, ...opts} = options
            this._settings = Object.keys(opts).length ? clone(opts) : undefined
            this._functions = templateFunctions
            if (this._functions) {
                assert(Object.keys(this._functions).every((key: string): boolean => typeof key === 'string'), 'Functions keys must be strings')
                assert(Object.values(this._functions).every((key: unknown): boolean => typeof key === 'function'), 'Functions values must be functions')
            }
        } else {
            this._settings = undefined
            this._functions = undefined
        }
        this._parse()
    }

    protected _parse(): void {
        //'text {raw} {{ref}} \\{{ignore}} {{ignore\\}} {{ignore {{ignore}'
        if (!this.source.includes('{')) return
        //Encode escaped \\{{{{{
        const encoded: string = encode(this.source)
        //Split on first { in each set
        const parts: string[] = split(encoded)
        //Process parts
        let refs: boolean = false
        const processed: TemplatePart[] = []
        const head: string | undefined = parts.shift()
        if (head) processed.push(head)
        for (const part of parts) {
            const raw: boolean = part[0] !== '{'
            const ender: string = raw ? '}' : '}}'
            const end: number = part.indexOf(ender)
            //Ignore non-matching closing, ignore more than two {
            if (end === -1 || part[1] === '{') {
                processed.push(`{${decode(part)}`)
                continue
            }
            let variable: string = part.slice(raw ? 0 : 1, end)
            const wrapped: boolean = variable[0] === ':'
            if (wrapped) variable = variable.slice(1)
            const dynamic: string | DynamicPart = this._ref(decode(variable), {raw, wrapped})
            processed.push(dynamic)
            if (typeof dynamic !== 'string') refs = true
            const rest: string = part.slice(end + ender.length)
            if (rest) processed.push(decode(rest))
        }
        if (!refs) {
            this.rendered = processed.join('')
            return
        }
        this._template = processed
    }

    public static date(date: Date, prefs: Preferences): string {
        return dateFormat[prefs.dateFormat as DateFormat].call(date)
    }

    public describe(options: { compact?: boolean } = {}): string | TemplateDescription {
        if (!this._settings && options.compact) return this.source
        const desc: TemplateDescription = {template: this.source}
        if (this._settings) desc.options = this._settings
        if (this._functions) desc.functions = this._functions
        return desc
    }

    public static build(desc: TemplateDescription): Template {
        return new Template(desc.template, desc.options || desc.functions ? {...desc.options, functions: desc.functions} : undefined)
    }

    public isDynamic(): boolean {
        return !!this._template
    }

    public static isTemplate(template: unknown): template is Template {
        return template ? !!(template as Record<symbol, unknown>)[Common.symbols.template] : false
    }

    public refs(): Ref.Ref[] | undefined {
        if (!this._template) return
        const refs: Ref.Ref[] = []
        for (const part of this._template) {
            if (typeof part !== 'string') refs.push(...part.refs)
        }
        return refs
    }

    public resolve(value: unknown, state: StateLike, prefs: Preferences, local: unknown): unknown {
        if (this._template && this._template.length === 1) return this._part(this._template[0] as DynamicPart, [value, state, prefs, local, {}])
        return this.render(value, state, prefs, local)
    }

    protected _part(part: DynamicPart, context: RenderContext): unknown {
        if (part.ref) return part.ref.resolve(...context)
        return (part as FormulaPart).formula.evaluate(context)
    }

    public render(value: unknown, state: StateLike, prefs: Preferences, local: unknown, options: RenderOptions = {}): string {
        if (!this.isDynamic()) return this.rendered
        const parts: string[] = []
        for (const part of this._template as TemplatePart[]) {
            if (typeof part === 'string') {
                parts.push(part)
            } else {
                const rendered: unknown = this._part(part, [value, state, prefs, local, options])
                const string: string | undefined = stringify(rendered, value, state, prefs, local, options)
                if (string !== undefined) {
                    const result: string = part.raw || (options.errors && options.errors.escapeHtml) === false ? string : escapeHtml(string)
                    parts.push(wrap(result, part.wrapped && ((prefs.errors as ErrorPreferences).wrap as NonNullable<ErrorPreferences['wrap']>).label))
                }
            }
        }
        return parts.join('')
    }

    protected _ref(content: string, {raw, wrapped}: { raw: boolean, wrapped: boolean }): string | DynamicPart {
        const refs: Ref.Ref[] = []
        const reference = (variable: string): FormulaEvaluator => {
            const ref: Ref.Ref = Ref.create(variable, this._settings)
            refs.push(ref)
            return (context: unknown): unknown => {
                const resolved: unknown = ref.resolve(...(context as RenderContext))
                return resolved !== undefined ? resolved : null
            }
        }
        let formula: Parser
        try {
            const templateFunctions: Record<string, FormulaFunction> = this._functions ? {...functions, ...this._functions} : functions
            formula = new Parser(content, {reference, functions: templateFunctions, constants})
        } catch (err) {
            throw definitionException(`Invalid template variable "${content}" fails due to: ${(err as Error).message}`, Template.prototype._ref, err)
        }
        if (formula.single) {
            if (formula.single.type === 'reference') {
                const ref: Ref.Ref = refs[0]
                return {ref, raw, refs, wrapped: wrapped || ref.type === 'local' && ref.key === 'label'}
            }
            return stringify(formula.single.value) as string
        }
        return {formula, raw, refs}
    }

    public toString(): string {
        return this.source
    }
}

Object.defineProperty(Template.prototype, Common.symbols.template, {value: true, writable: true, enumerable: true, configurable: true})
//Prevents Hoek from deep cloning schema objects
Object.defineProperty(Template.prototype, 'isImmutable', {value: true, writable: true, enumerable: true, configurable: true})

Lazy.template = Template

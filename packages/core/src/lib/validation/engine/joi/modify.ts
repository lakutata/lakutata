/**
 * Derived from joi 18.0.2 lib/modify.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from '../hoek/index.js'
import * as Common from './common.js'
import type {PathKey, SchemaInternals, SchemaRule} from './model.js'
import * as Ref from './ref.js'

/**
 * A schema registered by id or by key
 */
export interface IdNode {
    schema: SchemaInternals
    id: string
}

/**
 * Where a scanned schema or reference was found
 */
export interface ModifySource {
    source: 'flags' | 'rules' | 'terms'
    name: string
}

export interface ModifyEachSource extends ModifySource {
    path: PathKey[]
    key: string | false | undefined
}

/**
 * Options of a schema modification: each() is called with every nested schema and reference,
 * and returns the replacement (or undefined, or the item itself, to keep it)
 */
export interface ModifyOptions {
    each(item: unknown, source: ModifyEachSource): unknown
    //Accepted by $_modify(), unused
    once?: boolean
    ref?: boolean
    schema?: boolean
}

type ForkAdjuster = (schema: SchemaInternals) => SchemaInternals

/**
 * The schemas of a schema, by id and by key
 */
export class Ids {

    protected _byId: Map<string, IdNode>

    protected _byKey: Map<string, IdNode>

    public _schemaChain: boolean

    constructor() {
        this._byId = new Map()
        this._byKey = new Map()
        this._schemaChain = false
    }

    public clone(): Ids {
        const clone: Ids = new Ids()
        clone._byId = new Map(this._byId)
        clone._byKey = new Map(this._byKey)
        clone._schemaChain = this._schemaChain
        return clone
    }

    public concat(source: Ids): void {
        if (source._schemaChain) this._schemaChain = true
        for (const [id, value] of source._byId.entries()) {
            assert(!this._byKey.has(id), 'Schema id conflicts with existing key:', id)
            this._byId.set(id, value)
        }
        for (const [key, value] of source._byKey.entries()) {
            assert(!this._byId.has(key), 'Schema key conflicts with existing id:', key)
            this._byKey.set(key, value)
        }
    }

    public fork(path: string[], adjuster: ForkAdjuster, root: SchemaInternals): SchemaInternals {
        const chain: { schema: SchemaInternals, id?: string }[] = this._collect(path)
        chain.push({schema: root})
        const tail: { schema: SchemaInternals, id?: string } = chain.shift() as IdNode
        let adjusted: { schema: SchemaInternals, id?: string } = {id: tail.id, schema: adjuster(tail.schema)}
        assert(Common.isSchema(adjusted.schema), 'adjuster function failed to return a joi schema type')
        for (const node of chain) adjusted = {id: node.id, schema: fork(node.schema, adjusted.id as string, adjusted.schema)}
        return adjusted.schema
    }

    public labels(path: string[], behind: string[] = []): string {
        const current: string = path[0]
        const node: IdNode | undefined = this._get(current)
        if (!node) return [...behind, ...path].join('.')
        const forward: string[] = path.slice(1)
        behind = [...behind, node.schema._flags.label || current]
        if (!forward.length) return behind.join('.')
        return node.schema._ids.labels(forward, behind)
    }

    public reach(path: string[], behind: string[] = []): SchemaInternals {
        const current: string = path[0]
        const node: IdNode | undefined = this._get(current)
        assert(node, 'Schema does not contain path', [...behind, ...path].join('.'))
        const forward: string[] = path.slice(1)
        if (!forward.length) return node.schema
        return node.schema._ids.reach(forward, [...behind, current])
    }

    public register(schema: unknown, {key}: { key?: string } = {}): void {
        if (!schema || !Common.isSchema(schema)) return
        const registered: SchemaInternals = schema as SchemaInternals
        if (registered.$_property('schemaChain') || registered._ids._schemaChain) this._schemaChain = true
        const id: string | undefined = registered._flags.id
        if (id) {
            const existing: IdNode | undefined = this._byId.get(id)
            assert(!existing || existing.schema === registered, 'Cannot add different schemas with the same id:', id)
            assert(!this._byKey.has(id), 'Schema id conflicts with existing key:', id)
            this._byId.set(id, {schema: registered, id})
        }
        if (key) {
            assert(!this._byKey.has(key), 'Schema already contains key:', key)
            assert(!this._byId.has(key), 'Schema key conflicts with existing id:', key)
            this._byKey.set(key, {schema: registered, id: key})
        }
    }

    public reset(): void {
        this._byId = new Map()
        this._byKey = new Map()
        this._schemaChain = false
    }

    public _collect(path: string[], behind: string[] = [], nodes: IdNode[] = []): IdNode[] {
        const current: string = path[0]
        const node: IdNode | undefined = this._get(current)
        assert(node, 'Schema does not contain path', [...behind, ...path].join('.'))
        nodes = [node, ...nodes]
        const forward: string[] = path.slice(1)
        if (!forward.length) return nodes
        return node.schema._ids._collect(forward, [...behind, current], nodes)
    }

    public _get(id: string): IdNode | undefined {
        return this._byId.get(id) || this._byKey.get(id)
    }
}

function fork(schema: SchemaInternals, id: string, replacement: SchemaInternals): SchemaInternals {
    const each = (item: unknown, {key}: ModifyEachSource): unknown => {
        if (id === ((item as SchemaInternals)._flags.id || key)) return replacement
    }
    const obj: SchemaInternals | undefined = modifySchema(schema, {each, ref: false})
    return obj ? obj.$_mutateRebuild() : schema
}

/**
 * A modified clone of a schema, with the nested schemas and references replaced by each(),
 * or undefined when nothing was replaced
 * @param schema
 * @param options
 */
function modifySchema<T extends SchemaInternals>(schema: T, options: ModifyOptions): T | undefined {
    let obj: T | undefined
    for (const name in schema._flags) {
        if (name[0] === '_') continue
        const result: unknown = scan(schema._flags[name], {source: 'flags', name}, options)
        if (result !== undefined) {
            obj = obj || schema.clone()
            obj._flags[name] = result
        }
    }
    for (let i: number = 0; i < schema._rules.length; ++i) {
        const rule: SchemaRule = schema._rules[i]
        const result: unknown = scan(rule.args, {source: 'rules', name: rule.name}, options)
        if (result !== undefined) {
            obj = obj || schema.clone()
            const clone: SchemaRule = Object.assign({}, rule)
            clone.args = result as Record<string, unknown>
            obj._rules[i] = clone
            const existingUnique: SchemaRule | undefined = obj._singleRules.get(rule.name)
            if (existingUnique === rule) obj._singleRules.set(rule.name, clone)
        }
    }
    for (const name in schema.$_terms) {
        if (name[0] === '_') continue
        const result: unknown = scan(schema.$_terms[name], {source: 'terms', name}, options)
        if (result !== undefined) {
            obj = obj || schema.clone()
            obj.$_terms[name] = result
        }
    }
    return obj
}

export {modifySchema as schema}

function scan(item: unknown, source: ModifySource, options: ModifyOptions, _path?: PathKey[], _key?: string | false): unknown {
    const path: PathKey[] = _path || []
    if (item === null || typeof item !== 'object') return
    let clone: unknown[] | Record<string, unknown> | undefined
    if (Array.isArray(item)) {
        for (let i: number = 0; i < item.length; ++i) {
            const key: string | false | undefined = source.source === 'terms' && source.name === 'keys' && (item[i] as { key?: string }).key
            const result: unknown = scan(item[i], source, options, [i, ...path], key)
            if (result !== undefined) {
                clone = clone || item.slice()
                ;(clone as unknown[])[i] = result
            }
        }
        return clone
    }
    if (options.schema !== false && Common.isSchema(item) || options.ref !== false && Ref.isRef(item)) {
        const result: unknown = options.each(item, {...source, path, key: _key})
        if (result === item) return
        return result
    }
    const record: Record<string, unknown> = item as Record<string, unknown>
    for (const key in record) {
        if (key[0] === '_') continue
        const result: unknown = scan(record[key], source, options, [key, ...path], _key)
        if (result !== undefined) {
            clone = clone || Object.assign({}, record)
            ;(clone as Record<string, unknown>)[key] = result
        }
    }
    return clone
}

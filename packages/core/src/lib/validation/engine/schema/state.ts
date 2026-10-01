/**
 * Derived from the upstream lib/state.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {clone, reach} from '../utils/index.js'
import * as Common from './common.js'
import type {PathKey, StateLike} from './model.js'
import type {Mainstay} from './validator.js'

const valueSymbol: unique symbol = Symbol('value')

/**
 * A shadow node: child nodes by path segment, and the shadowed value of its own path
 */
type ShadowNode = Map<PathKey, ShadowNode> & { [valueSymbol]?: unknown }


/**
 * An entry of the schemas chain ([current, ..., root])
 */
export interface StateSchemaEntry {
    schema: unknown
    key?: PathKey
}

function schemaEntry(schema: unknown): StateSchemaEntry {
    if (Common.isSchema(schema)) return {schema}
    return schema as StateSchemaEntry
}

/**
 * Values changed during the validation (converted or stripped), by path
 */
export class Shadow {

    protected _values: ShadowNode | null = null

    public set(path: PathKey[], value: unknown, reason?: string): void {
        //No need to store root value
        if (!path.length) return
        //Cannot store stripped array values (due to shift)
        if (reason === 'strip' && typeof path[path.length - 1] === 'number') return
        this._values = this._values || new Map() as ShadowNode
        let node: ShadowNode = this._values
        for (let i: number = 0; i < path.length; ++i) {
            const segment: PathKey = path[i]
            let next: ShadowNode | undefined = node.get(segment)
            if (!next) {
                next = new Map() as ShadowNode
                node.set(segment, next)
            }
            node = next
        }
        node[valueSymbol] = value
    }

    public get(path: PathKey[]): unknown {
        const node: ShadowNode | undefined = this.node(path)
        if (node) return node[valueSymbol]
    }

    public node(path: PathKey[]): ShadowNode | undefined {
        if (!this._values) return
        return reach(this._values, path, {iterables: true}) as ShadowNode | undefined
    }

    public override(path: PathKey[], node: ShadowNode | undefined): void {
        if (!this._values) return
        const parents: PathKey[] = path.slice(0, -1)
        const own: PathKey = path[path.length - 1]
        const parent: ShadowNode | undefined = reach(this._values, parents, {iterables: true}) as ShadowNode | undefined
        if (node) {
            //Like upstream: overriding with a node expects the parent node to exist
            (parent as ShadowNode).set(own, node)
            return
        }
        if (parent) parent.delete(own)
    }
}

/**
 * State of the value being validated
 */
export class State implements StateLike {

    public path: PathKey[]

    //[parent, ..., root]
    public ancestors: unknown[]

    public mainstay: Mainstay

    //[current, ..., root]
    public schemas: StateSchemaEntry[] | null

    public debug: unknown

    protected _snapshot: ShadowNode | undefined

    constructor(path: PathKey[], ancestors: unknown[], state: { mainstay: Mainstay, schemas?: StateSchemaEntry[] | null }) {
        this.path = path
        this.ancestors = ancestors
        this.mainstay = state.mainstay
        this.schemas = state.schemas as StateSchemaEntry[] | null
        this.debug = null
    }

    public localize(path: PathKey[], ancestors: unknown[] | null = null, schema: unknown = null): State {
        const state: State = new State(path, ancestors as unknown[], this)
        if (schema && state.schemas) state.schemas = [schemaEntry(schema), ...state.schemas]
        return state
    }

    public nest(schema: unknown, debug?: unknown): State {
        const state: State = new State(this.path, this.ancestors, this)
        state.schemas = state.schemas && [schemaEntry(schema), ...state.schemas]
        state.debug = debug
        return state
    }

    public shadow(value: unknown, reason?: string): void {
        this.mainstay.shadow = this.mainstay.shadow || new Shadow()
        this.mainstay.shadow.set(this.path, value, reason)
    }

    public snapshot(): void {
        if (this.mainstay.shadow) this._snapshot = clone(this.mainstay.shadow.node(this.path))
        this.mainstay.snapshot()
    }

    public restore(): void {
        if (this.mainstay.shadow) {
            this.mainstay.shadow.override(this.path, this._snapshot)
            this._snapshot = undefined
        }
        this.mainstay.restore()
    }

    public commit(): void {
        if (this.mainstay.shadow) {
            this.mainstay.shadow.override(this.path, this._snapshot)
            this._snapshot = undefined
        }
        this.mainstay.commit()
    }
}

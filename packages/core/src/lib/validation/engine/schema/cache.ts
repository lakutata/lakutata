/**
 * Derived from the upstream lib/cache.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {clone} from '../utils/index.js'
import {assert} from './assert.js'
import * as Common from './common.js'

const defaultMax: number = 1000
const supported: Set<string> = new Set(['undefined', 'boolean', 'number', 'string'])

/**
 * Keys a cache can store values by
 */
export type CacheKey = undefined | null | boolean | number | string

export interface CacheOptions {
    max?: number
}

interface ListNode {
    key: CacheKey
    value: unknown
    next: ListNode | null
    prev: ListNode | null
}

/**
 * Doubly linked list of cache nodes (most recently used in head)
 */
class List {

    public tail: ListNode | null = null

    public head: ListNode | null = null

    public unshift(node: ListNode): ListNode {
        node.next = null
        node.prev = this.head
        if (this.head) this.head.next = node
        this.head = node
        if (!this.tail) this.tail = node
        return node
    }

    public first(node: ListNode): void {
        if (node === this.head) return
        this._remove(node)
        this.unshift(node)
    }

    public pop(): ListNode {
        return this._remove(this.tail as ListNode)
    }

    protected _remove(node: ListNode): ListNode {
        const {next, prev} = node
        //Like upstream: the removed node is never the head, so it always has a next node
        ;(next as ListNode).prev = prev
        if (prev) prev.next = next
        if (node === this.tail) this.tail = next
        node.prev = null
        node.next = null
        return node
    }
}

/**
 * Least Recently Used (LRU) cache
 */
export class Cache {

    protected _max: number

    //Map of nodes by key
    protected _map: Map<CacheKey, ListNode>

    //List of nodes (most recently used in head)
    protected _list: List

    constructor(options: CacheOptions = {}) {
        Common.assertOptions(options, ['max'])
        assert(options.max === undefined || options.max && options.max > 0 && isFinite(options.max), 'Invalid max cache size')
        this._max = options.max || defaultMax
        this._map = new Map()
        this._list = new List()
    }

    public get length(): number {
        return this._map.size
    }

    public set(value: unknown, result: unknown): void {
        if (value !== null && !supported.has(typeof value)) return
        const key: CacheKey = value as CacheKey
        let node: ListNode | undefined = this._map.get(key)
        if (node) {
            node.value = result
            this._list.first(node)
            return
        }
        node = this._list.unshift({key, value: result, next: null, prev: null})
        this._map.set(key, node)
        this._compact()
    }

    public get(value: unknown): unknown {
        const node: ListNode | undefined = this._map.get(value as CacheKey)
        if (node) {
            this._list.first(node)
            return clone(node.value)
        }
    }

    protected _compact(): void {
        if (this._map.size > this._max) {
            const node: ListNode = this._list.pop()
            this._map.delete(node.key)
        }
    }
}

export const provider = {
    provision(options?: CacheOptions): Cache {
        return new Cache(options)
    }
}

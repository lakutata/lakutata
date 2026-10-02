/**
 * Derived from lib/eventemitter2.js of eventemitter2 6.4.9 (MIT, see THIRD_PARTY_NOTICES.md): the event emitter of
 * 2.x, with its wildcards (the parts of the namespaces of the events separated by the delimiter, "*" for a part and
 * "**" for any parts). The API the framework uses is ported (listenTo, waitFor and the cancelable promises are not).
 * The nodes of the listener tree have no prototype (an event named like a property of Object.prototype, such as
 * "constructor", used the property in the upstream), and a listener both promisified and called in the next tick is
 * called (the upstream only resolved its promise)
 */

export type event = string | symbol
export type eventNS = string | event[]
export type ListenerFn = (...values: any[]) => any
export type EventAndListener = (event: string | string[], ...values: any[]) => any

export interface ConstructorOptions {
    /**
     * Use the wildcards
     */
    wildcard?: boolean
    /**
     * The delimiter of the parts of the namespaces
     */
    delimiter?: string
    /**
     * Emit the newListener event
     */
    newListener?: boolean
    /**
     * Emit the removeListener event
     */
    removeListener?: boolean
    /**
     * The number of the listeners of an event above which a possible memory leak is warned of
     */
    maxListeners?: number
    /**
     * Name the event in the warning of a possible memory leak
     */
    verboseMemoryLeak?: boolean
    /**
     * Do not throw an error event without listener
     */
    ignoreErrors?: boolean
}

export interface OnOptions {
    /**
     * Call the listener asynchronously (setImmediate)
     */
    async?: boolean
    /**
     * Call the listener in the next tick (process.nextTick)
     */
    nextTick?: boolean
    /**
     * Make the asynchronous listener return a promise of its result
     */
    promisify?: boolean
    /**
     * Not supported: the emitter is returned
     */
    objectify?: boolean
}

/**
 * A listener: a function, with the original function of its wrappers
 */
type Listener = ListenerFn & { _origin?: ListenerFn, _async?: boolean, listener?: ListenerFn }

/**
 * The listeners of an event: one function, or several (warned of a possible memory leak once)
 */
type Listeners = Listener | (Listener[] & { warned?: boolean })

/**
 * A node of the listener tree: its listeners, and its children by part
 */
type TreeNode = { _listeners?: Listeners | null, [part: string | symbol]: any }

const ownKeys: (target: object) => (string | symbol)[] = Reflect.ownKeys

function Node(): TreeNode {
    return Object.create(null)
}

export class EventEmitter2 {

    public delimiter: string = '.'

    /**
     * The event of the listener being called
     */
    public event: string | event[] = ''

    protected wildcard?: boolean

    protected verboseMemoryLeak: boolean = false

    protected ignoreErrors?: boolean

    protected listenerTree?: TreeNode

    protected _events?: Record<string | symbol, Listeners | null>

    protected _all?: EventAndListener[]

    protected _conf?: ConstructorOptions

    protected _maxListeners?: number

    protected _newListener: boolean = false

    protected _removeListener: boolean = false

    constructor(conf?: ConstructorOptions) {
        this._events = {}
        this.configure(conf)
    }

    protected init(): void {
        this._events = {}
        if (this._conf) this.configure(this._conf)
    }

    protected configure(conf?: ConstructorOptions): void {
        if (!conf) return
        this._conf = conf
        if (conf.delimiter) this.delimiter = conf.delimiter
        if (conf.maxListeners !== undefined) this._maxListeners = conf.maxListeners
        if (conf.wildcard) this.wildcard = conf.wildcard
        if (conf.newListener) this._newListener = conf.newListener
        if (conf.removeListener) this._removeListener = conf.removeListener
        if (conf.verboseMemoryLeak) this.verboseMemoryLeak = conf.verboseMemoryLeak
        if (conf.ignoreErrors) this.ignoreErrors = conf.ignoreErrors
        if (this.wildcard) this.listenerTree = Node()
    }

    protected logPossibleMemoryLeak(count: number, eventName: string | symbol): void {
        let errorMsg: string = `(node) warning: possible EventEmitter memory leak detected. ${count} listeners added. Use emitter.setMaxListeners() to increase limit.`
        if (this.verboseMemoryLeak) errorMsg += ` Event name: ${String(eventName)}.`
        const warning: Error & { emitter?: unknown, count?: number } = new Error(errorMsg)
        warning.name = 'MaxListenersExceededWarning'
        warning.emitter = this
        warning.count = count
        process.emitWarning(warning)
    }

    /**
     * The parts of an event
     * @param type
     */
    protected split(type: any): any[] {
        if (typeof type !== 'string') return type
        const parts: string[] = []
        let start: number = 0
        let index: number
        while ((index = type.indexOf(this.delimiter, start)) !== -1) {
            parts.push(type.slice(start, index))
            start = index + this.delimiter.length
        }
        parts.push(type.slice(start))
        return parts
    }

    /**
     * Collect the listeners of the tree matching an event (with the wildcards of the event and of the tree), and the
     * nodes holding them
     * @param handlers
     * @param type
     * @param tree
     * @param i
     * @param typeLength
     */
    protected searchListenerTree(handlers: Listener[] | null, type: any, tree: TreeNode | undefined, i: number, typeLength?: number): TreeNode[] | null {
        if (!tree) return null
        if (i === 0) {
            const kind: string = typeof type
            if (kind === 'string') {
                const parts: string[] = this.split(type)
                typeLength = parts.length
                //Like upstream: the parts of a namespace in an array of 5 items at least, its length is the length of the
                //event when the search starts again from a "**" (the events longer than their parts do not match there)
                type = parts.length > 1 && parts.length < 5 ? Object.assign(new Array(5), parts) : parts
            } else if (kind === 'object') {
                typeLength = type.length
            } else {
                type = [type]
                typeLength = 1
            }
        }
        let listeners: TreeNode[] | null = null
        let found: TreeNode[] | null
        const currentType: any = type[i]
        const nextType: any = type[i + 1]
        const add = (more: TreeNode[] | null): void => {
            if (!more) return
            if (listeners) listeners.push(...more)
            else listeners = more
        }
        if (i === typeLength) {
            //At the end of the event: the listeners of the node
            if (tree._listeners) {
                if (typeof tree._listeners === 'function') handlers?.push(tree._listeners)
                else handlers?.push(...tree._listeners)
                listeners = [tree]
            }
        } else if (currentType === '*') {
            //A part "*" of the event: any branch
            const branches: (string | symbol)[] = ownKeys(tree)
            let n: number = branches.length
            while (n-- > 0) {
                const branch: string | symbol = branches[n]
                if (branch !== '_listeners') add(this.searchListenerTree(handlers, type, tree[branch], i + 1, typeLength))
            }
            return listeners
        } else if (currentType === '**') {
            //A part "**" of the event: any parts
            const endReached: boolean = i + 1 === typeLength || (i + 2 === typeLength && nextType === '*')
            if (endReached && tree._listeners) listeners = this.searchListenerTree(handlers, type, tree, typeLength!, typeLength)
            const branches: (string | symbol)[] = ownKeys(tree)
            let n: number = branches.length
            while (n-- > 0) {
                const branch: string | symbol = branches[n]
                if (branch === '_listeners') continue
                if (branch === '*' || branch === '**') {
                    if (tree[branch]._listeners && !endReached) add(this.searchListenerTree(handlers, type, tree[branch], typeLength!, typeLength))
                    found = this.searchListenerTree(handlers, type, tree[branch], i, typeLength)
                } else if (branch === nextType) {
                    found = this.searchListenerTree(handlers, type, tree[branch], i + 2, typeLength)
                } else {
                    //No match: deeper in the tree, at the same part of the event
                    found = this.searchListenerTree(handlers, type, tree[branch], i, typeLength)
                }
                add(found)
            }
            return listeners
        } else if (tree[currentType]) {
            listeners = this.searchListenerTree(handlers, type, tree[currentType], i + 1, typeLength)
        }
        //A branch "*" of the tree matches any part
        const xTree: TreeNode | undefined = tree['*']
        if (xTree) this.searchListenerTree(handlers, type, xTree, i + 1, typeLength)
        //A branch "**" of the tree matches any parts
        const xxTree: TreeNode | undefined = tree['**']
        if (xxTree) {
            if (i < typeLength!) {
                if (xxTree._listeners) this.searchListenerTree(handlers, type, xxTree, typeLength!, typeLength)
                const branches: (string | symbol)[] = ownKeys(xxTree)
                let n: number = branches.length
                while (n-- > 0) {
                    const branch: string | symbol = branches[n]
                    if (branch === '_listeners') continue
                    if (branch === nextType) {
                        //The next part matches: two parts further
                        this.searchListenerTree(handlers, type, xxTree[branch], i + 2, typeLength)
                    } else if (branch === currentType) {
                        this.searchListenerTree(handlers, type, xxTree[branch], i + 1, typeLength)
                    } else {
                        const isolatedBranch: TreeNode = Node()
                        isolatedBranch[branch] = xxTree[branch]
                        const isolatedTree: TreeNode = Node()
                        isolatedTree['**'] = isolatedBranch
                        this.searchListenerTree(handlers, type, isolatedTree, i + 1, typeLength)
                    }
                }
            } else if (xxTree._listeners) {
                //The end of the event, still on a "**"
                this.searchListenerTree(handlers, type, xxTree, typeLength!, typeLength)
            } else if (xxTree['*'] && xxTree['*']._listeners) {
                this.searchListenerTree(handlers, type, xxTree['*'], typeLength!, typeLength)
            }
        }
        return listeners
    }

    protected growListenerTree(type: any, listener: Listener, prepend: boolean): boolean | undefined {
        const ns: any[] = typeof type === 'string' ? this.split(type) : type
        const len: number = ns.length
        //Two consecutive "**": the listener is not added
        if (len > 1) {
            for (let i: number = 0; i + 1 < len; i++) if (ns[i] === '**' && ns[i + 1] === '**') return
        }
        let tree: TreeNode = this.listenerTree!
        for (let i: number = 0; i < len; i++) {
            const name: string | symbol = ns[i]
            tree = tree[name] || (tree[name] = Node())
            if (i === len - 1) {
                if (!tree._listeners) {
                    tree._listeners = listener
                } else {
                    if (typeof tree._listeners === 'function') tree._listeners = [tree._listeners]
                    const listeners: Listener[] & { warned?: boolean } = tree._listeners
                    if (prepend) listeners.unshift(listener)
                    else listeners.push(listener)
                    if (!listeners.warned && this._maxListeners! > 0 && listeners.length > this._maxListeners!) {
                        listeners.warned = true
                        this.logPossibleMemoryLeak(listeners.length, name)
                    }
                }
                return true
            }
        }
        return true
    }

    /**
     * The events having listeners in a tree (the branches of a node having listeners count as events too, as upstream)
     * @param tree
     * @param events
     * @param root
     * @param asArray
     */
    protected collectTreeEvents(tree: TreeNode, events: any[], root: any[] | null, asArray?: boolean): any[] {
        const branches: (string | symbol)[] = ownKeys(tree)
        let i: number = branches.length
        const hasListeners: Listeners | null | undefined = tree._listeners
        while (i-- > 0) {
            const branchName: string | symbol = branches[i]
            const branch: any = tree[branchName]
            const path: any = branchName === '_listeners' ? root : (root ? root.concat(branchName) : [branchName])
            const isArrayPath: boolean = !!asArray || typeof branchName === 'symbol'
            if (hasListeners) events.push(isArrayPath ? path : path.join(this.delimiter))
            //Like upstream: the listeners removed by removeAllListeners() are null, the collecting throws on them
            if (typeof branch === 'object') this.collectTreeEvents(branch, events, path, isArrayPath)
        }
        return events
    }

    /**
     * Remove the branches without listeners: whether the node has a branch or listeners
     * @param root
     */
    protected recursivelyGarbageCollect(root: TreeNode): boolean | undefined {
        const keys: (string | symbol)[] = ownKeys(root)
        let i: number = keys.length
        let flag: boolean | undefined
        while (i-- > 0) {
            const key: string | symbol = keys[i]
            const obj: any = root[key]
            if (obj) {
                flag = true
                if (key !== '_listeners' && !this.recursivelyGarbageCollect(obj)) delete root[key]
            }
        }
        return flag
    }

    /**
     * The listener calling a listener asynchronously
     * @param listener
     * @param options
     */
    protected setupListener(listener: Listener, options: OnOptions | boolean): Listener {
        let async: boolean | undefined
        let promisify: boolean | undefined
        let nextTick: boolean | undefined
        if (options === true) {
            promisify = true
        } else if (options === false) {
            async = true
        } else {
            if (!options || typeof options !== 'object') throw TypeError('options should be an object or true')
            async = options.async
            promisify = options.promisify
            nextTick = options.nextTick
        }
        if (async || nextTick || promisify) {
            const original: Listener = listener
            const origin: ListenerFn = listener._origin || listener
            if (promisify === undefined) promisify = listener.constructor.name === 'AsyncFunction'
            async = true
            listener = function (this: EventEmitter2, ...args: any[]): any {
                //The event of the call, the emitter calls the other listeners meanwhile
                const context: EventEmitter2 = this
                const event: string | event[] = this.event
                if (promisify) {
                    return (nextTick ? Promise.resolve() : new Promise((resolve: (value?: unknown) => void): unknown => setImmediate(resolve))).then((): any => {
                        context.event = event
                        return original.apply(context, args)
                    })
                }
                const call = (): void => {
                    context.event = event
                    original.apply(context, args)
                }
                //Like upstream: the result of the scheduling
                return nextTick ? process.nextTick(call) : setImmediate(call)
            }
            listener._async = async
            listener._origin = origin
        }
        return listener
    }

    public setMaxListeners(n: number): void {
        if (n === undefined) return
        this._maxListeners = n
        if (!this._conf) this._conf = {}
        this._conf.maxListeners = n
    }

    public getMaxListeners(): number {
        return this._maxListeners!
    }

    public once(event: event | eventNS, fn: ListenerFn, options?: OnOptions | boolean): this {
        return this._many(event, 1, fn, false, options)
    }

    public prependOnceListener(event: event | eventNS, fn: ListenerFn, options?: OnOptions | boolean): this {
        return this._many(event, 1, fn, true, options)
    }

    public many(event: event | eventNS, ttl: number, fn: ListenerFn, options?: OnOptions | boolean): this {
        return this._many(event, ttl, fn, false, options)
    }

    public prependMany(event: event | eventNS, ttl: number, fn: ListenerFn, options?: OnOptions | boolean): this {
        return this._many(event, ttl, fn, true, options)
    }

    protected _many(event: event | eventNS, ttl: number, fn: ListenerFn, prepend: boolean, options?: OnOptions | boolean): this {
        if (typeof fn !== 'function') throw new Error('many only accepts instances of Function')
        const self: this = this
        const listener: Listener = function (this: unknown, ...args: any[]): any {
            if (--ttl === 0) self.off(event, listener)
            return fn.apply(this, args)
        }
        listener._origin = fn
        return this._on(event, listener, prepend, options)
    }

    /**
     * The event of the emitting and of the listeners: the parts of a namespace joined, unless one is a symbol
     * @param type
     */
    protected eventOf(type: any): any {
        if (!this.wildcard || type === 'newListener' || type === 'removeListener' || typeof type !== 'object') return type
        return type.some((part: unknown): boolean => typeof part === 'symbol') ? type : type.join(this.delimiter)
    }

    public emit(type: event | eventNS, ...values: any[]): boolean {
        if (!this._events && !this._all) return false
        if (!this._events) this.init()
        if (type === 'newListener' && !this._newListener && !this._events!.newListener) return false
        const ns: any = type
        type = this.eventOf(type)
        if (this._all && this._all.length) {
            for (const listener of this._all.slice()) {
                this.event = type as string
                //Like upstream: with three values or more, the event as given (not joined)
                listener.call(this, values.length >= 3 ? ns : type as string, ...values)
            }
        }
        let handlers: Listener[] | Listeners | null | undefined
        if (this.wildcard) {
            handlers = []
            this.searchListenerTree(handlers, ns, this.listenerTree, 0)
        } else {
            handlers = this._events![type as string]
            if (typeof handlers === 'function') {
                this.event = type as string
                handlers.apply(this, values)
                return true
            }
            if (handlers) handlers = handlers.slice()
        }
        if (handlers && (handlers as Listener[]).length) {
            for (const handler of handlers as Listener[]) {
                this.event = type as string
                handler.apply(this, values)
            }
            return true
        }
        if (!this.ignoreErrors && !this._all && type === 'error') {
            if (values[0] instanceof Error) throw values[0]
            throw new Error('Uncaught, unspecified \'error\' event.')
        }
        return !!this._all
    }

    public emitAsync(type: event | eventNS, ...values: any[]): Promise<any[]> | false {
        if (!this._events && !this._all) return false
        if (!this._events) this.init()
        if (type === 'newListener' && !this._newListener && !this._events!.newListener) return Promise.resolve([false])
        const ns: any = type
        type = this.eventOf(type)
        const promises: any[] = []
        if (this._all) {
            for (const listener of this._all) {
                this.event = type as string
                promises.push(listener.call(this, values.length >= 3 ? ns : type as string, ...values))
            }
        }
        let handlers: Listener[] | Listeners | null | undefined
        if (this.wildcard) {
            handlers = []
            this.searchListenerTree(handlers, ns, this.listenerTree, 0)
        } else {
            handlers = this._events![type as string]
        }
        if (typeof handlers === 'function') {
            this.event = type as string
            promises.push(handlers.apply(this, values))
        } else if (handlers && handlers.length) {
            for (const handler of handlers.slice()) {
                this.event = type as string
                promises.push(handler.apply(this, values))
            }
        } else if (!this.ignoreErrors && !this._all && type === 'error') {
            return Promise.reject(values[0] instanceof Error ? values[0] : 'Uncaught, unspecified \'error\' event.')
        }
        return Promise.all(promises)
    }

    public on(type: event | eventNS, listener: ListenerFn, options?: OnOptions | boolean): this {
        return this._on(type, listener, false, options)
    }

    public prependListener(type: event | eventNS, listener: ListenerFn, options?: OnOptions | boolean): this {
        return this._on(type, listener, true, options)
    }

    public addListener(type: event | eventNS, listener: ListenerFn, options?: OnOptions | boolean): this {
        return this._on(type, listener, false, options)
    }

    public onAny(fn: EventAndListener): this {
        return this._onAny(fn, false)
    }

    public prependAny(fn: EventAndListener): this {
        return this._onAny(fn, true)
    }

    protected _onAny(fn: EventAndListener, prepend: boolean): this {
        if (typeof fn !== 'function') throw new Error('onAny only accepts instances of Function')
        if (!this._all) this._all = []
        if (prepend) this._all.unshift(fn)
        else this._all.push(fn)
        return this
    }

    protected _on(type: event | eventNS | EventAndListener, listener: ListenerFn, prepend: boolean, options?: OnOptions | boolean): this {
        //A function as the event: a listener of any event
        if (typeof type === 'function') {
            this._onAny(type, !!listener)
            return this
        }
        if (typeof listener !== 'function') throw new Error('on only accepts instances of Function')
        if (!this._events) this.init()
        if (options !== undefined) listener = this.setupListener(listener, options)
        //Emitted before the listener is added (no recursion for newListener)
        if (this._newListener) this.emit('newListener', type, listener)
        if (this.wildcard) {
            this.growListenerTree(type, listener, prepend)
            return this
        }
        const events: Record<string | symbol, Listeners | null> = this._events!
        const key: string | symbol = type as string | symbol
        const existing: Listeners | null | undefined = events[key]
        if (!existing) {
            events[key] = listener
            return this
        }
        const listeners: Listener[] & { warned?: boolean } = typeof existing === 'function' ? [existing] : existing
        events[key] = listeners
        if (prepend) listeners.unshift(listener)
        else listeners.push(listener)
        if (!listeners.warned && this._maxListeners! > 0 && listeners.length > this._maxListeners!) {
            listeners.warned = true
            this.logPossibleMemoryLeak(listeners.length, key)
        }
        return this
    }

    /**
     * Whether a listener is the one given or one of its wrappers
     * @param handler
     * @param listener
     */
    protected isListener(handler: Listener, listener: ListenerFn): boolean {
        return handler === listener || (!!handler.listener && handler.listener === listener) || (!!handler._origin && handler._origin === listener)
    }

    public off(type: event | eventNS, listener: ListenerFn): this {
        if (typeof listener !== 'function') throw new Error('removeListener only takes instances of Function')
        let leafs: TreeNode[] = []
        if (this.wildcard) {
            const ns: any[] = typeof type === 'string' ? type.split(this.delimiter) : (type as any[]).slice()
            const found: TreeNode[] | null = this.searchListenerTree(null, ns, this.listenerTree, 0)
            if (!found) return this
            leafs = found
        } else {
            if (!this._events![type as string]) return this
            leafs.push({_listeners: this._events![type as string]})
        }
        for (const leaf of leafs) {
            const handlers: Listeners | null | undefined = leaf._listeners
            if (Array.isArray(handlers)) {
                const position: number = handlers.findIndex((handler: Listener): boolean => this.isListener(handler, listener))
                if (position < 0) continue
                if (this.wildcard) (leaf._listeners as Listener[]).splice(position, 1)
                else (this._events![type as string] as Listener[]).splice(position, 1)
                if (handlers.length === 0) {
                    if (this.wildcard) delete leaf._listeners
                    else delete this._events![type as string]
                }
                if (this._removeListener) this.emit('removeListener', type, listener)
                return this
            }
            if (handlers && this.isListener(handlers, listener)) {
                if (this.wildcard) delete leaf._listeners
                else delete this._events![type as string]
                if (this._removeListener) this.emit('removeListener', type, listener)
            }
        }
        if (this.listenerTree) this.recursivelyGarbageCollect(this.listenerTree)
        return this
    }

    public removeListener(type: event | eventNS, listener: ListenerFn): this {
        return this.off(type, listener)
    }

    public offAny(fn?: ListenerFn): this {
        if (fn && this._all && this._all.length > 0) {
            const index: number = this._all.indexOf(fn as EventAndListener)
            if (index >= 0) {
                this._all.splice(index, 1)
                if (this._removeListener) this.emit('removeListenerAny', fn)
            }
            return this
        }
        if (this._removeListener) for (const listener of this._all!) this.emit('removeListenerAny', listener)
        this._all = []
        return this
    }

    public removeAllListeners(type?: event | eventNS): this {
        if (type === undefined) {
            if (this._events) this.init()
            return this
        }
        if (this.wildcard) {
            const leafs: TreeNode[] | null = this.searchListenerTree(null, type, this.listenerTree, 0)
            if (!leafs) return this
            for (const leaf of leafs) leaf._listeners = null
            if (this.listenerTree) this.recursivelyGarbageCollect(this.listenerTree)
        } else if (this._events) {
            this._events[type as string] = null
        }
        return this
    }

    public listeners(type?: event | eventNS): ListenerFn[] {
        const events: Record<string | symbol, Listeners | null> | undefined = this._events
        if (type === undefined) {
            if (this.wildcard) throw Error('event name required for wildcard emitter')
            if (!events) return []
            const all: ListenerFn[] = []
            const keys: (string | symbol)[] = ownKeys(events)
            let i: number = keys.length
            while (i-- > 0) {
                const listeners: Listeners | null = events[keys[i]]
                if (typeof listeners === 'function') all.push(listeners)
                else all.push(...listeners!)
            }
            return all
        }
        if (this.wildcard) {
            if (!this.listenerTree) return []
            const handlers: Listener[] = []
            const ns: any[] = typeof type === 'string' ? type.split(this.delimiter) : (type as any[]).slice()
            this.searchListenerTree(handlers, ns, this.listenerTree, 0)
            return handlers
        }
        if (!events) return []
        const listeners: Listeners | null | undefined = events[type as string]
        if (!listeners) return []
        return typeof listeners === 'function' ? [listeners] : listeners
    }

    public eventNames(nsAsArray?: boolean): (event | eventNS)[] {
        if (this.wildcard) return this.collectTreeEvents(this.listenerTree!, [], null, nsAsArray)
        return this._events ? ownKeys(this._events) : []
    }

    public listenerCount(type?: event | eventNS): number {
        return this.listeners(type).length
    }

    public hasListeners(type?: string | String): boolean {
        if (this.wildcard) {
            const handlers: Listener[] = []
            const ns: any[] = typeof type === 'string' ? type.split(this.delimiter) : (type as any).slice()
            this.searchListenerTree(handlers, ns, this.listenerTree, 0)
            return handlers.length > 0
        }
        const events: Record<string | symbol, Listeners | null> | undefined = this._events
        const all: EventAndListener[] | undefined = this._all
        return !!((all && all.length) || (events && (type === undefined ? ownKeys(events).length : events[type as string])))
    }

    public listenersAny(): EventAndListener[] {
        return this._all ? this._all : []
    }

    /**
     * Not in the upstream: the number of the listeners of every event (the listeners of any event excluded)
     */
    public countAllListeners(): number {
        const count = (listeners: Listeners | null | undefined): number => !listeners ? 0 : typeof listeners === 'function' ? 1 : listeners.length
        if (!this.wildcard) return this._events ? ownKeys(this._events).reduce((total: number, key: string | symbol): number => total + count(this._events![key]), 0) : 0
        const countTree = (tree: TreeNode): number => ownKeys(tree).reduce((total: number, key: string | symbol): number => key === '_listeners' ? total + count(tree._listeners) : total + countTree(tree[key]), 0)
        return this.listenerTree ? countTree(this.listenerTree) : 0
    }
}

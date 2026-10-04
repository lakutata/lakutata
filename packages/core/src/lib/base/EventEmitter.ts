import {
    EventEmitter2,
    type ConstructorOptions,
    type EventAndListener,
    type ListenerFn,
    type event,
    type OnOptions
} from './internal/EventEmitter2.js'

export type {event, ListenerFn, EventAndListener, OnOptions}

/**
 * The listeners added by on(), once(), many() and their prepended forms are called asynchronously (after the emitting),
 * their results promised (emitRequest() waits for them); the listeners added by addListener() and onAny() are called
 * synchronously
 */
const onOptions: OnOptions = {
    async: true,
    nextTick: false,
    promisify: true,
    objectify: false
}

export type TEventEmitterOptions = ConstructorOptions

export const DefaultEventEmitterOptions: TEventEmitterOptions = {
    //The wildcards: "*" for a part of the namespace of an event, "**" for any parts
    wildcard: true,
    //The delimiter of the parts of the namespaces
    delimiter: '.',
    //No newListener event
    newListener: false,
    //No removeListener event
    removeListener: false,
    //The number of the listeners of an event above which a possible memory leak is warned of
    maxListeners: 11,
    //The event named in the warning of a possible memory leak
    verboseMemoryLeak: true,
    //An error event without listener is thrown
    ignoreErrors: false
}

/**
 * The name given to the emitter: a symbol is a namespace of one part, the wildcard emitter splitting only the strings
 * @param event
 */
function EventName<T>(event: T): T | symbol[] {
    return typeof event === 'symbol' ? [event] : event
}

export class EventEmitter {

    constructor(options: TEventEmitterOptions = {}) {
        Reflect.defineMetadata(this.constructor.name, new EventEmitter2({...DefaultEventEmitterOptions, ...options}), this)
    }

    public emit(event: string | symbol | event[], ...values: any[]): boolean {
        return Reflect.getMetadata(this.constructor.name, this).emit(EventName(event), ...values)
    }

    public async emitRequest(event: string | symbol | event[], ...values: any[]): Promise<any[]> {
        return Reflect.getMetadata(this.constructor.name, this).emitAsync(EventName(event), ...values)
    }

    public addListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).addListener(EventName(event), listener)
        return this
    }

    public on(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).on(EventName(event), listener, onOptions)
        return this
    }

    public prependListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).prependListener(EventName(event), listener, onOptions)
        return this
    }

    public once(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).once(EventName(event), listener, onOptions)
        return this
    }

    public prependOnceListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).prependOnceListener(EventName(event), listener, onOptions)
        return this
    }

    public many(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).many(EventName(event), timesToListen, listener, onOptions)
        return this
    }

    public prependMany(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).prependMany(EventName(event), timesToListen, listener, onOptions)
        return this
    }

    public onAny(listener: EventAndListener): this {
        Reflect.getMetadata(this.constructor.name, this).onAny(listener)
        return this
    }

    public prependAny(listener: EventAndListener): this {
        Reflect.getMetadata(this.constructor.name, this).prependAny(listener)
        return this
    }

    public offAny(listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).offAny(listener)
        return this
    }

    public removeListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).removeListener(EventName(event), listener)
        return this
    }

    public off(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).off(EventName(event), listener)
        return this
    }

    public removeAllListeners(event?: string | symbol | event[] | undefined): this {
        Reflect.getMetadata(this.constructor.name, this).removeAllListeners(EventName(event))
        return this
    }

    public setMaxListeners(n: number): void {
        return Reflect.getMetadata(this.constructor.name, this).setMaxListeners(n)
    }

    public getMaxListeners(): number {
        return Reflect.getMetadata(this.constructor.name, this).getMaxListeners()
    }

    public eventNames(nsAsArray?: boolean | undefined): (string | symbol | event[])[] {
        const names: (string | symbol | event[])[] = Reflect.getMetadata(this.constructor.name, this).eventNames(nsAsArray)
        //The symbols given back as they were given, unless the namespaces are asked as arrays
        return nsAsArray ? names : names.map((name: string | symbol | event[]): string | symbol | event[] => Array.isArray(name) && name.length === 1 && typeof name[0] === 'symbol' ? name[0] : name)
    }

    public listenerCount(event?: string | symbol | event[] | undefined): number {
        //Without an event, the listeners of every event (2.x threw: an event is required with the wildcards)
        if (event === undefined) return Reflect.getMetadata(this.constructor.name, this).countAllListeners()
        return Reflect.getMetadata(this.constructor.name, this).listenerCount(EventName(event))
    }

    public listeners(event?: string | symbol | event[] | undefined): ListenerFn[] {
        const emitter: EventEmitter2 = Reflect.getMetadata(this.constructor.name, this)
        //Without an event, the listeners of every event (the wildcard emitter requires one)
        if (event === undefined) return emitter.eventNames(true).flatMap((name: string | symbol | event[]): ListenerFn[] => emitter.listeners(name as event[]))
        return emitter.listeners(EventName(event) as event[])
    }

    public listenersAny(): ListenerFn[] {
        //A copy: changing it does not change the listeners
        return [...Reflect.getMetadata(this.constructor.name, this).listenersAny()]
    }

    public hasListeners(event?: string | symbol | event[] | undefined): boolean {
        const emitter: EventEmitter2 = Reflect.getMetadata(this.constructor.name, this)
        //Without an event, whether any event has a listener
        if (event === undefined) return emitter.countAllListeners() > 0
        return emitter.hasListeners(EventName(event) as any).valueOf()
    }
}

/**
 * An emitter calling the listeners added by on() and once() when the event is emitted (the lifecycle of the
 * application: its handlers run before the objects acting once it launched)
 */
export class SynchronousEventEmitter extends EventEmitter {

    public on(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).on(EventName(event), listener)
        return this
    }

    public once(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).once(EventName(event), listener)
        return this
    }
}

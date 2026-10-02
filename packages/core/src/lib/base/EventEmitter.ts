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

export class EventEmitter {

    constructor(options: TEventEmitterOptions = {}) {
        Reflect.defineMetadata(this.constructor.name, new EventEmitter2({...DefaultEventEmitterOptions, ...options}), this)
    }

    public emit(event: string | symbol | event[], ...values: any[]): boolean {
        return Reflect.getMetadata(this.constructor.name, this).emit(event, ...values)
    }

    public async emitRequest(event: string | symbol | event[], ...values: any[]): Promise<any[]> {
        return Reflect.getMetadata(this.constructor.name, this).emitAsync(event, ...values)
    }

    public addListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).addListener(event, listener)
        return this
    }

    public on(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).on(event, listener, onOptions)
        return this
    }

    public prependListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).prependListener(event, listener, onOptions)
        return this
    }

    public once(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).once(event, listener, onOptions)
        return this
    }

    public prependOnceListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).prependOnceListener(event, listener, onOptions)
        return this
    }

    public many(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).many(event, timesToListen, listener, onOptions)
        return this
    }

    public prependMany(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).prependMany(event, timesToListen, listener, onOptions)
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
        Reflect.getMetadata(this.constructor.name, this).removeListener(event, listener)
        return this
    }

    public off(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).off(event, listener)
        return this
    }

    public removeAllListeners(event?: string | symbol | event[] | undefined): this {
        Reflect.getMetadata(this.constructor.name, this).removeAllListeners(event)
        return this
    }

    public setMaxListeners(n: number): void {
        return Reflect.getMetadata(this.constructor.name, this).setMaxListeners(n)
    }

    public getMaxListeners(): number {
        return Reflect.getMetadata(this.constructor.name, this).getMaxListeners()
    }

    public eventNames(nsAsArray?: boolean | undefined): (string | symbol | event[])[] {
        return Reflect.getMetadata(this.constructor.name, this).eventNames(nsAsArray)
    }

    public listenerCount(event?: string | symbol | event[] | undefined): number {
        //Without an event, the listeners of every event (2.x threw: an event is required with the wildcards)
        if (event === undefined) return Reflect.getMetadata(this.constructor.name, this).countAllListeners()
        return Reflect.getMetadata(this.constructor.name, this).listenerCount(event)
    }

    public listeners(event?: string | symbol | event[] | undefined): ListenerFn[] {
        return Reflect.getMetadata(this.constructor.name, this).listeners(event)
    }

    public listenersAny(): ListenerFn[] {
        return Reflect.getMetadata(this.constructor.name, this).listenersAny()
    }

    public hasListeners(event?: String | undefined): boolean {
        return Reflect.getMetadata(this.constructor.name, this).hasListeners(event).valueOf()
    }
}

/**
 * An emitter calling the listeners added by on() and once() when the event is emitted (the lifecycle of the
 * application: its handlers run before the objects acting once it launched)
 */
export class SynchronousEventEmitter extends EventEmitter {

    public on(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).on(event, listener)
        return this
    }

    public once(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).once(event, listener)
        return this
    }
}

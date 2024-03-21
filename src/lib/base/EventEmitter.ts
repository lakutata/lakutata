import {
    EventEmitter2,
    type ConstructorOptions,
    type EventAndListener,
    type ListenerFn,
    type event,
    type OnOptions
} from 'eventemitter2'

const onOptions: OnOptions = {
    async: true,
    nextTick: false,
    promisify: true,
    objectify: false
}

export type TEventEmitterOptions = ConstructorOptions

export const DefaultEventEmitterOptions: TEventEmitterOptions = {
    // set this to `true` to use wildcards
    wildcard: true,
    // the delimiter used to segment namespaces
    delimiter: '.',
    // set this to `true` if you want to emit the newListener event
    newListener: false,
    // set this to `true` if you want to emit the removeListener event
    removeListener: false,
    // the maximum amount of listeners that can be assigned to an event
    maxListeners: 11,
    // show event name in memory leak message when more than maximum amount of listeners is assigned
    verboseMemoryLeak: true,
    // disable throwing uncaughtException if an error event is emitted and it has no listeners
    ignoreErrors: false
}

export class EventEmitter {

    constructor(options: TEventEmitterOptions = {}) {
        Reflect.defineMetadata(this.constructor.name, new EventEmitter2({...DefaultEventEmitterOptions, ...options}), this)
    }

    /**
     * emitter.emit(event | eventNS, [arg1], [arg2], [...])
     * Execute each of the listeners that may be listening for the specified event name in order with the list of arguments.
     * @param event
     * @param values
     */
    public emit(event: string | symbol | event[], ...values: any[]): boolean {
        return Reflect.getMetadata(this.constructor.name, this).emit(event, ...values)
    }

    /**
     * emitter.emitRequest(event | eventNS, [arg1], [arg2], [...])
     * Return the results of the listeners via Promise.all.
     * @param event
     * @param values
     */
    public async emitRequest(event: string | symbol | event[], ...values: any[]): Promise<any[]> {
        return Reflect.getMetadata(this.constructor.name, this).emitAsync(event, ...values)
    }

    /**
     * Adds a listener to the end of the listeners array for the specified event.
     * @param event
     * @param listener
     */
    public addListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).addListener(event, listener)
        return this
    }

    /**
     * Adds a listener to the end of the listeners array for the specified event.
     * @param event
     * @param listener
     */
    public on(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).on(event, listener, onOptions)
        return this
    }

    /**
     * Adds a listener to the beginning of the listeners array for the specified event.
     * @param event
     * @param listener
     */
    public prependListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).prependListener(event, listener, onOptions)
        return this
    }

    /**
     * Adds a one time listener for the event. The listener is invoked only the first time the event is fired, after which it is removed.
     * @param event
     * @param listener
     */
    public once(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).once(event, listener, onOptions)
        return this
    }

    /**
     * Adds a one time listener for the event. The listener is invoked only the first time the event is fired, after which it is removed. The listener is added to the beginning of the listeners array
     * @param event
     * @param listener
     */
    public prependOnceListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).prependOnceListener(event, listener, onOptions)
        return this
    }

    /**
     * Adds a listener that will execute n times for the event before being removed. The listener is invoked only the first n times the event is fired, after which it is removed.
     * @param event
     * @param timesToListen
     * @param listener
     */
    public many(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).many(event, timesToListen, listener, onOptions)
        return this
    }

    /**
     * Adds a listener that will execute n times for the event before being removed. The listener is invoked only the first n times the event is fired, after which it is removed. The listener is added to the beginning of the listeners array.
     * @param event
     * @param timesToListen
     * @param listener
     */
    public prependMany(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).prependMany(event, timesToListen, listener, onOptions)
        return this
    }

    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the callback.
     * @param listener
     */
    public onAny(listener: EventAndListener): this {
        Reflect.getMetadata(this.constructor.name, this).onAny(listener)
        return this
    }

    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the callback. The listener is added to the beginning of the listeners array
     * @param listener
     */
    public prependAny(listener: EventAndListener): this {
        Reflect.getMetadata(this.constructor.name, this).prependAny(listener)
        return this
    }

    /**
     * Removes the listener that will be fired when any event is emitted.
     * @param listener
     */
    public offAny(listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).offAny(listener)
        return this
    }

    /**
     * Remove a specific listener from the listener array for the specified event.
     * @param event
     * @param listener
     */
    public removeListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).removeListener(event, listener)
        return this
    }

    /**
     * emitter.off(event | eventNS, listener)
     * Remove a listener from the listener array for the specified event. Caution: Calling this method changes the array indices in the listener array behind the listener.
     * @param event
     * @param listener
     */
    public off(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).off(event, listener)
        return this
    }

    /**
     * emitter.removeAllListeners([event | eventNS])
     * Removes all listeners, or those of the specified event.
     * @param event
     */
    public removeAllListeners(event?: string | symbol | event[] | undefined): this {
        Reflect.getMetadata(this.constructor.name, this).removeAllListeners(event)
        return this
    }

    /**
     * emitter.setMaxListeners(n)
     * By default EventEmitters will print a warning if more than 10 listeners are added to it. This is a useful default which helps finding memory leaks. Obviously not all Emitters should be limited to 10. This function allows that to be increased. Set to zero for unlimited.
     * @param n
     */
    public setMaxListeners(n: number): void {
        return Reflect.getMetadata(this.constructor.name, this).setMaxListeners(n)
    }

    /**
     * emitter.getMaxListeners()
     * Returns the current max listener value for the EventEmitter which is either set by emitter.setMaxListeners(n)
     */
    public getMaxListeners(): number {
        return Reflect.getMetadata(this.constructor.name, this).getMaxListeners()
    }

    /**
     * emitter.eventNames(nsAsArray)
     * Returns an array listing the events for which the emitter has registered listeners.
     * Listeners order not guaranteed
     * @param nsAsArray
     */
    public eventNames(nsAsArray?: boolean | undefined): (string | symbol | event[])[] {
        return Reflect.getMetadata(this.constructor.name, this).eventNames(nsAsArray)
    }

    /**
     * Returns listener count that are listening for specific event or events
     * @param event
     */
    public listenerCount(event?: string | symbol | event[] | undefined): number {
        return Reflect.getMetadata(this.constructor.name, this).listenerCount(event)
    }

    /**
     * emitter.listeners(event | eventNS)
     * Returns an array of listeners for the specified event. This array can be manipulated, e.g. to remove listeners.
     * @param event
     */
    public listeners(event?: string | symbol | event[] | undefined): ListenerFn[] {
        return Reflect.getMetadata(this.constructor.name, this).listeners(event)
    }

    /**
     * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated, e.g. to remove listeners.
     */
    public listenersAny(): ListenerFn[] {
        return Reflect.getMetadata(this.constructor.name, this).listenersAny()
    }

    /**
     * hasListeners(event | eventNS?:String)
     * Checks whether emitter has any listeners.
     * @param event
     */
    public hasListeners(event?: String | undefined): boolean {
        return Reflect.getMetadata(this.constructor.name, this).hasListeners(event).valueOf()
    }
}

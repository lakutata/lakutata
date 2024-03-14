import {__destroy, __init} from '../base/BaseObject.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {EventEmitter} from '../EventEmitter.js'
import {
    event,
    ListenerFn,
    EventAndListener
} from 'eventemitter2'
import {Provider} from './Provider.js'
import {DefineObjectType, ObjectType} from '../base/internal/ObjectType.js'

/**
 * Component base class
 */
@Singleton()
@DefineObjectType(ObjectType.Component)
export class Component extends Provider implements EventEmitter {

    /**
     * Internal event emitter
     * @private
     */
    #eventEmitter: EventEmitter = new EventEmitter()

    /**
     * Internal initializer
     * @param hooks
     * @protected
     */
    protected async [__init](...hooks: (() => Promise<void>)[]): Promise<void> {
        await super[__init](async (): Promise<void> => {
            //TODO
        }, ...hooks)
    }

    /**
     * Internal destroyer
     * @param hooks
     * @protected
     */
    protected async [__destroy](...hooks: (() => Promise<void>)[]): Promise<void> {
        await super[__destroy](async (): Promise<void> => {
            this.#eventEmitter.removeAllListeners()
        }, ...hooks)
    }

    /**
     * emitter.emit(event | eventNS, [arg1], [arg2], [...])
     * Execute each of the listeners that may be listening for the specified event name in order with the list of arguments.
     * @param event
     * @param values
     */
    public emit(event: string | symbol | event[], ...values: any[]): boolean {
        return this.#eventEmitter.emit(event, ...values)
    }

    /**
     * emitter.emitRequest(event | eventNS, [arg1], [arg2], [...])
     * Return the results of the listeners via Promise.all.
     * @param event
     * @param values
     */
    public async emitRequest(event: string | symbol | event[], ...values: any[]): Promise<any[]> {
        return this.#eventEmitter.emitRequest(event, ...values)
    }

    /**
     * Adds a listener to the end of the listeners array for the specified event.
     * @param event
     * @param listener
     */
    public addListener(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.addListener(event, listener)
        return this
    }

    /**
     * Adds a listener to the end of the listeners array for the specified event.
     * @param event
     * @param listener
     */
    public on(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.on(event, listener)
        return this
    }

    /**
     * Adds a listener to the beginning of the listeners array for the specified event.
     * @param event
     * @param listener
     */
    public prependListener(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.prependListener(event, listener)
        return this
    }

    /**
     * Adds a one time listener for the event. The listener is invoked only the first time the event is fired, after which it is removed.
     * @param event
     * @param listener
     */
    public once(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.once(event, listener)
        return this
    }

    /**
     * Adds a one time listener for the event. The listener is invoked only the first time the event is fired, after which it is removed. The listener is added to the beginning of the listeners array
     * @param event
     * @param listener
     */
    public prependOnceListener(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.prependOnceListener(event, listener)
        return this
    }

    /**
     * Adds a listener that will execute n times for the event before being removed. The listener is invoked only the first n times the event is fired, after which it is removed.
     * @param event
     * @param timesToListen
     * @param listener
     */
    public many(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        this.#eventEmitter.many(event, timesToListen, listener)
        return this
    }

    /**
     * Adds a listener that will execute n times for the event before being removed. The listener is invoked only the first n times the event is fired, after which it is removed. The listener is added to the beginning of the listeners array.
     * @param event
     * @param timesToListen
     * @param listener
     */
    public prependMany(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        this.#eventEmitter.prependMany(event, timesToListen, listener)
        return this
    }

    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the callback.
     * @param listener
     */
    public onAny(listener: EventAndListener): this {
        this.#eventEmitter.onAny(listener)
        return this
    }

    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the callback. The listener is added to the beginning of the listeners array
     * @param listener
     */
    public prependAny(listener: EventAndListener): this {
        this.#eventEmitter.prependAny(listener)
        return this
    }

    /**
     * Removes the listener that will be fired when any event is emitted.
     * @param listener
     */
    public offAny(listener: ListenerFn): this {
        this.#eventEmitter.offAny(listener)
        return this
    }

    /**
     * Remove a specific listener from the listener array for the specified event.
     * @param event
     * @param listener
     */
    public removeListener(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.removeListener(event, listener)
        return this
    }

    /**
     * emitter.off(event | eventNS, listener)
     * Remove a listener from the listener array for the specified event. Caution: Calling this method changes the array indices in the listener array behind the listener.
     * @param event
     * @param listener
     */
    public off(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.off(event, listener)
        return this
    }

    /**
     * emitter.removeAllListeners([event | eventNS])
     * Removes all listeners, or those of the specified event.
     * @param event
     */
    public removeAllListeners(event?: string | symbol | event[] | undefined): this {
        this.#eventEmitter.removeAllListeners(event)
        return this
    }

    /**
     * emitter.setMaxListeners(n)
     * By default EventEmitters will print a warning if more than 10 listeners are added to it. This is a useful default which helps finding memory leaks. Obviously not all Emitters should be limited to 10. This function allows that to be increased. Set to zero for unlimited.
     * @param n
     */
    public setMaxListeners(n: number): void {
        this.#eventEmitter.setMaxListeners(n)
    }

    /**
     * emitter.getMaxListeners()
     * Returns the current max listener value for the EventEmitter which is either set by emitter.setMaxListeners(n)
     */
    public getMaxListeners(): number {
        return this.#eventEmitter.getMaxListeners()
    }

    /**
     * emitter.eventNames(nsAsArray)
     * Returns an array listing the events for which the emitter has registered listeners.
     * Listeners order not guaranteed
     * @param nsAsArray
     */
    public eventNames(nsAsArray?: boolean | undefined): (string | symbol | event[])[] {
        return this.#eventEmitter.eventNames(nsAsArray)
    }

    /**
     * Returns listener count that are listening for specific event or events
     * @param event
     */
    public listenerCount(event?: string | symbol | event[] | undefined): number {
        return this.#eventEmitter.listenerCount(event)
    }

    /**
     * emitter.listeners(event | eventNS)
     * Returns an array of listeners for the specified event. This array can be manipulated, e.g. to remove listeners.
     * @param event
     */
    public listeners(event?: string | symbol | event[] | undefined): ListenerFn[] {
        return this.#eventEmitter.listeners(event)
    }

    /**
     * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated, e.g. to remove listeners.
     */
    public listenersAny(): ListenerFn[] {
        return this.#eventEmitter.listenersAny()
    }

    /**
     * hasListeners(event | eventNS?:String)
     * Checks whether emitter has any listeners.
     * @param event
     */
    public hasListeners(event?: String | undefined): boolean {
        return this.#eventEmitter.hasListeners(event)
    }

    /**
     * Reload self
     */
    public async reload(): Promise<void> {
        await this[__destroy]()
        await this[__init]()
    }
}

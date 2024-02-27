import {BaseObject} from '../base/BaseObject.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {EventEmitter} from '../EventEmitter.js'
import {
    event,
    ListenerFn,
    EventAndListener
} from 'eventemitter2'

/**
 * Component base class
 */
@Singleton()
export class Component extends BaseObject implements EventEmitter {

    #eventEmitter: EventEmitter = new EventEmitter()

    constructor() {
        super()
    }

    public emit(event: string | symbol | event[], ...values: any[]): boolean {
        return this.#eventEmitter.emit(event, ...values)
    }

    public async emitRequest(event: string | symbol | event[], ...values: any[]): Promise<any[]> {
        return this.#eventEmitter.emitRequest(event, ...values)
    }

    public addListener(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.addListener(event, listener)
        return this
    }

    public on(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.on(event, listener)
        return this
    }

    public prependListener(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.prependListener(event, listener)
        return this
    }

    public once(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.once(event, listener)
        return this
    }

    public prependOnceListener(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.prependOnceListener(event, listener)
        return this
    }

    public many(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        this.#eventEmitter.many(event, timesToListen, listener)
        return this
    }

    public prependMany(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        this.#eventEmitter.prependMany(event, timesToListen, listener)
        return this
    }

    public onAny(listener: EventAndListener): this {
        this.#eventEmitter.onAny(listener)
        return this
    }

    public prependAny(listener: EventAndListener): this {
        this.#eventEmitter.prependAny(listener)
        return this
    }

    public offAny(listener: ListenerFn): this {
        this.#eventEmitter.offAny(listener)
        return this
    }

    public removeListener(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.removeListener(event, listener)
        return this
    }

    public off(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.off(event, listener)
        return this
    }

    public removeAllListeners(event?: string | symbol | event[] | undefined): this {
        this.#eventEmitter.removeAllListeners(event)
        return this
    }

    public setMaxListeners(n: number): void {
        this.#eventEmitter.setMaxListeners(n)
    }

    public getMaxListeners(): number {
        return this.#eventEmitter.getMaxListeners()
    }

    public eventNames(nsAsArray?: boolean | undefined): (string | symbol | event[])[] {
        return this.#eventEmitter.eventNames(nsAsArray)
    }

    public listenerCount(event?: string | symbol | event[] | undefined): number {
        return this.#eventEmitter.listenerCount(event)
    }

    public listeners(event?: string | symbol | event[] | undefined): ListenerFn[] {
        return this.#eventEmitter.listeners(event)
    }

    public listenersAny(): ListenerFn[] {
        return this.#eventEmitter.listenersAny()
    }

    public hasListeners(event?: String | undefined): boolean {
        return this.#eventEmitter.hasListeners()
    }
}

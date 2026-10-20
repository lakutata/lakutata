import {EventEmitter} from 'node:events'

/**
 * The options of `addEventListener`.
 */
export interface ListenerOptions {
    /**
     * Remove the listener after its first call.
     */
    once?: boolean
    /**
     * Remove the listener when the signal aborts.
     */
    signal?: AbortSignal
    /**
     * Unused (no capture phase), as in `EventTarget` of Node.js.
     */
    capture?: boolean
}

/**
 * A listener of the `on…` properties and of `addEventListener`.
 */
export type DOMEventListener = (event: any) => void

/**
 * The events of an object, in the two styles of the peer connections and of the channels: the W3C style
 * (`addEventListener`, the `on…` properties, given an event object) and the Node.js style (`on`, given the value of the
 * event)
 */
export class Events {

    readonly #target: EventTarget = new EventTarget()

    readonly #emitter: EventEmitter = new EventEmitter()

    readonly #handlers: Map<string, DOMEventListener> = new Map()

    readonly #owner: object

    /**
     * The events of an object
     * @param owner
     */
    constructor(owner: object) {
        this.#owner = owner
        //More listeners than the warning threshold of Node.js are expected (a channel per peer…)
        this.#emitter.setMaxListeners(0)
    }

    /**
     * Fire an event: the listeners of the W3C style get an event object holding the given properties, the ones of the
     * Node.js style get the arguments
     * @param type
     * @param properties
     * @param args
     */
    public fire(type: string, properties: Record<string, unknown>, ...args: unknown[]): void {
        const event: Event = type === 'message' ? new MessageEvent('message', {data: properties.data}) : new Event(type)
        for (const [key, value] of Object.entries(properties)) {
            if (key !== 'data') Object.defineProperty(event, key, {value: value, enumerable: true})
        }
        Object.defineProperty(event, 'currentTarget', {value: this.#owner})
        this.#target.dispatchEvent(event)
        const handler: DOMEventListener | undefined = this.#handlers.get(type)
        if (handler) handler.call(this.#owner, event)
        //An error without listeners would throw
        if (type !== 'error' || this.#emitter.listenerCount('error')) this.#emitter.emit(type, ...args)
    }

    public addEventListener(type: string, listener: DOMEventListener, options?: boolean | ListenerOptions): void {
        this.#target.addEventListener(type, listener, options)
    }

    public removeEventListener(type: string, listener: DOMEventListener, options?: boolean | ListenerOptions): void {
        this.#target.removeEventListener(type, listener, options)
    }

    public on(type: string, listener: (...args: any[]) => void): void {
        this.#emitter.on(type, listener)
    }

    public once(type: string, listener: (...args: any[]) => void): void {
        this.#emitter.once(type, listener)
    }

    public off(type: string, listener: (...args: any[]) => void): void {
        this.#emitter.off(type, listener)
    }

    public handler(type: string): DOMEventListener | null {
        return this.#handlers.get(type) ?? null
    }

    public setHandler(type: string, handler: DOMEventListener | null): void {
        if (handler) {
            this.#handlers.set(type, handler)
        } else {
            this.#handlers.delete(type)
        }
    }
}

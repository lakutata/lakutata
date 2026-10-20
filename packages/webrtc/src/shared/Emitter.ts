/**
 * The events of an emitter: for each event, the arguments of its listeners.
 */
export type EmitterEvents = Record<string, unknown[]>

/**
 * A listener of an event.
 */
export type EmitterListener<Args extends unknown[]> = (...args: Args) => void

/**
 * A small typed event emitter, the same in the browsers and in Node.js (it does not use `node:events`). A listener
 * throwing does not stop the other listeners: its error is reported as an uncaught one, as the listeners of an
 * `EventTarget` are.
 */
export class Emitter<Events extends EmitterEvents> {

    readonly #listeners: Map<keyof Events, Set<EmitterListener<any>>> = new Map()

    /**
     * Add a listener of an event.
     * @param event The event.
     * @param listener The listener, given the arguments of the event.
     * @returns This emitter.
     */
    public on<Event extends keyof Events>(event: Event, listener: EmitterListener<Events[Event]>): this {
        let listeners: Set<EmitterListener<any>> | undefined = this.#listeners.get(event)
        if (!listeners) {
            listeners = new Set()
            this.#listeners.set(event, listeners)
        }
        listeners.add(listener)
        return this
    }

    /**
     * Add a listener of the next emission of an event only.
     * @param event The event.
     * @param listener The listener, given the arguments of the event.
     * @returns This emitter.
     */
    public once<Event extends keyof Events>(event: Event, listener: EmitterListener<Events[Event]>): this {
        const wrapper: EmitterListener<Events[Event]> = (...args: Events[Event]): void => {
            this.off(event, wrapper)
            listener(...args)
        }
        return this.on(event, wrapper)
    }

    /**
     * Remove a listener of an event.
     * @param event The event.
     * @param listener The listener.
     * @returns This emitter.
     */
    public off<Event extends keyof Events>(event: Event, listener: EmitterListener<Events[Event]>): this {
        this.#listeners.get(event)?.delete(listener)
        return this
    }

    /**
     * Call the listeners of an event
     * @param event
     * @param args
     * @protected
     */
    protected emit<Event extends keyof Events>(event: Event, ...args: Events[Event]): boolean {
        const listeners: Set<EmitterListener<any>> | undefined = this.#listeners.get(event)
        if (!listeners?.size) return false
        for (const listener of [...listeners]) {
            try {
                listener(...args)
            } catch (error) {
                queueMicrotask((): never => {
                    throw error
                })
            }
        }
        return true
    }

    /**
     * Whether an event has listeners
     * @param event
     * @protected
     */
    protected listened(event: keyof Events): boolean {
        return !!this.#listeners.get(event)?.size
    }
}

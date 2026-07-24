import {EventEmitter as NodeEventEmitter} from 'node:events'

//Self-implemented EventEmitter on top of node:events (replaces the CJS-only
//`eventemitter2` dependency, which cannot be named-imported under pure ESM /
//tsc-dual without a bundler). The framework only ever uses simple string event
//names (no wildcard/namespacing is exercised), so node:events is sufficient;
//emitAsync / onAny / many are added on top to match the surface previously used.

export type event = string | symbol
export type ListenerFn = (...values: any[]) => any
export type EventAndListener = (event: string | symbol, ...values: any[]) => any
export type OnOptions = Record<string, any>
export type TEventEmitterOptions = Record<string, any>

export const DefaultEventEmitterOptions: TEventEmitterOptions = {
    maxListeners: 11
}

const coerceEvent = (e: string | symbol | event[]): string | symbol =>
    Array.isArray(e) ? e.join('.') : e

class InternalEventEmitter extends NodeEventEmitter {

    #anyListeners: EventAndListener[] = []

    public onAny(listener: EventAndListener): this {
        this.#anyListeners.push(listener)
        return this
    }

    public prependAny(listener: EventAndListener): this {
        this.#anyListeners.unshift(listener)
        return this
    }

    public offAny(listener: EventAndListener): this {
        this.#anyListeners = this.#anyListeners.filter((l: EventAndListener): boolean => l !== listener)
        return this
    }

    public listenersAny(): EventAndListener[] {
        return this.#anyListeners
    }

    public hasListeners(event?: string | symbol): boolean {
        if (event !== undefined) return this.listenerCount(event) > 0
        return this.eventNames().length > 0 || this.#anyListeners.length > 0
    }

    public emit(event: string, ...values: any[]): boolean {
        for (const listener of [...this.#anyListeners]) listener(event, ...values)
        return super.emit(event, ...values)
    }

    public async emitAsync(event: string, ...values: any[]): Promise<any[]> {
        const results: any[] = []
        for (const listener of [...this.#anyListeners]) results.push(await listener(event, ...values))
        for (const listener of this.listeners(event)) results.push(await listener(...values))
        return results
    }

    public many(event: string, timesToListen: number, listener: ListenerFn): this {
        let remaining: number = timesToListen
        const wrapper: ListenerFn = (...values: any[]): void => {
            listener(...values)
            if (--remaining <= 0) this.removeListener(event, wrapper)
        }
        return this.on(event, wrapper)
    }

    public prependMany(event: string, timesToListen: number, listener: ListenerFn): this {
        let remaining: number = timesToListen
        const wrapper: ListenerFn = (...values: any[]): void => {
            listener(...values)
            if (--remaining <= 0) this.removeListener(event, wrapper)
        }
        return this.prependListener(event, wrapper)
    }
}

export class EventEmitter {

    constructor(options: TEventEmitterOptions = {}) {
        const internal: InternalEventEmitter = new InternalEventEmitter()
        internal.setMaxListeners((options.maxListeners ?? DefaultEventEmitterOptions.maxListeners) as number)
        Reflect.defineMetadata(this.constructor.name, internal, this)
    }

    public emit(event: string | symbol | event[], ...values: any[]): boolean {
        return Reflect.getMetadata(this.constructor.name, this).emit(coerceEvent(event), ...values)
    }

    public async emitRequest(event: string | symbol | event[], ...values: any[]): Promise<any[]> {
        return Reflect.getMetadata(this.constructor.name, this).emitAsync(coerceEvent(event), ...values)
    }

    public addListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).addListener(coerceEvent(event), listener)
        return this
    }

    public on(event: string | symbol | event[], listener: ListenerFn, _onOptions?: OnOptions): this {
        Reflect.getMetadata(this.constructor.name, this).on(coerceEvent(event), listener)
        return this
    }

    public prependListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).prependListener(coerceEvent(event), listener)
        return this
    }

    public once(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).once(coerceEvent(event), listener)
        return this
    }

    public prependOnceListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).prependOnceListener(coerceEvent(event), listener)
        return this
    }

    public many(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).many(coerceEvent(event), timesToListen, listener)
        return this
    }

    public prependMany(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).prependMany(coerceEvent(event), timesToListen, listener)
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

    public offAny(listener: EventAndListener): this {
        Reflect.getMetadata(this.constructor.name, this).offAny(listener)
        return this
    }

    public removeListener(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).removeListener(coerceEvent(event), listener)
        return this
    }

    public off(event: string | symbol | event[], listener: ListenerFn): this {
        Reflect.getMetadata(this.constructor.name, this).off(coerceEvent(event), listener)
        return this
    }

    public removeAllListeners(event?: string | symbol | event[] | undefined): this {
        Reflect.getMetadata(this.constructor.name, this).removeAllListeners(coerceEvent(event as string | symbol | event[]))
        return this
    }

    public setMaxListeners(n: number): void {
        return Reflect.getMetadata(this.constructor.name, this).setMaxListeners(n)
    }

    public getMaxListeners(): number {
        return Reflect.getMetadata(this.constructor.name, this).getMaxListeners()
    }

    public eventNames(_nsAsArray?: boolean | undefined): (string | symbol)[] {
        return Reflect.getMetadata(this.constructor.name, this).eventNames()
    }

    public listenerCount(event?: string | symbol | event[] | undefined): number {
        return Reflect.getMetadata(this.constructor.name, this).listenerCount(event === undefined ? undefined : coerceEvent(event))
    }

    public listeners(event?: string | symbol | event[] | undefined): ListenerFn[] {
        return Reflect.getMetadata(this.constructor.name, this).listeners(event === undefined ? undefined : coerceEvent(event))
    }

    public listenersAny(): ListenerFn[] {
        return Reflect.getMetadata(this.constructor.name, this).listenersAny()
    }

    public hasListeners(event?: string | undefined): boolean {
        return Reflect.getMetadata(this.constructor.name, this).hasListeners(event as string | symbol | undefined)
    }
}

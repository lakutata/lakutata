import {__destroy, __init, __revive} from '../base/BaseObject.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {EventEmitter, type event, type ListenerFn, type EventAndListener} from '../base/EventEmitter.js'
import {Provider} from './Provider.js'
import {DefineObjectType, ObjectType} from '../base/internal/ObjectType.js'
import {getObjectContainer} from '../base/internal/ObjectContainer.js'
import {Container} from './Container.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {DTO} from '../dto/DTO.js'

/**
 * The base class of the components: the long-lived objects shared by the whole application (a logger, a database
 * connection, a cache, an entrypoint). Its lifetime is `@Singleton`, locked: one instance per container registering
 * it, and a subclass declaring another lifetime throws a {@link LifetimeLockedException}.
 *
 * Declare it in the `components` of the application or module options, under a name, with its options; it is created
 * on first request (`@Inject`, `getObject()`), or at launch when its name is listed in `bootstrap`. A component is an
 * event emitter: its events support namespaces (`'order.paid'`) and wildcards (`'order.*'`), and its listeners added
 * by `on()`, `once()`, `many()` and their prepended forms run asynchronously after the emitting. Its listeners are
 * removed at its teardown.
 * @example
 * ```typescript
 * import {Application, Component, Module} from 'lakutata'
 *
 * export class Orders extends Component {
 *     public async pay(id: number): Promise<void> {
 *         //...
 *         this.emit('order.paid', id)
 *     }
 * }
 *
 * Application.run({
 *     id: 'shop.app',
 *     name: 'Shop',
 *     components: {
 *         orders: {class: Orders}
 *     },
 *     bootstrap: [
 *         async (app: Module): Promise<void> => {
 *             const orders: Orders = await app.getObject<Orders>('orders')
 *             orders.on('order.*', (id: number): void => console.log(`Order ${id} changed`))
 *         }
 *     ]
 * })
 * ```
 */
@Singleton(true)
@DefineObjectType(ObjectType.Component)
export class Component extends Provider {

    /**
     * Internal event emitter
     * @private
     */
    #eventEmitter: EventEmitter = new EventEmitter()

    /**
     * The number of listeners of one event above which a possible memory leak is warned of (0: no warning); the
     * listeners are never limited. A subclass gives its own default by an initializer
     * (`protected readonly maxListeners: number = 0`).
     * @default 11
     * @protected
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(11), function (this: Component, maxListeners: number): number {
        this.setMaxListeners(maxListeners)
        return maxListeners
    })
    protected readonly maxListeners: number

    /**
     * The framework's initializer, see {@link BaseObject}; override `init()` instead.
     * @param hooks The steps the framework's subclasses run before `init()`.
     * @returns Resolves once the component is ready.
     * @protected
     */
    protected async [__init](...hooks: (() => Promise<void>)[]): Promise<void> {
        await super[__init](...hooks)
    }

    /**
     * The framework's destroyer, see {@link BaseObject}: it also removes all the listeners; override `beforeDestroy()`
     * and `destroy()` instead.
     * @param hooks The steps the framework's subclasses run before `destroy()`.
     * @returns Resolves once the component is destroyed.
     * @protected
     */
    protected async [__destroy](...hooks: (() => Promise<void>)[]): Promise<void> {
        await super[__destroy](async (): Promise<void> => {
            this.#eventEmitter.removeAllListeners()
        }, ...hooks)
    }

    /**
     * The component's own container: the objects it registers or creates there are destroyed with it.
     * @protected
     */
    protected get container(): Container {
        return getObjectContainer(this)
    }

    /**
     * Create a scope from the component's container (see {@link Container.createScope}), such as one per request:
     * the scoped objects got from it are its own instances. Destroy it once done; it is destroyed with the component
     * otherwise.
     * @returns The new scope.
     * @throws {ObjectDestroyedException} When the component's container has been destroyed.
     * @protected
     */
    protected createScope(): Container {
        return getObjectContainer(this).createScope()
    }

    /**
     * Emit an event: the listeners added by `addListener()` and `onAny()` are called now, in order; the ones added by
     * `on()`, `once()`, `many()` and their prepended forms are scheduled (an error they throw is an unhandled
     * rejection). Use `emitRequest()` to wait for the listeners and their results.
     * @param event The event: a name (`'order.paid'`, the parts separated by dots, with the wildcards `*` for one part
     * and `**` for any parts) or the parts as an array (`['order', 'paid']`). A symbol is an event of
     * its own (matched by the wildcard `*` as a name of one part).
     * @param values The values passed to the listeners.
     * @returns true when the event has listeners.
     * @throws {Error} The error emitted as an `'error'` event which has no listener.
     */
    public emit(event: string | symbol | event[], ...values: any[]): boolean {
        return this.#eventEmitter.emit(event, ...values)
    }

    /**
     * Emit an event and wait for its listeners (the asynchronous ones included).
     * @param event The event: a name (`'order.paid'`, the parts separated by dots, with the wildcards `*` for one part
     * and `**` for any parts) or the parts as an array (`['order', 'paid']`). A symbol is an event of
     * its own (matched by the wildcard `*` as a name of one part).
     * @param values The values passed to the listeners.
     * @returns The results of the listeners, in their order (an empty array without listener).
     * @throws {Error} The first error thrown by a listener, or the error emitted as an `'error'` event which has no
     * listener.
     */
    public async emitRequest(event: string | symbol | event[], ...values: any[]): Promise<any[]> {
        return this.#eventEmitter.emitRequest(event, ...values)
    }

    /**
     * Add a listener called synchronously, at the emitting, after the event's other listeners. Unlike `on()`, its
     * listener runs before `emit()` returns.
     * @param event The event: a name (`'order.paid'`, the parts separated by dots, with the wildcards `*` for one part
     * and `**` for any parts) or the parts as an array (`['order', 'paid']`). A symbol is an event of
     * its own (matched by the wildcard `*` as a name of one part).
     * @param listener The function called with the event's values.
     * @returns The component, for chaining.
     */
    public addListener(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.addListener(event, listener)
        return this
    }

    /**
     * Add a listener, after the event's other listeners.
     * @param event The event: a name (`'order.paid'`, the parts separated by dots, with the wildcards `*` for one part
     * and `**` for any parts) or the parts as an array (`['order', 'paid']`). A symbol is an event of
     * its own (matched by the wildcard `*` as a name of one part).
     * @param listener The function called with the event's values, asynchronously after the emitting (in a later turn of
     * the event loop); its result (or the promise it returns) is collected by `emitRequest()`.
     * @returns The component, for chaining.
     */
    public on(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.on(event, listener)
        return this
    }

    /**
     * Add a listener before the event's other listeners.
     * @param event The event: a name (`'order.paid'`, the parts separated by dots, with the wildcards `*` for one part
     * and `**` for any parts) or the parts as an array (`['order', 'paid']`). A symbol is an event of
     * its own (matched by the wildcard `*` as a name of one part).
     * @param listener The function called with the event's values, asynchronously after the emitting (in a later turn of
     * the event loop); its result (or the promise it returns) is collected by `emitRequest()`.
     * @returns The component, for chaining.
     */
    public prependListener(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.prependListener(event, listener)
        return this
    }

    /**
     * Add a listener called for the event's next emitting only, then removed.
     * @param event The event: a name (`'order.paid'`, the parts separated by dots, with the wildcards `*` for one part
     * and `**` for any parts) or the parts as an array (`['order', 'paid']`). A symbol is an event of
     * its own (matched by the wildcard `*` as a name of one part).
     * @param listener The function called with the event's values, asynchronously after the emitting (in a later turn of
     * the event loop); its result (or the promise it returns) is collected by `emitRequest()`.
     * @returns The component, for chaining.
     */
    public once(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.once(event, listener)
        return this
    }

    /**
     * Add a listener called for the event's next emitting only, then removed; it is placed before the event's other
     * listeners.
     * @param event The event: a name (`'order.paid'`, the parts separated by dots, with the wildcards `*` for one part
     * and `**` for any parts) or the parts as an array (`['order', 'paid']`). A symbol is an event of
     * its own (matched by the wildcard `*` as a name of one part).
     * @param listener The function called with the event's values, asynchronously after the emitting (in a later turn of
     * the event loop); its result (or the promise it returns) is collected by `emitRequest()`.
     * @returns The component, for chaining.
     */
    public prependOnceListener(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.prependOnceListener(event, listener)
        return this
    }

    /**
     * Add a listener called for the event's next emittings, then removed.
     * @param event The event: a name (`'order.paid'`, the parts separated by dots, with the wildcards `*` for one part
     * and `**` for any parts) or the parts as an array (`['order', 'paid']`). A symbol is an event of
     * its own (matched by the wildcard `*` as a name of one part).
     * @param timesToListen The number of emittings the listener is called for.
     * @param listener The function called with the event's values, asynchronously after the emitting (in a later turn of
     * the event loop); its result (or the promise it returns) is collected by `emitRequest()`.
     * @returns The component, for chaining.
     */
    public many(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        this.#eventEmitter.many(event, timesToListen, listener)
        return this
    }

    /**
     * Add a listener called for the event's next emittings, then removed; it is placed before the event's other
     * listeners.
     * @param event The event: a name (`'order.paid'`, the parts separated by dots, with the wildcards `*` for one part
     * and `**` for any parts) or the parts as an array (`['order', 'paid']`). A symbol is an event of
     * its own (matched by the wildcard `*` as a name of one part).
     * @param timesToListen The number of emittings the listener is called for.
     * @param listener The function called with the event's values, asynchronously after the emitting (in a later turn of
     * the event loop); its result (or the promise it returns) is collected by `emitRequest()`.
     * @returns The component, for chaining.
     */
    public prependMany(event: string | symbol | event[], timesToListen: number, listener: ListenerFn): this {
        this.#eventEmitter.prependMany(event, timesToListen, listener)
        return this
    }

    /**
     * Add a listener of every event, called synchronously at the emitting, before the event's own listeners.
     * @param listener The function called with the event name, then the event's values.
     * @returns The component, for chaining.
     */
    public onAny(listener: EventAndListener): this {
        this.#eventEmitter.onAny(listener)
        return this
    }

    /**
     * Add a listener of every event, before the other listeners of every event, called synchronously at the emitting.
     * @param listener The function called with the event name, then the event's values.
     * @returns The component, for chaining.
     */
    public prependAny(listener: EventAndListener): this {
        this.#eventEmitter.prependAny(listener)
        return this
    }

    /**
     * Remove a listener of every event added by `onAny()` or `prependAny()`.
     * @param listener The listener to remove.
     * @returns The component, for chaining.
     */
    public offAny(listener: ListenerFn): this {
        this.#eventEmitter.offAny(listener)
        return this
    }

    /**
     * Remove a listener of an event, as `off()`.
     * @param event The event the listener was added for.
     * @param listener The listener to remove.
     * @returns The component, for chaining.
     */
    public removeListener(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.removeListener(event, listener)
        return this
    }

    /**
     * Remove a listener of an event; nothing happens when it was not added.
     * @param event The event the listener was added for.
     * @param listener The listener to remove.
     * @returns The component, for chaining.
     */
    public off(event: string | symbol | event[], listener: ListenerFn): this {
        this.#eventEmitter.off(event, listener)
        return this
    }

    /**
     * Remove the listeners of an event, or all the listeners.
     * @param event The event whose listeners are removed; all the listeners when omitted.
     * @returns The component, for chaining.
     */
    public removeAllListeners(event?: string | symbol | event[] | undefined): this {
        this.#eventEmitter.removeAllListeners(event)
        return this
    }

    /**
     * Set the number of listeners of one event above which a possible memory leak is warned of (the
     * `maxListeners` option, 11 by default); the listeners are never limited.
     * @param n The number, 0 for no warning.
     */
    public setMaxListeners(n: number): void {
        this.#eventEmitter.setMaxListeners(n)
    }

    /**
     * The number of listeners of one event above which a possible memory leak is warned of.
     * @returns The number, 0 for no warning.
     */
    public getMaxListeners(): number {
        return this.#eventEmitter.getMaxListeners()
    }

    /**
     * The events having listeners, in no guaranteed order.
     * @param nsAsArray Return each namespaced event as the array of its parts (`['order', 'paid']`) instead of its
     * name (`'order.paid'`); false by default.
     * @returns The events.
     */
    public eventNames(nsAsArray?: boolean | undefined): (string | symbol | event[])[] {
        return this.#eventEmitter.eventNames(nsAsArray)
    }

    /**
     * The number of listeners of an event (the wildcard listeners matching it included), or of every event (the
     * listeners of `onAny()` excluded).
     * @param event The event name or its parts as an array; every event when omitted.
     * @returns The number of listeners.
     */
    public listenerCount(event?: string | symbol | event[] | undefined): number {
        return this.#eventEmitter.listenerCount(event)
    }

    /**
     * The listeners of an event, or of every event.
     * @param event The event name (the wildcard listeners matching it included), its parts as an array, or a symbol;
     * every event when omitted (the listeners of `onAny()` excluded).
     * @returns A copy of the listeners; changing it does not change the listeners.
     */
    public listeners(event?: string | symbol | event[] | undefined): ListenerFn[] {
        return this.#eventEmitter.listeners(event)
    }

    /**
     * The listeners of every event, added by `onAny()` and `prependAny()`.
     * @returns A copy of these listeners; changing it does not change the listeners.
     */
    public listenersAny(): ListenerFn[] {
        return this.#eventEmitter.listenersAny()
    }

    /**
     * Whether an event has listeners (the wildcard listeners matching it included; the listeners of `onAny()`
     * excluded).
     * @param event The event name, its parts as an array, or a symbol; any event when omitted.
     * @returns true when there are listeners.
     */
    public hasListeners(event?: string | symbol | event[] | undefined): boolean {
        return this.#eventEmitter.hasListeners(event)
    }

    /**
     * Destroy the component and initialize it again (same instance): its dependencies are injected again and its
     * `init()` runs again; its listeners are removed by the teardown. Its configured values are kept.
     * @returns Resolves once the component is ready again.
     * @throws {ObjectDestroyedException} When its parent has been destroyed.
     * @throws {Error} The error of its teardown or of its initialization.
     */
    public async reload(): Promise<void> {
        await this[__destroy]()
        this[__revive]()
        await this[__init]()
    }
}

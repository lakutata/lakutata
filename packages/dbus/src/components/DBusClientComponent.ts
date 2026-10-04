import {
    BusNameBasicInfo,
    DBus,
    DBusInterface,
    DBusMessage,
    DBusObject,
    DBusService,
    DBusSignalEmitter,
    InvokeOpts,
    ServiceBasicInfo
} from 'dbus-sdk'
import {Component, DTO, type ComponentOptions, type ComponentOptionsBuilder} from '@lakutata/core'
import type {DBusClientOptions} from '../lib/DBusClientOptions.js'
import {Configurable} from '@lakutata/core/decorator/di'

/**
 * Build the declaration of a {@link DBusClientComponent} for the `components` of an application or a module, from its
 * typed options.
 * @param options The bus address and the connection options.
 * @returns The declaration: the options with `class: DBusClientComponent`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildDBusClientOptions, DBusClientComponent} from '@lakutata/dbus'
 *
 * Application
 *     .run(() => ({
 *         id: 'client.app',
 *         name: 'Client',
 *         components: {
 *             dbus: buildDBusClientOptions({busAddress: 'unix:path=/var/run/dbus/system_bus_socket', timeout: 5000})
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const dbus: DBusClientComponent = await app.getObject('dbus')
 *         console.log(await dbus.listNames())
 *     })
 * ```
 */
export const buildDBusClientOptions: ComponentOptionsBuilder<DBusClientOptions> = (options: DBusClientOptions): ComponentOptions<DBusClientOptions> => ({
    class: DBusClientComponent,
    busAddress: options.busAddress,
    timeout: options.timeout,
    advancedResponse: options.advancedResponse,
    convertBigIntToNumber: options.convertBigIntToNumber
})

/**
 * A D-Bus client: a connection to a bus, to call the services on it, read their objects, properties and introspection,
 * and listen to their signals. Declare it in the `components` of an application with {@link buildDBusClientOptions}
 * (or `{class: DBusClientComponent, busAddress: …}`) and get it with `getObject()` or `@Inject`; it is a singleton
 * component. It connects when it is created, so a bus that cannot be reached fails its creation; it disconnects when it
 * is destroyed (the application stopping). It is a thin layer over the `DBus` connection of `dbus-sdk`, whose classes
 * (`DBusService`, `DBusObject`, `DBusRemoteInterface`…) its methods return.
 *
 * Its `on`, `once`, `off` and `removeListener` listen to the connection's events (`'NameOwnerChanged'`,
 * `'connectionClose'`…), not to events of the component.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {DBusClientComponent, type DBusRemoteInterface} from '@lakutata/dbus'
 *
 * Application
 *     .run(() => ({
 *         id: 'client.app',
 *         name: 'Client',
 *         components: {
 *             dbus: {class: DBusClientComponent, busAddress: 'unix:path=/var/run/dbus/system_bus_socket'}
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const dbus: DBusClientComponent = await app.getObject('dbus')
 *         //A method call: the output arguments, as an array
 *         const [owner] = await dbus.invoke({
 *             service: 'org.freedesktop.DBus',
 *             objectPath: '/org/freedesktop/DBus',
 *             interface: 'org.freedesktop.DBus',
 *             method: 'GetNameOwner',
 *             signature: 's',
 *             args: ['org.freedesktop.DBus']
 *         })
 *         console.log(owner)
 *         //An interface, from the introspection of its object: its methods, properties and signals
 *         const device: DBusRemoteInterface = await dbus.interface('com.example.DeviceService', '/com/example/Devices/A1', 'com.example.Device')
 *         console.log(await device.method.Status({sn: 'A1'}))
 *         console.log(await device.property.State.get())
 *         device.signal.on('Changed', (data: unknown): void => console.log(data))
 *         dbus.on('NameOwnerChanged', (name: string, oldOwner: string, newOwner: string): void => console.log(name, oldOwner, newOwner))
 *     })
 * ```
 */
export class DBusClientComponent extends Component {

    /**
     * The address of the bus: `'unix:path=/var/run/dbus/system_bus_socket'` (the system bus),
     * `'unix:path=/run/user/1000/bus'`, `'tcp:host=127.0.0.1,port=5555'`; the value of `DBUS_SESSION_BUS_ADDRESS` for
     * the session bus. Required.
     */
    @Configurable(DTO.String().required())
    protected readonly busAddress: string

    /**
     * How long the connection to the bus may take, in milliseconds (a positive integer); the creation of the component
     * fails after it.
     * @default 20000 (dbus-sdk's default)
     */
    @Configurable(DTO.Number().positive().integer().optional())
    protected readonly timeout: number

    /**
     * Return the replies as `dbus-sdk` typed values (`DBusSignedValue`, which keep their D-Bus types) instead of plain
     * JavaScript values.
     * @default false
     */
    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly advancedResponse: boolean

    /**
     * Convert the 64-bit integers of the replies (`x`, `t`) from `bigint` to `number`; the values beyond 2^53 lose
     * precision.
     * @default true
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly convertBigIntToNumber: boolean

    /**
     * The `dbus-sdk` connection to the bus, open from the component's creation to its destruction; the subclasses use
     * it for what the component's methods do not cover.
     */
    protected dbus: DBus

    /**
     * The unique name the bus gave this connection (`':1.42'`).
     */
    public get uniqueName(): string {
        return this.dbus.uniqueName
    }

    /**
     * Connect to the bus, when the component is created.
     * @throws {Error} When the bus cannot be reached, or the authentication fails.
     */
    protected async init(): Promise<void> {
        this.dbus = await DBus.connect({
            busAddress: this.busAddress,
            timeout: this.timeout,
            advancedResponse: this.advancedResponse,
            convertBigIntToNumber: this.convertBigIntToNumber
        })
    }

    /**
     * Disconnect from the bus, when the component is destroyed.
     */
    protected async destroy(): Promise<void> {
        await this.dbus.disconnect()
    }

    /**
     * Call a method without waiting for its reply (the call is flagged as expecting none): its errors are not reported.
     * @param opts The service, the object path, the interface and the method to call, with the signature and the
     * arguments of the call.
     * @param noReply `true`.
     */
    public invoke(opts: InvokeOpts, noReply: true): void
    /**
     * Call a method and wait for its reply.
     * @param opts The service, the object path, the interface and the method to call, with the signature (`'sa{sv}'`)
     * and the arguments of the call.
     * @param noReply `false`.
     * @returns The output arguments of the method, in order (an empty array for a method returning nothing).
     * @throws {Error} When the method replies with a D-Bus error (its name and message), or the connection fails.
     */
    public async invoke(opts: InvokeOpts, noReply: false): Promise<any[]>
    /**
     * Call a method and wait for its reply.
     * @param opts The service, the object path, the interface and the method to call, with the signature (`'sa{sv}'`)
     * and the arguments of the call.
     * @returns The output arguments of the method, in order (an empty array for a method returning nothing).
     * @throws {Error} When the method replies with a D-Bus error (its name and message), or the connection fails.
     */
    public async invoke(opts: InvokeOpts): Promise<any[]>
    public invoke(opts: InvokeOpts, noReply: boolean = false): Promise<any[]> | void {
        if (noReply) return this.dbus.invoke(opts, true)
        return this.dbus.invoke(opts, false)
    }

    /**
     * Listen to the connection's `'online'` event, emitted when a bus name gets an owner (a service comes online):
     * the listener is called every time it is emitted.
     * @param eventName The event, `'online'`.
     * @param listener The listener; its arguments: the bus name.
     * @returns The component, for chaining.
     */
    public on(eventName: 'online', listener: (name: string) => void): this
    /**
     * Listen to the connection's `'offline'` event, emitted when a service name loses its owner (the service goes
     * offline): the listener is called every time it is emitted.
     * @param eventName The event, `'offline'`.
     * @param listener The listener; its arguments: the bus name.
     * @returns The component, for chaining.
     */
    public on(eventName: 'offline', listener: (name: string) => void): this
    /**
     * Listen to the connection's `'replaced'` event, emitted when the owner of a service name changes from one
     * connection to another: the listener is called every time it is emitted.
     * @param eventName The event, `'replaced'`.
     * @param listener The listener; its arguments: the bus name.
     * @returns The component, for chaining.
     */
    public on(eventName: 'replaced', listener: (name: string) => void): this
    /**
     * Listen to the connection's `'methodCall'` event, emitted when a method call addressed to this connection is
     * received: the listener is called every time it is emitted.
     * @param eventName The event, `'methodCall'`.
     * @param listener The listener; its arguments: the message of the call.
     * @returns The component, for chaining.
     */
    public on(eventName: 'methodCall', listener: (message: DBusMessage) => void): this
    /**
     * Listen to the connection's `'NameOwnerChanged'` event, emitted when the bus announces that the owner of a name
     * changed (an empty owner means none): the listener is called every time it is emitted.
     * @param eventName The event, `'NameOwnerChanged'`.
     * @param listener The listener; its arguments: the name, its previous owner and its new owner (unique names).
     * @returns The component, for chaining.
     */
    public on(eventName: 'NameOwnerChanged', listener: (name: string, oldOwner: string, newOwner: string) => void): this
    /**
     * Listen to the connection's `'NameLost'` event, emitted when this connection loses a name it owned: the listener is
     * called every time it is emitted.
     * @param eventName The event, `'NameLost'`.
     * @param listener The listener; its arguments: the name lost.
     * @returns The component, for chaining.
     */
    public on(eventName: 'NameLost', listener: (name: string) => void): this
    /**
     * Listen to the connection's `'NameAcquired'` event, emitted when this connection acquires a name (its unique name
     * at least, when it connects): the listener is called every time it is emitted.
     * @param eventName The event, `'NameAcquired'`.
     * @param listener The listener; its arguments: the name acquired.
     * @returns The component, for chaining.
     */
    public on(eventName: 'NameAcquired', listener: (name: string) => void): this
    /**
     * Listen to the connection's `'connectionClose'` event, emitted when the connection to the bus closes: the listener
     * is called every time it is emitted.
     * @param eventName The event, `'connectionClose'`.
     * @param listener The listener, called with no argument.
     * @returns The component, for chaining.
     */
    public on(eventName: 'connectionClose', listener: () => void): this
    /**
     * Listen to the connection's `'connectionError'` event, emitted when an error occurs on the connection to the bus:
     * the listener is called every time it is emitted.
     * @param eventName The event, `'connectionError'`.
     * @param listener The listener; its arguments: the error.
     * @returns The component, for chaining.
     */
    public on(eventName: 'connectionError', listener: (error: Error) => void): this
    public on(eventName: string, listener: (...args: any[]) => void): this {
        this.dbus.on(eventName, listener)
        return this
    }

    /**
     * Listen once to the connection's `'online'` event, emitted when a service name gets an owner (the service comes
     * online): the listener is called the next time it is emitted.
     * @param eventName The event, `'online'`.
     * @param listener The listener; its arguments: the bus name.
     * @returns The component, for chaining.
     */
    public once(eventName: 'online', listener: (name: string) => void): this
    /**
     * Listen once to the connection's `'offline'` event, emitted when a service name loses its owner (the service goes
     * offline): the listener is called the next time it is emitted.
     * @param eventName The event, `'offline'`.
     * @param listener The listener; its arguments: the bus name.
     * @returns The component, for chaining.
     */
    public once(eventName: 'offline', listener: (name: string) => void): this
    /**
     * Listen once to the connection's `'replaced'` event, emitted when the owner of a service name changes from one
     * connection to another: the listener is called the next time it is emitted.
     * @param eventName The event, `'replaced'`.
     * @param listener The listener; its arguments: the bus name.
     * @returns The component, for chaining.
     */
    public once(eventName: 'replaced', listener: (name: string) => void): this
    /**
     * Listen once to the connection's `'methodCall'` event, emitted when a method call addressed to this connection is
     * received: the listener is called the next time it is emitted.
     * @param eventName The event, `'methodCall'`.
     * @param listener The listener; its arguments: the message of the call.
     * @returns The component, for chaining.
     */
    public once(eventName: 'methodCall', listener: (message: DBusMessage) => void): this
    /**
     * Listen once to the connection's `'NameOwnerChanged'` event, emitted when the bus announces that the owner of a
     * name changed (an empty owner means none): the listener is called the next time it is emitted.
     * @param eventName The event, `'NameOwnerChanged'`.
     * @param listener The listener; its arguments: the name, its previous owner and its new owner (unique names).
     * @returns The component, for chaining.
     */
    public once(eventName: 'NameOwnerChanged', listener: (name: string, oldOwner: string, newOwner: string) => void): this
    /**
     * Listen once to the connection's `'NameLost'` event, emitted when this connection loses a name it owned: the
     * listener is called the next time it is emitted.
     * @param eventName The event, `'NameLost'`.
     * @param listener The listener; its arguments: the name lost.
     * @returns The component, for chaining.
     */
    public once(eventName: 'NameLost', listener: (name: string) => void): this
    /**
     * Listen once to the connection's `'NameAcquired'` event, emitted when this connection acquires a name (its unique
     * name at least, when it connects): the listener is called the next time it is emitted.
     * @param eventName The event, `'NameAcquired'`.
     * @param listener The listener; its arguments: the name acquired.
     * @returns The component, for chaining.
     */
    public once(eventName: 'NameAcquired', listener: (name: string) => void): this
    /**
     * Listen once to the connection's `'connectionClose'` event, emitted when the connection to the bus closes: the
     * listener is called the next time it is emitted.
     * @param eventName The event, `'connectionClose'`.
     * @param listener The listener, called with no argument.
     * @returns The component, for chaining.
     */
    public once(eventName: 'connectionClose', listener: () => void): this
    /**
     * Listen once to the connection's `'connectionError'` event, emitted when an error occurs on the connection to the
     * bus: the listener is called the next time it is emitted.
     * @param eventName The event, `'connectionError'`.
     * @param listener The listener; its arguments: the error.
     * @returns The component, for chaining.
     */
    public once(eventName: 'connectionError', listener: (error: Error) => void): this
    public once(eventName: string, listener: (...args: any[]) => void): this {
        this.dbus.once(eventName, listener)
        return this
    }

    /**
     * Stop listening to the connection's `'online'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'online'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining.
     */
    public off(eventName: 'online', listener: (name: string) => void): this
    /**
     * Stop listening to the connection's `'offline'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'offline'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining.
     */
    public off(eventName: 'offline', listener: (name: string) => void): this
    /**
     * Stop listening to the connection's `'replaced'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'replaced'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining.
     */
    public off(eventName: 'replaced', listener: (name: string) => void): this
    /**
     * Stop listening to the connection's `'methodCall'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'methodCall'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining.
     */
    public off(eventName: 'methodCall', listener: (message: DBusMessage) => void): this
    /**
     * Stop listening to the connection's `'NameOwnerChanged'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'NameOwnerChanged'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining.
     */
    public off(eventName: 'NameOwnerChanged', listener: (name: string, oldOwner: string, newOwner: string) => void): this
    /**
     * Stop listening to the connection's `'NameLost'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'NameLost'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining.
     */
    public off(eventName: 'NameLost', listener: (name: string) => void): this
    /**
     * Stop listening to the connection's `'NameAcquired'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'NameAcquired'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining.
     */
    public off(eventName: 'NameAcquired', listener: (name: string) => void): this
    /**
     * Stop listening to the connection's `'connectionClose'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'connectionClose'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining.
     */
    public off(eventName: 'connectionClose', listener: () => void): this
    /**
     * Stop listening to the connection's `'connectionError'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'connectionError'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining.
     */
    public off(eventName: 'connectionError', listener: (error: Error) => void): this
    public off(eventName: string, listener: (...args: any[]) => void): this {
        this.dbus.off(eventName, listener)
        return this
    }

    /**
     * Stop listening to the connection's `'online'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'online'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining (same as `off`).
     */
    public removeListener(eventName: 'online', listener: (name: string) => void): this
    /**
     * Stop listening to the connection's `'offline'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'offline'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining (same as `off`).
     */
    public removeListener(eventName: 'offline', listener: (name: string) => void): this
    /**
     * Stop listening to the connection's `'replaced'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'replaced'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining (same as `off`).
     */
    public removeListener(eventName: 'replaced', listener: (name: string) => void): this
    /**
     * Stop listening to the connection's `'methodCall'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'methodCall'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining (same as `off`).
     */
    public removeListener(eventName: 'methodCall', listener: (message: DBusMessage) => void): this
    /**
     * Stop listening to the connection's `'NameOwnerChanged'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'NameOwnerChanged'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining (same as `off`).
     */
    public removeListener(eventName: 'NameOwnerChanged', listener: (name: string, oldOwner: string, newOwner: string) => void): this
    /**
     * Stop listening to the connection's `'NameLost'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'NameLost'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining (same as `off`).
     */
    public removeListener(eventName: 'NameLost', listener: (name: string) => void): this
    /**
     * Stop listening to the connection's `'NameAcquired'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'NameAcquired'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining (same as `off`).
     */
    public removeListener(eventName: 'NameAcquired', listener: (name: string) => void): this
    /**
     * Stop listening to the connection's `'connectionClose'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'connectionClose'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining (same as `off`).
     */
    public removeListener(eventName: 'connectionClose', listener: () => void): this
    /**
     * Stop listening to the connection's `'connectionError'` event: remove a listener added with `on` or `once`.
     * @param eventName The event, `'connectionError'`.
     * @param listener The listener to remove, as it was added.
     * @returns The component, for chaining (same as `off`).
     */
    public removeListener(eventName: 'connectionError', listener: (error: Error) => void): this
    public removeListener(eventName: string, listener: (...args: any[]) => void): this {
        this.dbus.removeListener(eventName, listener)
        return this
    }

    /**
     * Ask the bus to route the messages matching a rule to this connection, without waiting for the bus's answer (the
     * signal emitters of {@link interface} and {@link interfaceSignal} add their own rules).
     * @param rule The match rule (`"type='signal',interface='com.example.Device'"`).
     */
    public addMatch(rule: string): void {
        return this.dbus.addMatch(rule)
    }

    /**
     * Remove a match rule added with {@link addMatch}, without waiting for the bus's answer.
     * @param rule The match rule, as it was added.
     */
    public removeMatch(rule: string): void {
        return this.dbus.removeMatch(rule)
    }

    /**
     * Get the connection owning a name.
     * @param name The bus name (`'com.example.DeviceService'`).
     * @returns The unique name of its owner (`':1.42'`), or `undefined` when nobody owns it or the query fails.
     */
    public async getNameOwner(name: string): Promise<string | undefined> {
        return this.dbus.getNameOwner(name)
    }

    /**
     * List the names the bus can start a service for (D-Bus activation), running or not.
     * @returns The names.
     */
    public async listActivatableNames(): Promise<string[]> {
        return this.dbus.listActivatableNames()
    }

    /**
     * List the names owned on the bus now: the well-known names and the unique names of the connections.
     * @returns The names.
     */
    public async listNames(): Promise<string[]> {
        return this.dbus.listNames()
    }

    /**
     * Tell whether a name is owned on the bus now.
     * @param name The bus name.
     * @returns `true` when a connection owns it.
     */
    public async nameHasOwner(name: string): Promise<boolean> {
        return this.dbus.nameHasOwner(name)
    }

    /**
     * List the names of the bus, owned or activatable, with their owner, whether they are active or activatable, and the
     * process id of their owner.
     * @returns The names and their details.
     */
    public async listBusNames(): Promise<BusNameBasicInfo[]> {
        return this.dbus.listBusNames()
    }

    /**
     * List the services of the bus: its well-known names (the unique names `:1.42` left out), with their details.
     * @returns The services and their details.
     */
    public async listServices(): Promise<ServiceBasicInfo[]> {
        return this.dbus.listServices()
    }

    /**
     * Get every service of the bus, to browse their objects.
     * @returns The services.
     */
    public async services(): Promise<DBusService[]> {
        return this.dbus.getServices()
    }

    /**
     * Get a service, starting it when it is activatable and not running.
     * @param service The service's well-known name (`'org.freedesktop.NetworkManager'`).
     * @returns The service.
     * @throws {Error} A `ServiceNotFoundError` of `dbus-sdk` when the name is neither owned nor activatable.
     */
    public async service(service: string): Promise<DBusService> {
        return this.dbus.getService(service)
    }

    /**
     * Get an object of a service, to read its introspection and its interfaces.
     * @param service The service's well-known name.
     * @param objectPath The object path (`'/org/freedesktop/NetworkManager'`).
     * @returns The object.
     * @throws {Error} A `ServiceNotFoundError` of `dbus-sdk` when the service is neither running nor activatable.
     */
    public async object(service: string, objectPath: string): Promise<DBusObject> {
        return this.dbus.getObject(service, objectPath)
    }

    /**
     * Get an interface of an object, built from the object's introspection: its methods (`method.Name(...args)`, or
     * `noReplyMethod`), its properties (`property.Name.get()`, `.set(value)`) and its signals (`signal.on('Name', …)`).
     * @param service The service's well-known name.
     * @param objectPath The object path.
     * @param iface The interface name (`'org.freedesktop.NetworkManager'`).
     * @returns The interface.
     * @throws {Error} When the service is not found, or the object does not implement the interface
     * (`InterfaceNotFoundError` of `dbus-sdk`).
     */
    public async interface(service: string, objectPath: string, iface: string): Promise<DBusInterface> {
        return this.dbus.getInterface(service, objectPath, iface)
    }

    /**
     * Get the signals of an interface of an object: an event emitter emitting each signal under its name, with its
     * arguments.
     * @param service The service's well-known name.
     * @param objectPath The object path.
     * @param iface The interface name.
     * @returns The emitter of the interface's signals.
     * @throws {Error} When the service is not found, or the object does not implement the interface
     * (`InterfaceNotFoundError` of `dbus-sdk`).
     */
    public async interfaceSignal(service: string, objectPath: string, iface: string): Promise<DBusSignalEmitter> {
        const dbusIface: DBusInterface = await this.dbus.getInterface(service, objectPath, iface)
        return dbusIface.signal
    }
}
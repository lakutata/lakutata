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
import {Component, DTO, type ProviderOptions, type ProviderOptionsBuilder} from '@lakutata/core'
import type {DBusClientOptions} from '../lib/DBusClientOptions.js'
import {Configurable} from '@lakutata/core/decorator/di'

export const buildDBusClientOptions: ProviderOptionsBuilder<DBusClientOptions> = (options: DBusClientOptions): ProviderOptions<DBusClientOptions> => ({
    class: DBusClientComponent,
    busAddress: options.busAddress,
    timeout: options.timeout,
    advancedResponse: options.advancedResponse,
    convertBigIntToNumber: options.convertBigIntToNumber
})

/**
 * A client of a DBus bus: calls the services, reads their objects and listens to their signals
 */
export class DBusClientComponent extends Component {

    @Configurable(DTO.String().required())
    protected readonly busAddress: string

    @Configurable(DTO.Number().positive().integer().optional())
    protected readonly timeout: number

    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly advancedResponse: boolean

    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly convertBigIntToNumber: boolean

    protected dbus: DBus

    public get uniqueName(): string {
        return this.dbus.uniqueName
    }

    /**
     * Initializer
     * @protected
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
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        await this.dbus.disconnect()
    }

    public invoke(opts: InvokeOpts, noReply: true): void
    public async invoke(opts: InvokeOpts, noReply: false): Promise<any[]>
    public async invoke(opts: InvokeOpts): Promise<any[]>
    public invoke(opts: InvokeOpts, noReply: boolean = false): Promise<any[]> | void {
        if (noReply) return this.dbus.invoke(opts, true)
        return this.dbus.invoke(opts, false)
    }

    public on(eventName: 'online', listener: (name: string) => void): this
    public on(eventName: 'offline', listener: (name: string) => void): this
    public on(eventName: 'replaced', listener: (name: string) => void): this
    public on(eventName: 'methodCall', listener: (message: DBusMessage) => void): this
    public on(eventName: 'NameOwnerChanged', listener: (name: string, oldOwner: string, newOwner: string) => void): this
    public on(eventName: 'NameLost', listener: (name: string) => void): this
    public on(eventName: 'NameAcquired', listener: (name: string) => void): this
    public on(eventName: 'connectionClose', listener: () => void): this
    public on(eventName: 'connectionError', listener: (error: Error) => void): this
    public on(eventName: string, listener: (...args: any[]) => void): this {
        this.dbus.on(eventName, listener)
        return this
    }

    public once(eventName: 'online', listener: (name: string) => void): this
    public once(eventName: 'offline', listener: (name: string) => void): this
    public once(eventName: 'replaced', listener: (name: string) => void): this
    public once(eventName: 'methodCall', listener: (message: DBusMessage) => void): this
    public once(eventName: 'NameOwnerChanged', listener: (name: string, oldOwner: string, newOwner: string) => void): this
    public once(eventName: 'NameLost', listener: (name: string) => void): this
    public once(eventName: 'NameAcquired', listener: (name: string) => void): this
    public once(eventName: 'connectionClose', listener: () => void): this
    public once(eventName: 'connectionError', listener: (error: Error) => void): this
    public once(eventName: string, listener: (...args: any[]) => void): this {
        this.dbus.once(eventName, listener)
        return this
    }

    public off(eventName: 'online', listener: (name: string) => void): this
    public off(eventName: 'offline', listener: (name: string) => void): this
    public off(eventName: 'replaced', listener: (name: string) => void): this
    public off(eventName: 'methodCall', listener: (message: DBusMessage) => void): this
    public off(eventName: 'NameOwnerChanged', listener: (name: string, oldOwner: string, newOwner: string) => void): this
    public off(eventName: 'NameLost', listener: (name: string) => void): this
    public off(eventName: 'NameAcquired', listener: (name: string) => void): this
    public off(eventName: 'connectionClose', listener: () => void): this
    public off(eventName: 'connectionError', listener: (error: Error) => void): this
    public off(eventName: string, listener: (...args: any[]) => void): this {
        this.dbus.off(eventName, listener)
        return this
    }

    public removeListener(eventName: 'online', listener: (name: string) => void): this
    public removeListener(eventName: 'offline', listener: (name: string) => void): this
    public removeListener(eventName: 'replaced', listener: (name: string) => void): this
    public removeListener(eventName: 'methodCall', listener: (message: DBusMessage) => void): this
    public removeListener(eventName: 'NameOwnerChanged', listener: (name: string, oldOwner: string, newOwner: string) => void): this
    public removeListener(eventName: 'NameLost', listener: (name: string) => void): this
    public removeListener(eventName: 'NameAcquired', listener: (name: string) => void): this
    public removeListener(eventName: 'connectionClose', listener: () => void): this
    public removeListener(eventName: 'connectionError', listener: (error: Error) => void): this
    public removeListener(eventName: string, listener: (...args: any[]) => void): this {
        this.dbus.removeListener(eventName, listener)
        return this
    }

    public addMatch(rule: string): void {
        return this.dbus.addMatch(rule)
    }

    public removeMatch(rule: string): void {
        return this.dbus.removeMatch(rule)
    }

    public async getNameOwner(name: string): Promise<string | undefined> {
        return this.dbus.getNameOwner(name)
    }

    public async listActivatableNames(): Promise<string[]> {
        return this.dbus.listActivatableNames()
    }

    public async listNames(): Promise<string[]> {
        return this.dbus.listNames()
    }

    public async nameHasOwner(name: string): Promise<boolean> {
        return this.dbus.nameHasOwner(name)
    }

    public async listBusNames(): Promise<BusNameBasicInfo[]> {
        return this.dbus.listBusNames()
    }

    public async listServices(): Promise<ServiceBasicInfo[]> {
        return this.dbus.listServices()
    }

    public async services(): Promise<DBusService[]> {
        return this.dbus.getServices()
    }

    public async service(service: string): Promise<DBusService> {
        return this.dbus.getService(service)
    }

    public async object(service: string, objectPath: string): Promise<DBusObject> {
        return this.dbus.getObject(service, objectPath)
    }

    public async interface(service: string, objectPath: string, iface: string): Promise<DBusInterface> {
        return this.dbus.getInterface(service, objectPath, iface)
    }

    public async interfaceSignal(service: string, objectPath: string, iface: string): Promise<DBusSignalEmitter> {
        const dbusIface: DBusInterface = await this.dbus.getInterface(service, objectPath, iface)
        return dbusIface.signal
    }
}
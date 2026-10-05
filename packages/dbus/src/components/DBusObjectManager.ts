import {Component} from '@lakutata/core'
import {Autoload, Singleton} from '@lakutata/core/decorator/di'
import type {DBusPropertyDefinition, DBusSignalDefinition} from '../lib/Declarations.js'
import {checkPathTemplate} from '../lib/Names.js'

/**
 * What a DBus adapter does for the object manager while it runs
 */
export type DBusObjectSink = {
    /**
     * Export an object, false when no interface of the adapter serves its path
     */
    addObject(path: string): boolean
    /**
     * Stop exporting an object added by the object manager, false when it does not export it or exports it as a fixed
     * object (the path of a template without variables), which it keeps
     */
    removeObject(path: string): boolean
    /**
     * Whether it exports the object as a fixed object
     */
    isFixed(path: string): boolean
    emitSignal(path: string, signal: DBusSignalDefinition<any>, data: unknown): boolean
    propertyChanged(path: string, property: DBusPropertyDefinition<any>, value: unknown): void
}

/**
 * A property value written by a D-Bus client, the argument of the `propertyWritten` event of
 * {@link DBusObjectManager}. The value is already validated and kept when the event is emitted.
 */
export type DBusPropertyWrite = {
    /**
     * The object path of the property (`'/com/example/Devices/A1'`).
     */
    readonly path: string
    /**
     * The name of the interface the client wrote it through (`'com.example.Device'`).
     */
    readonly interface: string
    /**
     * The property's definition, to compare with the one built by `defineDBusProperty`.
     */
    readonly property: DBusPropertyDefinition<any>
    /**
     * The value written, validated by the property's schema.
     */
    readonly value: unknown
}

export const ATTACH: unique symbol = Symbol('DBUS.OBJECT.MANAGER.ATTACH')

export const STORE: unique symbol = Symbol('DBUS.OBJECT.MANAGER.STORE')

/**
 * The application's D-Bus objects: it adds and removes the objects of the path templates of `@DBusInterface`
 * (`/com/example/Devices/{sn}`), keeps the values of their properties, and emits their signals. Inject it
 * (`@Inject(DBusObjectManager)`) or get it (`getObject(DBusObjectManager)`) from any object: it is autoloaded, a
 * singleton of the application, and needs no registration.
 *
 * Its state lives in the application, not on the bus: the objects added before a {@link dbusEntrypoint} starts are
 * exported when it starts, and every running D-Bus adapter whose interfaces match a path exports the object. The
 * clients are told of the objects added and removed by the `org.freedesktop.DBus.ObjectManager` interface of the root
 * object (`InterfacesAdded`, `InterfacesRemoved`).
 *
 * It emits `propertyWritten` (a {@link DBusPropertyWrite}) when a client writes a writable property.
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {Inject} from 'lakutata/decorator/di'
 * import {DBusObjectManager, defineDBusProperty, defineDBusSignal, type DBusPropertyWrite} from '@lakutata/dbus'
 *
 * export const DeviceState = defineDBusProperty<string>('State', 's', {initial: 'idle'})
 * export const DeviceLevel = defineDBusProperty<number>('Level', 'i', {writable: true, initial: 1})
 * export const DeviceRemoved = defineDBusSignal<string>('Removed', 's')
 *
 * //Declared in the components of the application, with the controllers of the interfaces at /com/example/Devices/{sn}
 * export class Devices extends Component {
 *     @Inject(DBusObjectManager)
 *     protected readonly manager: DBusObjectManager
 *
 *     protected async init(): Promise<void> {
 *         this.manager.on('propertyWritten', (write: DBusPropertyWrite): void => {
 *             if (write.property === DeviceLevel) console.log(`${write.path}: level ${write.value}`)
 *         })
 *     }
 *
 *     public plug(sn: string): void {
 *         const path: string = `/com/example/Devices/${sn}`
 *         this.manager.addObject(path)
 *         this.manager.setPropertyValue(path, DeviceState, 'running')
 *     }
 *
 *     public unplug(sn: string): void {
 *         const path: string = `/com/example/Devices/${sn}`
 *         this.manager.emitSignal(path, DeviceRemoved, sn)
 *         this.manager.removeObject(path)
 *     }
 * }
 * ```
 */
@Autoload()
@Singleton()
export class DBusObjectManager extends Component {

    readonly #objects: Set<string> = new Set()

    readonly #values: Map<string, Map<DBusPropertyDefinition<any>, unknown>> = new Map()

    readonly #sinks: Set<DBusObjectSink> = new Set()

    /**
     * Send the changes to an adapter until the returned function is called; the objects already added are exported by it
     * @param sink
     */
    public [ATTACH](sink: DBusObjectSink): () => void {
        this.#sinks.add(sink)
        this.#objects.forEach((path: string): unknown => sink.addObject(path))
        return (): void => void this.#sinks.delete(sink)
    }

    /**
     * Keep a value written by a client
     * @param write
     */
    public [STORE](write: DBusPropertyWrite): void {
        this.#valuesOf(write.path).set(write.property, write.value)
        this.emit('propertyWritten', write)
    }

    /**
     * The values of the properties of an object
     * @param path
     */
    #valuesOf(path: string): Map<DBusPropertyDefinition<any>, unknown> {
        let values: Map<DBusPropertyDefinition<any>, unknown> | undefined = this.#values.get(path)
        if (!values) {
            values = new Map()
            this.#values.set(path, values)
        }
        return values
    }

    /**
     * Add an object: every running D-Bus adapter whose interfaces have a path template matching it (or the same path)
     * exports it, with those interfaces, and the adapters started later export it when they start. The variables of the
     * matching templates are given to the methods called on it. An object whose path matches no template is kept, but
     * not exported.
     * @param path The object path (`'/com/example/Devices/A1'`), not a template.
     * @returns `false` when the object was already added, `true` otherwise.
     * @throws {TypeError} When the path is invalid, or is a template (it contains braces).
     */
    public addObject(path: string): boolean {
        checkPathTemplate(path)
        if (/[{}]/.test(path)) throw new TypeError(`The object path "${path}" is a template, not the path of an object`)
        if (this.#objects.has(path)) return false
        this.#objects.add(path)
        this.#sinks.forEach((sink: DBusObjectSink): unknown => sink.addObject(path))
        return true
    }

    /**
     * Remove an object added with {@link addObject}: the adapters stop exporting it, and its property values are
     * forgotten (added again, it starts from the initial values). A fixed object (the path of a template without
     * variables, exported by the adapters themselves) stays exported, with its property values, when it was also
     * added: only its entry in {@link objects} is removed.
     * @param path The object path given to {@link addObject}.
     * @returns `false` when the object was not added, `true` otherwise.
     */
    public removeObject(path: string): boolean {
        if (!this.#objects.delete(path)) return false
        let fixed: boolean = false
        this.#sinks.forEach((sink: DBusObjectSink): void => {
            //An adapter keeps the objects it exports by itself
            if (sink.isFixed(path)) fixed = true
            else sink.removeObject(path)
        })
        if (!fixed) this.#values.delete(path)
        return true
    }

    /**
     * Tell whether an object was added with {@link addObject} and not removed since.
     * @param path The object path.
     * @returns `true` when the object is added.
     */
    public hasObject(path: string): boolean {
        return this.#objects.has(path)
    }

    /**
     * List the objects added with {@link addObject}, in the order they were added; the objects of the paths without
     * variables, exported by the adapters themselves, are not listed.
     * @returns The object paths.
     */
    public objects(): string[] {
        return [...this.#objects]
    }

    /**
     * Set the value of a property on an object, validated by the property's schema: the clients read it from then on,
     * and the running adapters exporting the object announce it (`PropertiesChanged`). The value is kept even when no
     * adapter exports the object yet.
     * @param path The object path (`'/com/example/Devices/A1'`).
     * @param property The property's definition, listed in the `properties` of the object's interface.
     * @param value The new value.
     * @throws {InvalidValueException} When the value does not match the property's schema; nothing is changed.
     */
    public setPropertyValue<T>(path: string, property: DBusPropertyDefinition<T>, value: T): void {
        const validated: T = property.validate(value)
        this.#valuesOf(path).set(property, validated)
        this.#sinks.forEach((sink: DBusObjectSink): void => sink.propertyChanged(path, property, validated))
    }

    /**
     * Get the value of a property on an object: the last value set by the application or written by a client.
     * @param path The object path.
     * @param property The property's definition.
     * @returns The value, or the property's `initial` value until one is set.
     */
    public getPropertyValue<T>(path: string, property: DBusPropertyDefinition<T>): T | undefined {
        const values: Map<DBusPropertyDefinition<any>, unknown> | undefined = this.#values.get(path)
        return values?.has(property) ? values.get(property) as T : property.initial
    }

    /**
     * Emit a signal from an object, through every running adapter exporting the object with an interface listing the
     * signal. The data is validated by the signal's DTO first.
     * @param path The object path (`'/com/example/Devices/A1'`).
     * @param signal The signal's definition, listed in the `signals` of the object's interface.
     * @param data The data of the signal.
     * @returns `false` when no running adapter exports the object with this signal (nothing is sent), `true` otherwise.
     * @throws {InvalidValueException} When the data does not match the signal's DTO.
     */
    public emitSignal<T>(path: string, signal: DBusSignalDefinition<T>, data: T): boolean {
        const validated: T = signal.validate(data)
        let emitted: boolean = false
        this.#sinks.forEach((sink: DBusObjectSink): void => {
            if (sink.emitSignal(path, signal, validated)) emitted = true
        })
        return emitted
    }
}

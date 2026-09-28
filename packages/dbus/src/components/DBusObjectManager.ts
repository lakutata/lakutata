import {Component} from '@lakutata/core'
import {Autoload, Singleton} from '@lakutata/core/decorator/di'
import type {DBusPropertyDefinition, DBusSignalDefinition} from '../lib/Declarations.js'
import {CheckPathTemplate} from '../lib/Names.js'

/**
 * What a DBus adapter does for the object manager while it runs
 */
export type DBusObjectSink = {
    /**
     * Export an object, false when no interface of the adapter serves its path
     */
    addObject(path: string): boolean
    removeObject(path: string): boolean
    emitSignal(path: string, signal: DBusSignalDefinition<any>, data: unknown): boolean
    propertyChanged(path: string, property: DBusPropertyDefinition<any>, value: unknown): void
}

/**
 * A property written by a client
 */
export type DBusPropertyWrite = {
    readonly path: string
    readonly interface: string
    readonly property: DBusPropertyDefinition<any>
    readonly value: unknown
}

export const ATTACH: unique symbol = Symbol('DBUS.OBJECT.MANAGER.ATTACH')

export const STORE: unique symbol = Symbol('DBUS.OBJECT.MANAGER.STORE')

/**
 * The DBus objects of the application: the objects added and removed while it runs (the paths of the templates of @DBusInterface),
 * the values of their properties and their signals. Inject it (@Inject(DBusObjectManager)) or get it (getObject(DBusObjectManager))
 * from any object: it is autoloaded, one per application. It emits "propertyWritten" when a client writes a property
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
     * Add an object: it is exported by the adapters whose interfaces serve its path (a template such as "/com/example/Devices/{sn}")
     * @param path
     * @return false when the object was already added
     */
    public addObject(path: string): boolean {
        CheckPathTemplate(path)
        if (/[{}]/.test(path)) throw new TypeError(`The object path "${path}" is a template, not the path of an object`)
        if (this.#objects.has(path)) return false
        this.#objects.add(path)
        this.#sinks.forEach((sink: DBusObjectSink): unknown => sink.addObject(path))
        return true
    }

    /**
     * Remove an object added
     * @param path
     * @return false when the object was not added
     */
    public removeObject(path: string): boolean {
        if (!this.#objects.delete(path)) return false
        this.#values.delete(path)
        this.#sinks.forEach((sink: DBusObjectSink): unknown => sink.removeObject(path))
        return true
    }

    /**
     * Whether an object was added
     * @param path
     */
    public hasObject(path: string): boolean {
        return this.#objects.has(path)
    }

    /**
     * The paths of the objects added
     */
    public objects(): string[] {
        return [...this.#objects]
    }

    /**
     * Set the value of a property of an object: the clients are notified (PropertiesChanged)
     * @param path
     * @param property
     * @param value
     */
    public setPropertyValue<T>(path: string, property: DBusPropertyDefinition<T>, value: T): void {
        const validated: T = property.validate(value)
        this.#valuesOf(path).set(property, validated)
        this.#sinks.forEach((sink: DBusObjectSink): void => sink.propertyChanged(path, property, validated))
    }

    /**
     * The value of a property of an object, its initial value until it is set
     * @param path
     * @param property
     */
    public getPropertyValue<T>(path: string, property: DBusPropertyDefinition<T>): T | undefined {
        const values: Map<DBusPropertyDefinition<any>, unknown> | undefined = this.#values.get(path)
        return values?.has(property) ? values.get(property) as T : property.initial
    }

    /**
     * Emit a signal of an object
     * @param path
     * @param signal
     * @param data
     * @return false when no adapter exports the object
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

import {DTO, type Schema} from '@lakutata/core'
import {CheckInterfaceName, CheckMemberName, CheckPathTemplate} from './Names.js'
import {SchemaSignature} from './Signature.js'

/**
 * A signal of the DBus interfaces, declared with DefineDBusSignal
 */
export type DBusSignalDefinition<T = unknown> = {
    readonly kind: 'signal'
    readonly name: string
    /**
     * The signature of the data of the signal
     */
    readonly type: string
    /**
     * Validate the data of the signal
     */
    readonly validate: (data: T) => T
}

/**
 * A property of the DBus interfaces, declared with DefineDBusProperty: a value kept by the DBus adapter,
 * updated by the application (DBusObjectManager.setPropertyValue), written by the clients when it is writable
 */
export type DBusPropertyDefinition<T = unknown> = {
    readonly kind: 'property'
    readonly name: string
    /**
     * The signature of the value of the property
     */
    readonly type: string
    readonly writable: boolean
    /**
     * The value of the property until it is set
     */
    readonly initial?: T
    /**
     * Validate a value of the property, synchronously: the errors are given to the clients writing it
     */
    readonly validate: (value: T) => T
}

export type DBusPropertyOptions<T> = {
    /**
     * The clients may write the property, false by default
     */
    writable?: boolean
    /**
     * The value of the property until it is set
     */
    initial?: T
    /**
     * The schema of the values of the property (the value written by a client is validated with it)
     */
    schema?: Schema
}

/**
 * The declaration of a DBus interface served by a controller
 */
export type DBusInterfaceDeclaration = {
    readonly interface: string
    readonly path: string
    readonly signals: DBusSignalDefinition<any>[]
    readonly properties: DBusPropertyDefinition<any>[]
}

/**
 * Declare a signal of the DBus interfaces: its data is a DTO (a dictionary of variants) or a value of a signature
 * @param name
 * @param data
 */
export function DefineDBusSignal<T = Record<string, unknown>>(name: string, data: typeof DTO | string = 'a{sv}'): DBusSignalDefinition<T> {
    CheckMemberName(name, 'signal')
    const isDTO: boolean = typeof data === 'function'
    return {
        kind: 'signal',
        name: name,
        type: isDTO ? SchemaSignature(data as typeof DTO) : data as string,
        validate: (value: T): T => isDTO ? (data as typeof DTO).validate(value) : value
    }
}

/**
 * Declare a property of the DBus interfaces
 * @param name
 * @param type the signature of its value ("s", "i", "b", "a{sv}"…)
 * @param options
 */
export function DefineDBusProperty<T = unknown>(name: string, type: string, options: DBusPropertyOptions<T> = {}): DBusPropertyDefinition<T> {
    CheckMemberName(name, 'property')
    const schema: Schema | undefined = options.schema
    return {
        kind: 'property',
        name: name,
        type: type,
        writable: options.writable === true,
        initial: options.initial,
        validate: (value: T): T => schema ? DTO.validate(value, schema) : value
    }
}

const DBUS_INTERFACE: symbol = Symbol('DBUS.INTERFACE')

/**
 * Keep the declaration of the interface of a controller
 * @param controller
 * @param declaration
 */
export function SetDBusInterfaceDeclaration(controller: Function, declaration: DBusInterfaceDeclaration): void {
    CheckInterfaceName(declaration.interface)
    CheckPathTemplate(declaration.path)
    Reflect.defineMetadata(DBUS_INTERFACE, declaration, controller)
}

/**
 * The declaration of the interface of a controller, or of its nearest parent class declaring one
 * @param controller
 */
export function GetDBusInterfaceDeclaration(controller: Function): DBusInterfaceDeclaration | undefined {
    return Reflect.getMetadata(DBUS_INTERFACE, controller)
}

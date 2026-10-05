import {DTO, type Schema} from '@lakutata/core'
import {checkInterfaceName, checkMemberName, checkPathTemplate} from './Names.js'
import {schemaSignature} from './Signature.js'

/**
 * A D-Bus signal, built by {@link defineDBusSignal}: list it in the `signals` of `@DBusInterface`, and emit it with
 * {@link DBusObjectManager.emitSignal}. The definition itself identifies the signal: two definitions with the same
 * name are two signals.
 * @typeParam T The data the signal carries.
 */
export type DBusSignalDefinition<T = unknown> = {
    /**
     * Always `'signal'`.
     */
    readonly kind: 'signal'
    /**
     * The member name of the signal (`'Changed'`).
     */
    readonly name: string
    /**
     * The D-Bus signature of the signal's one argument: `a{sv}` for a DTO, or the signature given.
     */
    readonly type: string
    /**
     * Validate the data of an emission: with the DTO when the signal has one, returning the validated data; as it is
     * otherwise.
     * @param data The data to emit.
     * @returns The data validated.
     * @throws {InvalidValueException} When the data does not match the signal's DTO.
     */
    readonly validate: (data: T) => T
}

/**
 * A D-Bus property, built by {@link defineDBusProperty}: list it in the `properties` of `@DBusInterface`. Its values
 * are kept by {@link DBusObjectManager}, one per object path: the application sets them with
 * {@link DBusObjectManager.setPropertyValue}, the clients read them, and write them when the property is writable. The
 * definition itself identifies the property.
 * @typeParam T The values of the property.
 */
export type DBusPropertyDefinition<T = unknown> = {
    /**
     * Always `'property'`.
     */
    readonly kind: 'property'
    /**
     * The member name of the property (`'State'`).
     */
    readonly name: string
    /**
     * The D-Bus signature of the property's values (`'s'`, `'i'`, `'a{sv}'`…).
     */
    readonly type: string
    /**
     * Whether the clients may write the property (`org.freedesktop.DBus.Properties.Set`); a read-only property refuses
     * their writes with a D-Bus error.
     */
    readonly writable: boolean
    /**
     * The value of the property on every object until it is set.
     */
    readonly initial?: T
    /**
     * Validate a value of the property, synchronously, with its `schema` (the value as it is without a schema).
     * @param value The value set by the application or written by a client.
     * @returns The value validated.
     * @throws {InvalidValueException} When the value does not match the schema; a client writing it gets a D-Bus error.
     */
    readonly validate: (value: T) => T
}

/**
 * The options of {@link defineDBusProperty}.
 * @typeParam T The values of the property.
 */
export type DBusPropertyOptions<T> = {
    /**
     * Whether the clients may write the property. A value written is validated with `schema`, kept, and announced by
     * `DBusObjectManager` with a `propertyWritten` event and to the clients with `PropertiesChanged`.
     * @default false
     */
    writable?: boolean
    /**
     * The value of the property on every object until it is set; it is not validated.
     * @default undefined
     */
    initial?: T
    /**
     * The schema validating the values of the property (`DTO.Number().integer().min(0)`), the ones set by the
     * application and the ones written by the clients.
     * @default none: every value is accepted
     */
    schema?: Schema
}

/**
 * The declaration of a D-Bus interface served by a controller, as `@DBusInterface` records it.
 */
export type DBusInterfaceDeclaration = {
    /**
     * The name of the interface (`'com.example.Device'`).
     */
    readonly interface: string
    /**
     * The object path, or path template, of the interface (`'/com/example/Devices/{sn}'`).
     */
    readonly path: string
    /**
     * The signals of the interface.
     */
    readonly signals: DBusSignalDefinition<any>[]
    /**
     * The properties of the interface.
     */
    readonly properties: DBusPropertyDefinition<any>[]
}

/**
 * Declare a D-Bus signal, to list in the `signals` of one or more `@DBusInterface`. The signal has one argument: a
 * dictionary of variants (`a{sv}`) holding a DTO, or a value of the signature given. Its data is validated by its DTO
 * when it is emitted.
 * @typeParam T The data the signal carries.
 * @param name The member name of the signal (`'Changed'`): letters, digits and `_`, not starting with a digit; 255
 * characters at most.
 * @param data The DTO of the signal's data, or the D-Bus signature of its argument (`'s'`, `'a{sv}'`…); with a
 * signature, the data is not validated. `'a{sv}'` by default.
 * @returns The signal's definition.
 * @throws {TypeError} When the name is invalid.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {defineDBusSignal, type DBusObjectManager} from '@lakutata/dbus'
 *
 * class StatusDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public sn: string
 *
 *     @Expect(DTO.Boolean().required())
 *     public online: boolean
 * }
 *
 * //A dictionary of variants a{sv}, validated by StatusDTO
 * export const DeviceChanged = defineDBusSignal<StatusDTO>('Changed', StatusDTO)
 * //A string s
 * export const DeviceMessage = defineDBusSignal<string>('Message', 's')
 *
 * declare const manager: DBusObjectManager
 * manager.emitSignal('/com/example/Devices/A1', DeviceChanged, {sn: 'A1', online: true} as StatusDTO)
 * manager.emitSignal('/com/example/Devices/A1', DeviceMessage, 'Rebooted')
 * ```
 */
export function defineDBusSignal<T = Record<string, unknown>>(name: string, data: typeof DTO | string = 'a{sv}'): DBusSignalDefinition<T> {
    checkMemberName(name, 'signal')
    const isDTO: boolean = typeof data === 'function'
    return {
        kind: 'signal',
        name: name,
        type: isDTO ? schemaSignature(data as typeof DTO) : data as string,
        validate: (value: T): T => isDTO ? (data as typeof DTO).validate(value) : value
    }
}

/**
 * Declare a D-Bus property, to list in the `properties` of one or more `@DBusInterface`. Its values are kept by
 * `DBusObjectManager`, one per object: the application sets them, the clients read them (`Get`, `GetAll`) and are told
 * of their changes (`PropertiesChanged`), and write them when the property is writable.
 * @typeParam T The values of the property.
 * @param name The member name of the property (`'State'`): letters, digits and `_`, not starting with a digit; 255
 * characters at most.
 * @param type The D-Bus signature of its values (`'s'`, `'i'`, `'b'`, `'a{sv}'`…); it is not checked against `schema`.
 * @param options Whether the clients may write it, its initial value and the schema of its values; none by default
 * (read-only, no initial value, every value accepted).
 * @returns The property's definition.
 * @throws {TypeError} When the name is invalid.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {defineDBusProperty, type DBusObjectManager, type DBusPropertyWrite} from '@lakutata/dbus'
 *
 * //Read-only, "idle" until it is set
 * export const DeviceState = defineDBusProperty<string>('State', 's', {initial: 'idle'})
 * //Written by the clients, from 0 to 10
 * export const DeviceLevel = defineDBusProperty<number>('Level', 'i', {writable: true, initial: 1, schema: DTO.Number().integer().min(0).max(10)})
 *
 * declare const manager: DBusObjectManager
 * manager.setPropertyValue('/com/example/Devices/A1', DeviceState, 'running')
 * manager.on('propertyWritten', (write: DBusPropertyWrite): void => {
 *     if (write.property === DeviceLevel) console.log(`${write.path}: level ${write.value}`)
 * })
 * ```
 */
export function defineDBusProperty<T = unknown>(name: string, type: string, options: DBusPropertyOptions<T> = {}): DBusPropertyDefinition<T> {
    checkMemberName(name, 'property')
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
export function setDBusInterfaceDeclaration(controller: Function, declaration: DBusInterfaceDeclaration): void {
    checkInterfaceName(declaration.interface)
    checkPathTemplate(declaration.path)
    Reflect.defineMetadata(DBUS_INTERFACE, declaration, controller)
}

/**
 * The declaration of the interface of a controller, or of its nearest parent class declaring one
 * @param controller
 */
export function getDBusInterfaceDeclaration(controller: Function): DBusInterfaceDeclaration | undefined {
    return Reflect.getMetadata(DBUS_INTERFACE, controller)
}

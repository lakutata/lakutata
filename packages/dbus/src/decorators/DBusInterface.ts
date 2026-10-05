import type {Controller} from '@lakutata/entrypoint'
import {setPrefix} from '@lakutata/entrypoint/channel'
import {type DBusPropertyDefinition, type DBusSignalDefinition, SetDBusInterfaceDeclaration} from '../lib/Declarations.js'

/**
 * The options of {@link DBusInterface}: where the interface is served, and its signals and properties.
 */
export type DBusInterfaceOptions = {
    /**
     * The object path of the interface. A path without variables (`'/com/example/Manager'`) is one object, exported
     * while the adapter runs ({@link DBusObjectManager.removeObject} does not remove it). A template (`'/com/example/Devices/{sn}'`) serves the objects added with
     * {@link DBusObjectManager.addObject} whose path matches it; its variables are merged into the input of the methods,
     * as route parameters (they take precedence over the client's input). Its elements are letters, digits and `_`, or
     * variables in braces; a variable matches one element.
     */
    path: string
    /**
     * The signals of the interface, declared with {@link defineDBusSignal} and emitted with
     * {@link DBusObjectManager.emitSignal}.
     * @default []
     */
    signals?: DBusSignalDefinition<any>[]
    /**
     * The properties of the interface, declared with {@link defineDBusProperty} and set with
     * {@link DBusObjectManager.setPropertyValue}.
     * @default []
     */
    properties?: DBusPropertyDefinition<any>[]
}

/**
 * Serve a controller as a D-Bus interface: its `@DBusMethod` actions are the interface's methods, and the signals and
 * properties of the options are its other members, on the objects at `options.path`. The controllers declaring the same
 * path are served by the same objects, each one interface; a subclass inherits the declaration of its parent class.
 * The objects also implement `org.freedesktop.DBus.Properties`, `Introspectable` and `Peer`, and the root object `/`
 * implements `ObjectManager`. Nothing is served until a {@link dbusEntrypoint} runs.
 * @param name The name of the interface (`'com.example.Device'`): two or more elements separated by dots, made of
 * letters, digits and `_`, not starting with a digit; 255 characters at most.
 * @param options The object path (or template) of the interface, its signals and its properties.
 * @returns The class decorator.
 * @throws {TypeError} When the class is declared, if the name of the interface or the path is invalid.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {Expect, Return} from 'lakutata/decorator/dto'
 * import {DBusInterface, DBusMethod, defineDBusProperty, defineDBusSignal} from '@lakutata/dbus'
 *
 * class DeviceSnDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public sn: string
 * }
 *
 * class StatusDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public sn: string
 *
 *     @Expect(DTO.Boolean().required())
 *     public online: boolean
 * }
 *
 * export const DeviceChanged = defineDBusSignal('Changed', StatusDTO)
 * export const DeviceState = defineDBusProperty<string>('State', 's', {initial: 'idle'})
 *
 * //Served by the objects /com/example/Devices/A1, /com/example/Devices/B2… added with DBusObjectManager
 * @DBusInterface('com.example.Device', {path: '/com/example/Devices/{sn}', signals: [DeviceChanged], properties: [DeviceState]})
 * export class DeviceController extends Controller {
 *     //The sn of the input is the one of the object path
 *     @DBusMethod('Status', DeviceSnDTO)
 *     @Return(StatusDTO)
 *     public async status(input: DeviceSnDTO): Promise<StatusDTO> {
 *         return {sn: input.sn, online: true} as StatusDTO
 *     }
 * }
 * ```
 */
export function DBusInterface<ClassConstructor extends typeof Controller>(name: string, options: DBusInterfaceOptions): (target: ClassConstructor) => void {
    return (target: ClassConstructor): void => {
        SetDBusInterfaceDeclaration(target, {
            interface: name,
            path: options.path,
            signals: options.signals ?? [],
            properties: options.properties ?? []
        })
        //The methods of the controller are addressed at its interface and its path
        setPrefix(target, {dbus: {path: options.path, interface: name}})
    }
}

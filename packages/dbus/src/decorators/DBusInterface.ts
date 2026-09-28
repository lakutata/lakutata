import type {Controller} from '@lakutata/entrypoint'
import {SetPrefix} from '@lakutata/entrypoint/channel'
import {type DBusPropertyDefinition, type DBusSignalDefinition, SetDBusInterfaceDeclaration} from '../lib/Declarations.js'

export type DBusInterfaceOptions = {
    /**
     * The path of the objects: a path ("/com/example/Manager"), created when the adapter starts,
     * or a template ("/com/example/Devices/{sn}") of the objects added by DBusObjectManager, whose variables are merged into the input of the methods
     */
    path: string
    /**
     * The signals of the interface
     */
    signals?: DBusSignalDefinition<any>[]
    /**
     * The properties of the interface
     */
    properties?: DBusPropertyDefinition<any>[]
}

/**
 * Class Decorator, the controller serves a DBus interface: its methods (@DBusMethod), its signals and its properties
 * @param name the name of the interface ("com.example.Device")
 * @param options
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
        SetPrefix(target, {dbus: {path: options.path, interface: name}})
    }
}

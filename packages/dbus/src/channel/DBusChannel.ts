import type {ActionPattern} from '@lakutata/core'
import {ControllerActionNotFoundException, type BaseContext, type EntrypointAdapter} from '@lakutata/entrypoint'
import {DefineChannel, GetChannel, HasChannel, type ChannelDefinition, type ChannelEntry, type ChannelMatch, type ChannelMatcher} from '@lakutata/entrypoint/channel'
import {DBUS_CONTEXT_TYPE, DBusContext} from '../context/DBusContext.js'
import {CheckInterfaceName, CheckMemberName, CheckPathTemplate, CompilePathTemplate, PathTemplate} from '../lib/Names.js'

declare module '@lakutata/entrypoint' {
    interface EntrypointOptions {
        /**
         * The D-Bus adapters, built by `DBusEntrypoint()`: one, or several for several buses or service names.
         * @default undefined (no D-Bus adapter)
         */
        dbus?: EntrypointAdapter<DBusContext> | EntrypointAdapter<DBusContext>[]
    }

    interface PrefixOptions {
        /**
         * The object path (or path template) and the interface of a controller's D-Bus methods. `@DBusInterface` sets
         * it; an application does not set it itself.
         */
        dbus?: {
            /**
             * The object path, or path template, of the methods.
             */
            path?: string
            /**
             * The name of the methods' interface.
             */
            interface?: string
        }
    }
}

/**
 * The key of the address of a method
 * @param interfaceName
 * @param member
 * @param path
 */
function AddressKey(interfaceName: string, member: string, path: string): string {
    return `${interfaceName}.${member}@${path}`
}

/**
 * The definition of the D-Bus channel of the entrypoint, named `dbus`: its actions are the methods of D-Bus interfaces,
 * addressed by `{member, interface, path}` (the method name from `@DBusMethod`, the interface and the path template from
 * `@DBusInterface`). A call matches an action by its interface, its method and its object path; a call matching none
 * fails with `ControllerActionNotFoundException`. `@DBusMethod` and {@link DBusEntrypoint} use it: an application only
 * needs it to write an adapter of its own.
 */
export const DBusChannel: ChannelDefinition = HasChannel('dbus') ? GetChannel('dbus') : DefineChannel({
    name: 'dbus',
    kind: 'request',
    contextType: DBUS_CONTEXT_TYPE,
    validate: (pattern: ActionPattern): ActionPattern => {
        CheckMemberName(pattern.member, 'method')
        if (pattern.interface !== undefined) CheckInterfaceName(pattern.interface)
        if (pattern.path !== undefined) CheckPathTemplate(pattern.path)
        return pattern
    },
    identify: (pattern: ActionPattern): string => AddressKey(pattern.interface ?? '?', pattern.member, pattern.path ?? '?'),
    describe: (pattern: ActionPattern): Record<string, unknown> => {
        const {returns, ...address} = pattern
        return returns === undefined ? address : {...address, returns: returns}
    },
    prefix: (prefix, pattern: ActionPattern): ActionPattern | undefined => {
        const dbus: { path?: string, interface?: string } | undefined = prefix.dbus
        if (!dbus || (pattern.path !== undefined && pattern.interface !== undefined)) return undefined
        return {...pattern, path: pattern.path ?? dbus.path, interface: pattern.interface ?? dbus.interface}
    },
    createMatcher: (entries: ChannelEntry[]): ChannelMatcher => {
        const templates: { entry: ChannelEntry, template: PathTemplate }[] = entries
            .filter((entry: ChannelEntry): boolean => entry.details.pattern.path !== undefined)
            .map((entry: ChannelEntry): { entry: ChannelEntry, template: PathTemplate } => ({entry: entry, template: CompilePathTemplate(entry.details.pattern.path)}))
        return {
            match: (context: BaseContext): ChannelMatch | undefined => {
                const {path, interface: interfaceName, member} = context as DBusContext
                for (const {entry, template} of templates) {
                    if (entry.details.pattern.interface !== interfaceName || entry.details.pattern.member !== member) continue
                    const params: Record<string, string> | undefined = template.match(path)
                    if (params) return {entry: entry, params: params}
                }
                return undefined
            }
        }
    },
    notFound: (context: BaseContext): Error => new ControllerActionNotFoundException('The DBus method {member} of the interface {interface} of {path} is not found', {
        member: (context as DBusContext).member,
        interface: (context as DBusContext).interface,
        path: (context as DBusContext).path
    })
})

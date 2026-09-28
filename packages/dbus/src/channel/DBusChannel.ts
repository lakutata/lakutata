import type {ActionPattern} from '@lakutata/core'
import {ControllerActionNotFoundException} from '@lakutata/entrypoint'
import type {BaseContext, EntrypointAdapter} from '@lakutata/entrypoint'
import {DefineChannel, GetChannel, HasChannel} from '@lakutata/entrypoint/channel'
import type {ChannelDefinition, ChannelEntry, ChannelMatch, ChannelMatcher} from '@lakutata/entrypoint/channel'
import {DBUS_CONTEXT_TYPE, DBusContext} from '../context/DBusContext.js'
import {CheckInterfaceName, CheckMemberName, CheckPathTemplate, CompilePathTemplate, PathTemplate} from '../lib/Names.js'

declare module '@lakutata/entrypoint' {
    interface EntrypointOptions {
        /**
         * The DBus adapters (DBusEntrypoint)
         */
        dbus?: EntrypointAdapter<DBusContext> | EntrypointAdapter<DBusContext>[]
    }

    interface PrefixOptions {
        /**
         * The object path (template) and the interface of the methods of a controller, set by @DBusInterface
         */
        dbus?: {
            path?: string
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
 * The DBus channel: the actions are the methods of the interfaces of the DBus objects.
 * The address of a method is {member, interface, path}, the interface and the path (template) are given by @DBusInterface
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

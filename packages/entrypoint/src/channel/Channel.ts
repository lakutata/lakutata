import type {ActionPattern} from '@lakutata/core'
import type {BaseContext} from '../context/BaseContext.js'
import type {ActionDetails} from '../lib/ControllerEntrypoint.js'
import type {PrefixOptions} from '../lib/Prefix.js'
import type {BaseActionInfo} from '../Entrypoint.js'
import {InvalidChannelException} from '../exceptions/InvalidChannelException.js'

/**
 * The kind of a channel:
 * request: a caller waits for the result (http, cli, service, mcp, dbus)
 * delivery: no caller waits, the adapter acknowledges the outcome (message queues)
 * trigger: no external caller (schedule)
 */
export type ChannelKind = 'request' | 'delivery' | 'trigger'

/**
 * A dispatchable action of a channel
 */
export interface ChannelEntry {
    readonly details: ActionDetails
    readonly info: BaseActionInfo & Record<string, unknown>
}

/**
 * The action matching a request, with the parameters taken from its address
 */
export interface ChannelMatch {
    readonly entry: ChannelEntry
    readonly params?: Record<string, unknown>
}

/**
 * The lookup of the actions of a channel
 */
export interface ChannelMatcher {
    match(context: BaseContext): ChannelMatch | undefined
}

/**
 * A channel: how the actions declare their addresses and how a request finds its action
 */
export interface ChannelDefinition {
    /**
     * The channel name, which is also the key of its adapters in the entrypoint options
     */
    readonly name: string
    /**
     * The channel kind
     */
    readonly kind: ChannelKind
    /**
     * The context type of the requests of the channel
     */
    readonly contextType: string

    /**
     * Check an address when an action is declared
     * @param address
     */
    validate?(address: ActionPattern): ActionPattern

    /**
     * The text identifying an address, part of the action id
     * @param address
     */
    identify(address: ActionPattern): string

    /**
     * The fields of the action information describing an address
     * @param address
     */
    describe(address: ActionPattern): Record<string, unknown>

    /**
     * Apply the prefixes of a controller to an address, undefined when the prefixes do not concern the channel
     * @param prefix
     * @param address
     */
    prefix?(prefix: PrefixOptions, address: ActionPattern): ActionPattern | undefined

    /**
     * Create the lookup of the actions
     * @param entries
     */
    createMatcher(entries: ChannelEntry[]): ChannelMatcher

    /**
     * Prepare the context of a matched request before its dispatch
     * @param entry
     * @param context
     */
    prepare?(entry: ChannelEntry, context: BaseContext): void

    /**
     * The error of a request matching no action
     * @param context
     */
    notFound(context: BaseContext): Error
}

const channels: Map<string, ChannelDefinition> = new Map()

/**
 * Define a channel, the packages providing a channel define it when they are loaded
 * @param definition
 */
export function DefineChannel<Definition extends ChannelDefinition>(definition: Definition): Definition {
    const defined: ChannelDefinition | undefined = channels.get(definition.name)
    if (defined && defined !== definition) throw new InvalidChannelException('The channel "{0}" is already defined', [definition.name])
    channels.set(definition.name, definition)
    return definition
}

/**
 * Get a defined channel
 * @param name
 */
export function GetChannel(name: string): ChannelDefinition {
    const definition: ChannelDefinition | undefined = channels.get(name)
    if (!definition) throw new InvalidChannelException('The channel "{0}" is not defined', [name])
    return definition
}

/**
 * Whether a channel is defined
 * @param name
 */
export function HasChannel(name: string): boolean {
    return channels.has(name)
}

/**
 * The channel of a context type
 * @param contextType
 */
export function GetChannelByContextType(contextType: string): ChannelDefinition | undefined {
    for (const definition of channels.values()) if (definition.contextType === contextType) return definition
    return undefined
}

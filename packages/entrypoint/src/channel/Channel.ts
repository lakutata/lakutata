import type {ActionPattern} from '@lakutata/core'
import type {BaseContext} from '../context/BaseContext.js'
import type {ActionDetails} from '../lib/ControllerEntrypoint.js'
import type {PrefixOptions} from '../lib/Prefix.js'
import type {BaseActionInfo} from '../Entrypoint.js'
import {InvalidChannelException} from '../exceptions/InvalidChannelException.js'

/**
 * How the requests of a channel arrive:
 * - `request`: a caller waits for the result (HTTP, CLI, service, MCP, D-Bus).
 * - `delivery`: no caller waits, the adapter acknowledges the outcome (message queues).
 * - `trigger`: no external caller, the adapter runs the actions on its own (schedules).
 */
export type ChannelKind = 'request' | 'delivery' | 'trigger'

/**
 * An action of a channel, as given to {@link ChannelDefinition.createMatcher}: one per address.
 */
export interface ChannelEntry {
    /**
     * The action's details: its address (`details.pattern`), controller, method, DTO and options.
     */
    readonly details: ActionDetails
    /**
     * The action's description, with the fields of {@link ChannelDefinition.describe}.
     */
    readonly info: BaseActionInfo & Record<string, unknown>
}

/**
 * The action matching a request, with the parameters taken from its address.
 */
export interface ChannelMatch {
    /**
     * The matching action: one of the entries given to {@link ChannelDefinition.createMatcher}.
     */
    readonly entry: ChannelEntry
    /**
     * The parameters taken from the request's address (such as route parameters); they are merged into the action's
     * input and take precedence over the request's data.
     */
    readonly params?: Record<string, unknown>
}

/**
 * The lookup of a channel's actions, created by {@link ChannelDefinition.createMatcher}.
 */
export interface ChannelMatcher {
    /**
     * Find the action of a request.
     * @param context The request's context.
     * @returns The matching action, `undefined` when none matches (the request then fails with
     * {@link ChannelDefinition.notFound}).
     */
    match(context: BaseContext): ChannelMatch | undefined
}

/**
 * A channel: how the actions declare their addresses and how a request finds its action. The entrypoint package
 * defines `http`, `cli`, `service` and `schedule`; a package providing another transport defines its channel with
 * {@link defineChannel} and registers the actions of its decorators with `registerControllerAction`.
 */
export interface ChannelDefinition {
    /**
     * The channel's name, which is also the key of its adapters in the entrypoint options.
     */
    readonly name: string
    /**
     * How the channel's requests arrive.
     */
    readonly kind: ChannelKind
    /**
     * The `type` of the channel's request contexts; the access control rules are selected by it.
     */
    readonly contextType: string

    /**
     * Check, and possibly normalize, an address when an action is declared and when a controller prefix is applied to
     * it; throw to reject it.
     * @param address The address given to the action decorator.
     * @returns The address to register.
     */
    validate?(address: ActionPattern): ActionPattern

    /**
     * The text identifying an address, from which the action's id is derived: two addresses with the same text are
     * the same action.
     * @param address The action's address.
     * @returns The identifying text.
     */
    identify(address: ActionPattern): string

    /**
     * The fields describing an address in the action's description (such as `{route}` for HTTP).
     * @param address The action's address.
     * @returns The fields added to the action's description.
     */
    describe(address: ActionPattern): Record<string, unknown>

    /**
     * Apply a controller's prefixes to an address; without this method the channel's addresses are not prefixed.
     * @param prefix The controller's prefixes (set with `@Prefix`).
     * @param address The action's address.
     * @returns The prefixed address, `undefined` when the prefixes do not concern the channel.
     */
    prefix?(prefix: PrefixOptions, address: ActionPattern): ActionPattern | undefined

    /**
     * Create the lookup of the channel's actions, once when the entrypoint starts.
     * @param entries The channel's actions, one per address.
     * @returns The lookup.
     */
    createMatcher(entries: ChannelEntry[]): ChannelMatcher

    /**
     * Prepare a matched request's context before its dispatch (the service channel removes the pattern keys from the
     * data). Not called for the requests dispatched to an action directly (`ChannelRuntime.dispatchTo`).
     * @param entry The matched action.
     * @param context The request's context, changed in place.
     */
    prepare?(entry: ChannelEntry, context: BaseContext): void

    /**
     * The error a request matching no action fails with.
     * @param context The request's context.
     * @returns The error to throw.
     */
    notFound(context: BaseContext): Error
}

const channels: Map<string, ChannelDefinition> = new Map()

/**
 * Define a channel. A package providing a channel defines it when it is loaded; defining the same definition object
 * again does nothing.
 * @param definition The channel's definition.
 * @returns The same definition.
 * @throws {InvalidChannelException} When another definition already has the name.
 * @example
 * ```typescript
 * import {Controller, ControllerActionNotFoundException, type BaseContext, type ControllerProperty} from 'lakutata/com/entrypoint'
 * import {defineChannel, registerControllerAction, type ChannelEntry} from '@lakutata/entrypoint/channel'
 * import {FlexibleDTO} from 'lakutata/dtos'
 *
 * //A channel of the messages of a queue, addressed by their topic
 * export const QueueChannel = defineChannel({
 *     name: 'queue',
 *     kind: 'delivery',
 *     contextType: 'QUEUE',
 *     identify: (address): string => address.topic,
 *     describe: (address): Record<string, unknown> => ({topic: address.topic}),
 *     createMatcher: (entries: ChannelEntry[]) => ({
 *         match: (context: BaseContext) => {
 *             const entry: ChannelEntry | undefined = entries.find(candidate => candidate.details.pattern.topic === context.topic)
 *             return entry ? {entry: entry} : undefined
 *         }
 *     }),
 *     notFound: (context: BaseContext): Error => new ControllerActionNotFoundException('No action handles the topic {topic}', {topic: context.topic})
 * })
 *
 * //The decorator declaring the actions of the channel
 * export function OnMessage(topic: string) {
 *     return <ClassPrototype extends Controller>(target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>): void => {
 *         registerControllerAction(QueueChannel, target, propertyKey, {topic: topic}, FlexibleDTO, {})
 *     }
 * }
 * ```
 */
export function defineChannel<Definition extends ChannelDefinition>(definition: Definition): Definition {
    const defined: ChannelDefinition | undefined = channels.get(definition.name)
    if (defined && defined !== definition) throw new InvalidChannelException('The channel "{0}" is already defined', [definition.name])
    channels.set(definition.name, definition)
    return definition
}

/**
 * Get a defined channel.
 * @param name The channel's name.
 * @returns The channel's definition.
 * @throws {InvalidChannelException} When no channel has the name.
 * @example
 * ```typescript
 * import {getChannel, type ChannelDefinition} from '@lakutata/entrypoint/channel'
 *
 * const http: ChannelDefinition = getChannel('http')
 * console.log(http.kind, http.contextType) //request HTTP
 * ```
 */
export function getChannel(name: string): ChannelDefinition {
    const definition: ChannelDefinition | undefined = channels.get(name)
    if (!definition) throw new InvalidChannelException('The channel "{0}" is not defined', [name])
    return definition
}

/**
 * Whether a channel is defined.
 * @param name The channel's name.
 * @returns `true` when a channel has the name.
 * @example
 * ```typescript
 * import {hasChannel} from '@lakutata/entrypoint/channel'
 *
 * console.log(hasChannel('schedule')) //true
 * console.log(hasChannel('queue')) //false until a package defines it
 * ```
 */
export function hasChannel(name: string): boolean {
    return channels.has(name)
}

/**
 * Find the channel whose requests have a context type.
 * @param contextType The `type` of a request context (`HTTP`, `CLI`…).
 * @returns The first channel defined with the context type, `undefined` when there is none.
 * @example
 * ```typescript
 * import {ContextType, type BaseContext} from 'lakutata/com/entrypoint'
 * import {getChannelByContextType} from '@lakutata/entrypoint/channel'
 *
 * declare const context: BaseContext
 *
 * console.log(getChannelByContextType(ContextType.SERVICE)?.name) //service
 * console.log(getChannelByContextType(context.type)?.name)
 * ```
 */
export function getChannelByContextType(contextType: string): ChannelDefinition | undefined {
    for (const definition of channels.values()) if (definition.contextType === contextType) return definition
    return undefined
}

import type {ActionPattern} from '@lakutata/core'
import {ControllerActionNotFoundException, type BaseContext, type EntrypointAdapter} from '@lakutata/entrypoint'
import {defineChannel, getChannel, hasChannel, type ChannelDefinition, type ChannelEntry, type ChannelMatch, type ChannelMatcher} from '@lakutata/entrypoint/channel'
import {QUEUE_CONTEXT_TYPE, type QueueContext} from '../context/QueueContext.js'

declare module '@lakutata/entrypoint' {
    interface EntrypointOptions {
        /**
         * The adapter delivering the messages of the queues to the `@QueueAction` actions ({@link queueEntrypoint}).
         */
        queue?: EntrypointAdapter<QueueContext> | EntrypointAdapter<QueueContext>[]
    }
}

/**
 * The key of an action of the queue channel: its queue and its group (several groups of an application may consume a
 * queue, each with its own action)
 * @param pattern
 */
function addressKey(pattern: ActionPattern): string {
    return `${pattern.queue}#${pattern.group ?? ''}`
}

/**
 * The queue channel (`'queue'`, delivery): its actions are the `@QueueAction` methods, their address the queue (and
 * the group) they consume; {@link queueEntrypoint} delivers the messages to them. Its contexts are the
 * {@link QueueContext} (`'QUEUE'`).
 * @example
 * ```typescript
 * import {QueueChannel} from '@lakutata/queue'
 *
 * console.log(QueueChannel.name, QueueChannel.kind) //queue delivery
 * ```
 */
export const QueueChannel: ChannelDefinition = hasChannel('queue') ? getChannel('queue') : defineChannel({
    name: 'queue',
    kind: 'delivery',
    contextType: QUEUE_CONTEXT_TYPE,
    validate: (pattern: ActionPattern): ActionPattern => {
        if (typeof pattern.queue !== 'string' || !pattern.queue) throw new TypeError('The queue of a @QueueAction is a non-empty string')
        if (pattern.group !== undefined && (typeof pattern.group !== 'string' || !pattern.group)) throw new TypeError('The group of a @QueueAction is a non-empty string')
        return pattern
    },
    identify: (pattern: ActionPattern): string => addressKey(pattern),
    describe: (pattern: ActionPattern): Record<string, unknown> => ({...pattern}),
    createMatcher: (entries: ChannelEntry[]): ChannelMatcher => ({
        match: (context: BaseContext): ChannelMatch | undefined => {
            const {queue, group} = context as QueueContext
            const entry: ChannelEntry | undefined = entries.find((item: ChannelEntry): boolean => item.details.pattern.queue === queue && (item.details.pattern.group === undefined || item.details.pattern.group === group))
            return entry ? {entry: entry} : undefined
        }
    }),
    notFound: (context: BaseContext): Error => new ControllerActionNotFoundException('No action processes the messages of the queue {queue}', {queue: (context as QueueContext).queue})
})

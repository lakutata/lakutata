import type {ChannelActionInfo, ChannelRuntime, EntrypointAdapter} from '@lakutata/entrypoint/channel'
import type {MiddlewareDefinition} from '@lakutata/entrypoint'
import {QueueChannel} from '../channel/QueueChannel.js'
import {QueueContext} from '../context/QueueContext.js'
import type {Queue, QueueJobContext} from '../Queue.js'
import type {QueueSubscription} from '../drivers/QueueDriver.js'
import {QueueCapabilityException} from '../exceptions/QueueCapabilityException.js'

/**
 * The options of {@link queueEntrypoint}.
 */
export type QueueEntrypointOptions = {
    /**
     * The name of the adapter (several adapters of one channel are told apart by it).
     */
    name?: string
    /**
     * The middlewares of the adapter, run for each message before the ones of the controllers and the actions.
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Called for each failure of an action (retried or not), before the retry or the dead letter.
     * @default the error written to the log of the application (`log`), else to the console
     */
    onError?: (error: unknown, action: ChannelActionInfo, context: QueueJobContext) => void | Promise<void>
}

/**
 * The adapter of the queue channel: it consumes the queues of the `@QueueAction` actions through a {@link Queue}
 * component (by its registration name) and delivers each message to its action, in a {@link QueueContext}. The options
 * of the actions are checked and their groups registered when the adapter starts (an `ordered` action on a driver
 * without the ordering fails it); the messages are consumed once the application has launched. When the application stops, the consumers stop and the
 * messages being processed complete (`shutdownTimeout` of the entrypoint); the ones still running then are delivered
 * again later, neither acknowledged nor sent to the dead letter queue.
 * @param queueComponentName The name of the {@link Queue} component.
 * @param options The name, the middlewares and the error handler of the adapter.
 * @returns The adapter, for the `queue` option of the entrypoint.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {buildQueueOptions, QueueAction, queueEntrypoint} from '@lakutata/queue'
 *
 * class MailController extends Controller {
 *     @QueueAction('mail.send')
 *     public async send(input: {to: string}): Promise<void> {
 *         console.log('mail to', input.to)
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'mail.app',
 *     name: 'Mail',
 *     components: {
 *         queue: buildQueueOptions(),
 *         entrypoint: buildEntrypoints({
 *             controllers: [MailController],
 *             queue: queueEntrypoint('queue')
 *         })
 *     }
 * }))
 * ```
 */
export function queueEntrypoint(queueComponentName: string, options: QueueEntrypointOptions = {}): EntrypointAdapter<QueueContext> {
    const subscriptions: Set<QueueSubscription> = new Set()
    let stopped: boolean = false

    /**
     * Write an error to the log of the application
     * @param runtime
     * @param error
     * @param message
     */
    const log = async (runtime: ChannelRuntime<QueueContext>, error: unknown, message: string): Promise<void> => {
        try {
            const logger: any = await runtime.getObject('log')
            logger.error(error, message)
        } catch {
            console.error(`${message}:`, error)
        }
    }

    return {
        channel: 'queue',
        definition: QueueChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<QueueContext>): Promise<void> => {
            stopped = false
            const queue: Queue = await runtime.getObject<Queue>(queueComponentName)
            //The options of the actions checked now: a wrong one fails the start of the application
            for (const action of runtime.actions)
                if (action.address.ordered && !queue.capabilities.ordering) throw new QueueCapabilityException('The driver of the queue cannot order the messages by key: the action {action} cannot be ordered', {action: action.name})
            //Their groups registered now: the messages added once the application has launched are kept for them
            for (const action of runtime.actions) await queue.prepare(action.address.queue, {group: action.address.group})
            //The messages consumed once the application has launched (its objects and the other adapters are ready)
            void runtime.ready.then(async (): Promise<void> => {
                for (const action of runtime.actions) {
                    if (stopped) return
                    const {queue: name, ...address} = action.address as Record<string, any>
                    try {
                        const subscription: QueueSubscription = await queue.consume(name, (input: Record<string, any>, context: QueueJobContext, signal: AbortSignal): Promise<unknown> => {
                            return runtime.dispatchTo(action, new QueueContext({...context, data: input}), {signal: signal})
                        }, {
                            ...address,
                            onError: async (error: unknown, context: QueueJobContext): Promise<void> => {
                                if (options.onError) return await options.onError(error, action, context)
                                await log(runtime, error, `The queue action ${action.name} failed on the message ${context.jobId} of ${context.queue} (attempt ${context.attempt} of ${context.attempts})`)
                            }
                        })
                        if (stopped) {
                            await subscription.stop()
                            return
                        }
                        subscriptions.add(subscription)
                    } catch (error: unknown) {
                        await log(runtime, error, `The queue action ${action.name} does not consume the queue ${name}`)
                    }
                }
            })
        },
        stop: async (): Promise<void> => {
            stopped = true
            await Promise.allSettled([...subscriptions].map((subscription: QueueSubscription): Promise<void> => subscription.stop()))
            subscriptions.clear()
        }
    }
}

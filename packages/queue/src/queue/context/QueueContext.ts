import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BaseContext} from '@lakutata/entrypoint'

/**
 * The `type` of every {@link QueueContext}: `'QUEUE'`. A middleware or an access rule shared by several transports tells
 * the messages of the queues apart with it.
 */
export const QUEUE_CONTEXT_TYPE: string = 'QUEUE'

/**
 * The properties of a {@link QueueContext}.
 */
export type QueueContextParams = {
    /**
     * The queue.
     */
    readonly queue: string
    /**
     * The id of the message.
     */
    readonly jobId: string
    /**
     * The group processing it.
     */
    readonly group: string
    /**
     * The attempt (1 for the first delivery).
     */
    readonly attempt: number
    /**
     * The attempts allowed.
     */
    readonly attempts: number
    /**
     * The headers of the application.
     */
    readonly headers: Record<string, string>
    /**
     * When the message was added.
     */
    readonly publishedAt: Date
    /**
     * The message: the input of the action.
     */
    readonly data: Record<string, any>
}

/**
 * The context of a message of a queue: `this.context` of a controller action declared with `@QueueAction` when
 * {@link queueEntrypoint} delivers a message to it. The adapter creates one per delivery; its `data` is the message
 * (the input of the action).
 * @example
 * ```typescript
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {QueueAction, type QueueContext} from '@lakutata/queue'
 *
 * class MailController extends Controller {
 *     @QueueAction('mail.send')
 *     public async send(input: {to: string}): Promise<void> {
 *         const context: QueueContext = this.context as QueueContext
 *         console.log(`attempt ${context.attempt} of ${context.attempts} for ${input.to} (${context.jobId})`)
 *     }
 * }
 * ```
 */
export class QueueContext<T extends Record<string, any> = {}> extends BaseContext<T> {

    /**
     * Always {@link QUEUE_CONTEXT_TYPE} (`'QUEUE'`).
     */
    @Expect(DTO.String().valid(QUEUE_CONTEXT_TYPE).default(QUEUE_CONTEXT_TYPE))
    public readonly type: string

    /**
     * The queue of the message.
     */
    @Expect(DTO.String().required())
    public readonly queue: string

    /**
     * The id of the message.
     */
    @Expect(DTO.String().required())
    public readonly jobId: string

    /**
     * The group processing it.
     */
    @Expect(DTO.String().allow('').required())
    public readonly group: string

    /**
     * The attempt: 1 for the first delivery.
     */
    @Expect(DTO.Number().integer().min(1).required())
    public readonly attempt: number

    /**
     * The attempts allowed before the message goes to the dead letter queue.
     */
    @Expect(DTO.Number().integer().min(1).required())
    public readonly attempts: number

    /**
     * The headers of the application.
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String()).default({}))
    public readonly headers: Record<string, string>

    /**
     * When the message was added.
     */
    @Expect(DTO.Date().required())
    public readonly publishedAt: Date

    /**
     * Create the context of a delivery, validating its properties.
     * @param params The queue, the message and its input.
     * @throws {InvalidValueException} When a property is missing or invalid.
     */
    constructor(params: QueueContextParams) {
        super(params)
    }
}

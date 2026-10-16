import type {DTO, MethodDecorator} from '@lakutata/core'
import type {Controller} from '@lakutata/entrypoint'
import {type ActionOptions, getActionDTOAndOptions, registerControllerAction} from '@lakutata/entrypoint/channel'
import {QueueChannel} from '../channel/QueueChannel.js'
import type {QueueContext} from '../context/QueueContext.js'
import type {QueueConsumerOptions} from '../Queue.js'

/**
 * The options of {@link QueueAction}: how the action consumes its queue (its group, concurrency, retries, time limit,
 * ordering and output queue), and the options of every action (`name`, `acl`, `rule`, `middlewares`...).
 */
export type QueueActionOptions = ActionOptions<QueueContext> & Omit<QueueConsumerOptions, 'onError'>

/**
 * The options of the queue, apart from the options of the actions
 */
const QUEUE_OPTIONS: string[] = ['group', 'concurrency', 'attempts', 'backoff', 'timeout', 'ordered', 'output']

/**
 * Process the messages of a queue with a controller action: {@link queueEntrypoint} delivers each message of the queue
 * to it (its input is the message, validated by the DTO of the action, and `this.context` a {@link QueueContext}). The
 * message is acknowledged when the action returns; after a failure it is delivered again (`attempts`, `backoff`), then
 * sent to the dead letter queue `<queue>.dead`. The value returned is the result of the message (`queue.request()`,
 * `queue.result()`), and the input of the `output` queue. The method may also carry the decorators of the other
 * channels (an HTTP route...).
 * @param name The queue.
 * @param dtoConstructorOrOptions The DTO of the input, or the options.
 * @param options The options, after a DTO.
 * @returns The method decorator.
 * @example
 * ```typescript
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {QueueAction} from '@lakutata/queue'
 *
 * class ImageController extends Controller {
 *     @QueueAction('image.extract', {concurrency: 4, attempts: 5, timeout: '10m', output: 'image.index'})
 *     public async extract(input: {id: number}): Promise<{id: number, pages: number}> {
 *         return {id: input.id, pages: 12}
 *     }
 *
 *     //The messages which failed
 *     @QueueAction('image.extract.dead')
 *     public async failed(input: {jobId: string, error: {message: string}}): Promise<void> {
 *         console.log(input.jobId, input.error.message)
 *     }
 * }
 * ```
 */
export function QueueAction<ClassPrototype extends Controller, Method>(name: string): MethodDecorator<ClassPrototype, Method, any>
export function QueueAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, any>
export function QueueAction<ClassPrototype extends Controller, Method>(name: string, options: QueueActionOptions): MethodDecorator<ClassPrototype, Method, any>
export function QueueAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor, options: QueueActionOptions): MethodDecorator<ClassPrototype, Method, any>
export function QueueAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructorOrOptions?: DTOConstructor | QueueActionOptions, options?: QueueActionOptions): MethodDecorator<ClassPrototype, Method, any> {
    return (target: ClassPrototype, propertyKey: any, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        const isDTO: boolean = typeof dtoConstructorOrOptions === 'function'
        const all: Record<string, any> = (isDTO ? options : dtoConstructorOrOptions as QueueActionOptions | undefined) ?? {}
        const pattern: Record<string, any> = {queue: name}
        const actionOptions: Record<string, any> = {}
        for (const [key, value] of Object.entries(all)) {
            if (QUEUE_OPTIONS.includes(key)) {
                if (value !== undefined) pattern[key] = value
            } else actionOptions[key] = value
        }
        const [dtoConstructor, validatedOptions] = isDTO
            ? getActionDTOAndOptions(dtoConstructorOrOptions as DTOConstructor, actionOptions)
            : getActionDTOAndOptions(actionOptions)
        registerControllerAction(QueueChannel, target, propertyKey as never, pattern, dtoConstructor, validatedOptions)
        return descriptor
    }
}

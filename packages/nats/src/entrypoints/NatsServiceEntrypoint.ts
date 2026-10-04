import type {Subscription} from 'nats'
import {Application} from '@lakutata/core'
import {ServiceContext, type EntrypointAdapter, type MiddlewareDefinition} from '@lakutata/entrypoint'
import {ServiceChannel, ServiceResponseCodec, type ChannelRuntime, type ServiceResponse} from '@lakutata/entrypoint/channel'
import type {NATS} from '../components/NATS.js'
import {ServiceEventCodec} from '../lib/ServiceEventCodec.js'

/**
 * The options of {@link NatsServiceEntrypoint}.
 */
export type NatsServiceEntrypointOptions = {
    /**
     * The adapter name, to tell apart several service adapters of one entrypoint.
     */
    name?: string
    /**
     * The subject the requests are received on: the `serviceId` the service proxies use. The events of
     * `Entrypoint.broadcast()` are published under it; the ones of `NATS.emitServiceEvent()` under the application id.
     * @default the application id (its `id` option)
     */
    subject?: string
    /**
     * The queue group sharing the requests between the instances of the service: each request is handled by one of
     * them.
     * @default `{subject}.serviceQueue`
     */
    queue?: string
    /**
     * The middlewares of this adapter's actions, run after the entrypoint's global middlewares.
     */
    middlewares?: MiddlewareDefinition[]
}

/**
 * Create a service adapter of an entrypoint served over NATS: the requests sent to the application's id (by the
 * {@link ServiceProxy} components of the other applications, or any NATS client) are dispatched to the controllers'
 * service actions, through the {@link NATS} component registered under `natsComponentName`.
 *
 * A request's payload is the message matched against the `@ServiceAction` patterns: the action's pattern and its input
 * in one object. It is answered with a service response `{success, error, payload}` (see `ServiceResponseCodec`):
 * `payload` is the action's result, or `error` the properties of the error when the action failed (no matching action,
 * validation, access denied…). A request whose payload cannot be decoded, or whose response cannot be sent, is answered
 * with such an error too, so the requester does not wait for its timeout. A published message (without reply subject)
 * runs the action without answer.
 *
 * The instances of the service share the requests through a queue group: each request is handled by one of them. Large
 * requests and responses go through the NATS component's bulk channel. `Entrypoint.broadcast()` publishes its events
 * under the entrypoint's subject, to the proxies of the service (it counts them 0: NATS does not tell how many receive
 * them); `Entrypoint.notify()` does not reach it (NATS has no client ids). When the entrypoint stops, the subscription is drained: no request is received any more
 * (the callers get no responder and retry), the requests in progress are answered.
 * @param natsComponentName The name of the NATS component, as registered in the components; the entrypoint fails to
 * start when it is not registered.
 * @param options The subject, the queue group, the adapter name and its middlewares.
 * @returns The adapter, to give to the `service` option of `BuildEntrypoints`.
 * @example
 * ```typescript
 * import {Application, DTO} from 'lakutata'
 * import {BuildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {buildNatsClientOptions, NatsServiceEntrypoint} from '@lakutata/nats'
 *
 * class GetOrderDTO extends DTO {
 *     @Expect(DTO.Number().integer().required())
 *     public id!: number
 * }
 *
 * class OrderController extends Controller {
 *     //Invoked by orderService.invoke({cmd: 'order.get', id: 1}) in the other applications
 *     @ServiceAction({cmd: 'order.get'}, GetOrderDTO)
 *     public async get(input: GetOrderDTO): Promise<{ id: number, total: number }> {
 *         return {id: input.id, total: 42}
 *     }
 * }
 *
 * Application.run({
 *     //The subject of the requests: the serviceId of the proxies
 *     id: 'order.service',
 *     name: 'OrderService',
 *     components: {
 *         nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222'}),
 *         entrypoint: BuildEntrypoints({
 *             controllers: [OrderController],
 *             service: NatsServiceEntrypoint('nats')
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * })
 * ```
 */
export function NatsServiceEntrypoint(natsComponentName: string, options: NatsServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    let subscription: Subscription | undefined
    let nats: NATS | undefined
    let subject: string | undefined
    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<ServiceContext>): Promise<void> => {
            nats = await runtime.module.getObject<NATS>(natsComponentName)
            subject = options.subject ?? Application.appId
            subscription = nats.subscribe(subject, async (payload: Record<string, unknown>): Promise<ServiceResponse> => {
                try {
                    return ServiceResponseCodec.encode(await runtime.dispatch(new ServiceContext({data: payload})), false)
                } catch (e) {
                    return ServiceResponseCodec.encodeError(e)
                }
            }, {
                queue: options.queue ?? `${subject}.serviceQueue`,
                //The failures outside of the dispatch (a payload which cannot be decoded, a response which cannot be encoded)
                //are answered too, so the requester does not wait for its timeout
                errorResponse: (error: unknown): ServiceResponse => ServiceResponseCodec.encodeError(error)
            })
        },
        //The events published under the subject of the entrypoint, to the proxies of its service (their serviceId); NATS
        //does not tell how many receive them: counted 0. NATS has no client ids: notify() pushes to none
        broadcast: (event: string, args: unknown[]): number => {
            if (nats && subject) nats.publish(ServiceEventCodec.formatSubject(subject, event), ServiceEventCodec.encode(args))
            return 0
        },
        stop: async (): Promise<void> => {
            //No request is received any more, the requests in progress are awaited by the entrypoint
            try {
                await subscription?.drain()
            } catch {
                //The connection is already closed
            }
        }
    }
}

/**
 * The former name of {@link NatsServiceEntrypoint}, kept for the applications written for 2.x; it behaves the same.
 * @param natsComponentName The name of the NATS component, as registered in the components.
 * @param options The subject, the queue group, the adapter name and its middlewares.
 * @returns The adapter, to give to the `service` option of `BuildEntrypoints`.
 * @example
 * ```typescript
 * import {BuildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {SetupNatsServiceEntrypoint} from '@lakutata/nats'
 *
 * class OrderController extends Controller {
 * }
 *
 * //The same as NatsServiceEntrypoint('nats')
 * export const entrypoint = BuildEntrypoints({controllers: [OrderController], service: SetupNatsServiceEntrypoint('nats')})
 * ```
 */
export const SetupNatsServiceEntrypoint: (natsComponentName: string, options?: NatsServiceEntrypointOptions) => EntrypointAdapter<ServiceContext> = NatsServiceEntrypoint

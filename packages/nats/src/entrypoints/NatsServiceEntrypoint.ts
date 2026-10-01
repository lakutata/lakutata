import type {Subscription} from 'nats'
import {Application} from '@lakutata/core'
import {ServiceContext, type EntrypointAdapter, type MiddlewareDefinition} from '@lakutata/entrypoint'
import {ServiceChannel, ServiceResponseCodec, type ChannelRuntime, type ServiceResponse} from '@lakutata/entrypoint/channel'
import type {NATS} from '../components/NATS.js'

export type NatsServiceEntrypointOptions = {
    /**
     * The adapter name
     */
    name?: string
    /**
     * The subject of the service requests, the application id by default (the service id of the service proxies)
     */
    subject?: string
    /**
     * The queue group sharing the requests between the instances of the service, "{subject}.serviceQueue" by default
     */
    queue?: string
    /**
     * The middlewares of the actions of this adapter, run after the global middlewares
     */
    middlewares?: MiddlewareDefinition[]
}

/**
 * The service entrypoint served over NATS: the requests of the service proxies are dispatched to the service actions,
 * the results and the errors are answered as service responses
 * @param natsComponentName the name of the NATS component
 * @param options
 */
export function NatsServiceEntrypoint(natsComponentName: string, options: NatsServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    let subscription: Subscription | undefined
    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<ServiceContext>): Promise<void> => {
            const nats: NATS = await runtime.module.getObject<NATS>(natsComponentName)
            const subject: string = options.subject ?? Application.appId
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
 * The service entrypoint served over NATS (the name of 2.x)
 * @param natsComponentName
 * @param options
 */
export const SetupNatsServiceEntrypoint: (natsComponentName: string, options?: NatsServiceEntrypointOptions) => EntrypointAdapter<ServiceContext> = NatsServiceEntrypoint

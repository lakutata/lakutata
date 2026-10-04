import {randomUUID} from 'node:crypto'
import type {AddressInfo} from 'node:net'
import {EntrypointStoppedException, ServiceContext, type EntrypointAdapter, type MiddlewareDefinition} from '@lakutata/entrypoint'
import {ServiceChannel, ServiceResponseCodec, type ChannelRuntime, type ServiceResponse} from '@lakutata/entrypoint/channel'
import {GRPCServer, type GRPCServerCall, type GRPCServerTLSOptions} from '../lib/GRPC.js'
import type {Message} from '../lib/Protobuf.js'
import {EventsRequest, FromJSONBytes, InvokeRequest, InvokeResponse, JSONBytes, SERVICE_METHODS, ServiceEvent} from './ServiceProto.js'

export type GRPCServiceEntrypointOptions = {
    /**
     * The adapter name
     */
    name?: string
    /**
     * The port of its server, 50051 by default (0 for a free one)
     */
    port?: number
    /**
     * The host of its server, all the interfaces by default
     */
    host?: string
    /**
     * A unix socket listened on, instead of a port
     */
    socketPath?: string
    /**
     * Its TLS: its certificate and its key, the authority of the certificates of its clients (the ones without its
     * certificate refused)
     */
    tls?: GRPCServerTLSOptions
    /**
     * The middlewares of the actions of this adapter, run after the global middlewares
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Run once the adapter listens, with its address (its port, its socket)
     */
    listening?: (address: AddressInfo | string) => void | Promise<void>
}

/**
 * The call of gRPC of a context, in the service actions served by GRPCServiceEntrypoint: its metadata
 * @param context
 */
export function GRPCCallOfContext(context: ServiceContext): GRPCServerCall | undefined {
    return (context as ServiceContext & { grpc?: GRPCServerCall }).grpc
}

/**
 * The service entrypoint served over gRPC (the service lakutata.service.v1.Service, SERVICE_PROTO): its Invoke is a
 * request of a service action (the JSON of its pattern and its input), answered as a service response (its result or
 * its error); its Events stream the events pushed to a client (Entrypoint.notify, broadcast), the id of a client in its
 * metadata "id"
 * @param options
 */
export function GRPCServiceEntrypoint(options: GRPCServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    let server: GRPCServer | undefined
    let stopping: boolean = false
    //The event streams of each client (a client may listen several times)
    const clients: Map<string, Set<GRPCServerCall>> = new Map()

    const send = (call: GRPCServerCall, event: string, args: unknown[]): void => {
        call.send(ServiceEvent, {event: event, args: JSONBytes(args)}).catch((): undefined => undefined)
    }

    /**
     * The response of a request of an action
     * @param runtime
     * @param call
     */
    const invoke = async (runtime: ChannelRuntime<ServiceContext>, call: GRPCServerCall): Promise<void> => {
        const request: Message = await call.request(InvokeRequest)
        let response: ServiceResponse
        if (stopping) {
            response = ServiceResponseCodec.encodeError(new EntrypointStoppedException('The entrypoint is stopping'))
        } else {
            //Aborted when its client cancels it
            const aborted: AbortController = new AbortController()
            call.stream.once('close', (): void => {
                if (!call.stream.writableFinished) aborted.abort()
            })
            try {
                let data: unknown
                try {
                    data = FromJSONBytes(request.data) ?? {}
                } catch {
                    throw new Error('The data of the request is not JSON')
                }
                const context: ServiceContext = new ServiceContext({data: data && typeof data === 'object' ? data as Record<string, unknown> : {}, clientId: call.metadata('id')[0], grpc: call})
                response = ServiceResponseCodec.encode(await runtime.dispatch(context, {signal: aborted.signal}), false)
            } catch (error: unknown) {
                response = ServiceResponseCodec.encodeError(error)
            }
        }
        await call.send(InvokeResponse, {success: response.success, payload: JSONBytes(response.payload ?? undefined), error: JSONBytes(response.error ?? undefined)})
    }

    /**
     * Stream the events of a client, until it closes its stream
     * @param call
     */
    const listen = async (call: GRPCServerCall): Promise<void> => {
        await call.request(EventsRequest)
        const clientId: string = call.metadata('id')[0] ?? randomUUID()
        if (!clients.has(clientId)) clients.set(clientId, new Set())
        clients.get(clientId)!.add(call)
        //Its id, given to the requests of the client (their metadata id)
        send(call, 'client', [clientId])
        await new Promise<void>((resolve: () => void): void => {
            if (call.stream.closed) return resolve()
            call.stream.once('close', resolve)
        })
        clients.get(clientId)?.delete(call)
        if (!clients.get(clientId)?.size) clients.delete(clientId)
    }

    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<ServiceContext>): Promise<void> => {
            server = new GRPCServer({tls: options.tls})
            server.method(SERVICE_METHODS.INVOKE, (call: GRPCServerCall): Promise<void> => invoke(runtime, call))
            server.method(SERVICE_METHODS.EVENTS, listen)
            const address: AddressInfo | string = await server.listen({port: options.port ?? 50051, host: options.host, socketPath: options.socketPath})
            await options.listening?.(address)
        },
        stop: (): void => {
            //The new requests are refused, the requests in progress end
            stopping = true
        },
        close: async (): Promise<void> => {
            clients.forEach((calls: Set<GRPCServerCall>): void => calls.forEach((call: GRPCServerCall): void => call.finish()))
            clients.clear()
            await server?.close()
        },
        notify: (clientId: string, event: string, args: unknown[]): boolean => {
            const calls: Set<GRPCServerCall> | undefined = clients.get(clientId)
            calls?.forEach((call: GRPCServerCall): void => send(call, event, args))
            return !!calls?.size
        },
        broadcast: (event: string, args: unknown[]): number => {
            clients.forEach((calls: Set<GRPCServerCall>): void => calls.forEach((call: GRPCServerCall): void => send(call, event, args)))
            return clients.size
        }
    }
}

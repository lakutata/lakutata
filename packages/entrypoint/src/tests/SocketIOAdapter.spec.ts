import {describe, it} from 'node:test'
import assert from 'node:assert'
import type {AddressInfo} from 'node:net'
import type {Server} from 'node:http'
import {io as Connect, type Socket as ClientSocket} from 'socket.io-client'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ActionInvocation, BuildEntrypoints, Controller, Entrypoint, MiddlewareHandler, Next, ServiceContext} from '../exports/Entrypoint.js'
import {GET, ServiceAction} from '../exports/CTRLDecorators.js'
import {ExpressHTTPEntrypoint} from '../exports/ExpressAdapter.js'
import {SocketIOServiceEntrypoint, SocketIOServiceEntrypointOptions, SocketOfContext} from '../exports/SocketIOAdapter.js'

class EchoDTO extends DTO {
    @Expect(DTO.Number().required())
    public value: number
}

let signals: AbortSignal[] = []

const fired: number[] = []

class EchoController extends Controller {

    @ServiceAction({cmd: 'echo'}, EchoDTO)
    public async echo(input: EchoDTO): Promise<unknown> {
        return {value: input.value, socket: SocketOfContext(this.context as ServiceContext)?.id}
    }

    @ServiceAction({cmd: 'fire'}, EchoDTO)
    public async fire(input: EchoDTO): Promise<void> {
        fired.push(input.value)
    }

    @ServiceAction({cmd: 'slow'})
    public async slow(): Promise<string> {
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 150))
        return 'slow'
    }

    @GET('/health')
    public async health(): Promise<unknown> {
        return {status: 'ok'}
    }
}

/**
 * Start an entrypoint with a socket.io adapter on a random port
 * @param options
 * @param entrypointOptions
 */
async function Start(options: SocketIOServiceEntrypointOptions = {}, entrypointOptions: Record<string, unknown> = {}): Promise<{ url: string, container: Container }> {
    let port: number = 0
    const container: Container = new Container()
    await container.set(Entrypoint, BuildEntrypoints({
        controllers: [EchoController],
        ...entrypointOptions,
        service: SocketIOServiceEntrypoint({
            port: 0,
            host: '127.0.0.1',
            ...options,
            listening: (io, server): void => {
                port = (server!.address() as AddressInfo).port
            }
        })
    }))
    return {url: `http://127.0.0.1:${port}`, container: container}
}

/**
 * A connected client
 * @param url
 */
async function Client(url: string): Promise<ClientSocket> {
    const client: ClientSocket = Connect(url, {transports: ['websocket'], reconnection: false})
    await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
        client.once('connect', resolve).once('connect_error', reject)
    })
    return client
}

/**
 * Send a request and wait for its response
 * @param client
 * @param data
 */
function Request(client: ClientSocket, data: unknown): Promise<any> {
    return client.timeout(3000).emitWithAck('message', data)
}

describe('Socket.IO adapter', (): void => {

    it('answers the requests with the responses of the actions', async (): Promise<void> => {
        const {url, container} = await Start()
        const client: ClientSocket = await Client(url)
        assert.deepStrictEqual(await Request(client, {cmd: 'echo', value: 7}), {success: true, error: null, payload: {value: 7, socket: client.id}})
        const invalid = await Request(client, {cmd: 'echo', value: 'x'})
        assert.strictEqual(invalid.success, false)
        assert.strictEqual(invalid.error.errno, 'E_INVALID_VALUE')
        const unknown = await Request(client, {cmd: 'nothing'})
        assert.strictEqual(unknown.success, false)
        //A request without acknowledgement runs the action
        client.emit('message', {cmd: 'fire', value: 3})
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
        assert.deepStrictEqual(fired, [3])
        client.disconnect()
        await container.destroy()
    })

    it('runs the middlewares of the adapter and aborts the requests of the clients who left', async (): Promise<void> => {
        const trace: string[] = []
        const traced = (name: string): MiddlewareHandler => async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
            trace.push(name)
            signals.push(invocation.signal!)
            return next()
        }
        const {url, container} = await Start({middlewares: [traced('adapter')]}, {middlewares: [traced('global')]})
        const client: ClientSocket = await Client(url)
        await Request(client, {cmd: 'echo', value: 1})
        assert.deepStrictEqual(trace, ['global', 'adapter'])
        signals = []
        client.emit('message', {cmd: 'slow'}, (): void => undefined)
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
        client.disconnect()
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
        assert.ok(signals.at(-1)!.aborted)
        await container.destroy()
    })

    it('shares the server of the express adapter', async (): Promise<void> => {
        let server: Server | undefined
        const container: Container = new Container()
        await container.set(Entrypoint, BuildEntrypoints({
            controllers: [EchoController],
            http: ExpressHTTPEntrypoint({port: 0, host: '127.0.0.1', before: (app, context): void => {
                server = context.server
            }}),
            service: SocketIOServiceEntrypoint({server: (): Server => server!})
        }))
        const url: string = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
        const client: ClientSocket = await Client(url)
        assert.strictEqual((await Request(client, {cmd: 'echo', value: 2})).payload.value, 2)
        assert.deepStrictEqual(await (await fetch(`${url}/health`)).json(), {status: 'ok'})
        client.disconnect()
        await container.destroy()
        assert.ok(!server!.listening)
    })

    it('stops gracefully', async (): Promise<void> => {
        const {url, container} = await Start()
        const client: ClientSocket = await Client(url)
        const inProgress: Promise<any> = Request(client, {cmd: 'slow'})
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
        const destroyed: Promise<void> = container.destroy()
        //The new requests are refused while the requests in progress end
        const refused = await Request(client, {cmd: 'echo', value: 1})
        assert.strictEqual(refused.error.errno, 'E_ENTRYPOINT_STOPPED')
        assert.deepStrictEqual(await inProgress, {success: true, error: null, payload: 'slow'})
        await destroyed
        client.disconnect()
    })
})

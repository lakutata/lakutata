import {describe, it} from 'node:test'
import assert from 'node:assert'
import type {AddressInfo} from 'node:net'
import {createServer, type Server} from 'node:http'
import {Server as SocketIOServer} from 'socket.io'
import {io as Connect, type ManagerOptions, type Socket as ClientSocket, type SocketOptions} from 'socket.io-client'
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

    @ServiceAction({cmd: 'whoami'})
    public async whoami(): Promise<string | undefined> {
        return (this.context as ServiceContext).clientId
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
async function Client(url: string, options: Partial<ManagerOptions & SocketOptions> = {}): Promise<ClientSocket> {
    const client: ClientSocket = Connect(url, {transports: ['websocket'], reconnection: false, ...options})
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

    it('pushes the events to the clients by their ids (given when they connect), to every client', async (): Promise<void> => {
        const {url, container} = await Start()
        const entrypoint: Entrypoint = await container.get(Entrypoint)
        //Its id given by its auth, by its header (Postman), its own one otherwise
        const desk: ClientSocket = await Client(url, {auth: {id: 'desk'}})
        const tool: ClientSocket = await Client(url, {extraHeaders: {id: 'postman'}})
        const anonymous: ClientSocket = await Client(url)
        const whoami = (client: ClientSocket): Promise<any> => client.emitWithAck('message', {cmd: 'whoami'})
        assert.strictEqual((await whoami(desk)).payload, 'desk')
        assert.strictEqual((await whoami(tool)).payload, 'postman')
        assert.strictEqual((await whoami(anonymous)).payload, anonymous.id)
        const received = (client: ClientSocket, event: string): Promise<unknown[]> => new Promise((resolve: (args: unknown[]) => void): unknown => client.once(event, (...args: unknown[]): void => resolve(args)))
        const progress: Promise<unknown[]> = received(desk, 'progress')
        assert.strictEqual(entrypoint.notify('desk', 'progress', 1, 'a'), true)
        assert.deepStrictEqual(await progress, [1, 'a'])
        assert.strictEqual(entrypoint.notify('nobody', 'progress'), false)
        const all: Promise<unknown[][]> = Promise.all([desk, tool, anonymous].map((client: ClientSocket): Promise<unknown[]> => received(client, 'all')))
        assert.strictEqual(entrypoint.broadcast('all', 2), 3)
        assert.deepStrictEqual(await all, [[2], [2], [2]])
        //A disconnected client has no socket
        desk.disconnect()
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 100))
        assert.strictEqual(entrypoint.notify('desk', 'progress'), false)
        tool.disconnect()
        anonymous.disconnect()
        await container.destroy()
    })

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

    it('leaves the sockets of a given io without its listeners once closed', async (): Promise<void> => {
        const server: Server = createServer()
        const io: SocketIOServer = new SocketIOServer(server)
        await new Promise<void>((resolve: () => void): unknown => server.listen(0, '127.0.0.1', resolve))
        const url: string = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        const container: Container = new Container()
        await container.set(Entrypoint, BuildEntrypoints({controllers: [EchoController], service: SocketIOServiceEntrypoint({io: io})}))
        const client: ClientSocket = await Client(url)
        try {
            assert.strictEqual((await Request(client, {cmd: 'echo', value: 1})).success, true)
            await container.destroy()
            //Still connected to the io, the socket has no listener of the adapter
            const [socket] = await io.fetchSockets()
            assert.ok(socket)
            const serverSocket = io.of('/').sockets.get(socket.id)!
            assert.strictEqual(serverSocket.listeners('message').length, 0)
            await assert.rejects(client.timeout(200).emitWithAck('message', {cmd: 'echo', value: 2}))
        } finally {
            client.disconnect()
            await new Promise<void>((resolve: () => void): void => void io.close((): void => resolve()))
        }
    })
})

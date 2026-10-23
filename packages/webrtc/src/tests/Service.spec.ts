import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createServer, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {buildEntrypoints, Controller, Entrypoint, type ServiceContext} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {jsonRPCRequestOfContext} from '@lakutata/entrypoint/adapter/jsonrpc'
import {socketIOServiceEntrypoint} from '@lakutata/entrypoint/adapter/socket.io'
import {type Peer, type Room, SignalingClient} from '../peer/SignalingClient.js'
import type {PeerChannel} from '../peer/PeerChannel.js'
import {PeerServiceError, PeerServiceProxy} from '../shared/PeerServiceProxy.js'
import {webrtcRequestOfContext, webrtcServiceEntrypoint, type WebRTCRequestInfo, type WebRTCServiceEntrypointOptions} from '../service/WebRTCServiceEntrypoint.js'
import {Signaling} from '../signaling/Signaling.js'
import {SignalingController} from '../signaling/SignalingController.js'
import {next, startServer, type TestServer, until} from './support/Server.js'

/**
 * The input of the echo action
 */
class EchoDTO extends DTO {
    @Expect(DTO.String().required())
    public text: string
}

/**
 * The requests of the wait action aborted, and the slow ones answered
 */
const aborted: string[] = []

/**
 * The service actions of the device
 */
class DeviceController extends Controller {

    @ServiceAction({method: 'echo'}, EchoDTO)
    public async echo(input: {text: string}): Promise<string> {
        return input.text
    }

    @ServiceAction({method: 'whoami'})
    public async whoami(): Promise<Record<string, unknown>> {
        const context: ServiceContext = this.context as ServiceContext
        const request: WebRTCRequestInfo | undefined = webrtcRequestOfContext(context)
        return {
            clientId: context.clientId,
            peer: request?.peer.id,
            room: request?.room.name,
            metadata: request?.peer.metadata,
            label: request?.channel.label,
            transport: jsonRPCRequestOfContext(context)?.transport
        }
    }

    @ServiceAction({method: 'secret'}, {acl: true, rule: async (context: ServiceContext): Promise<boolean> => context.clientId === 'admin'})
    public async secret(): Promise<string> {
        return 'the secret'
    }

    @ServiceAction({method: 'large'})
    public async large(input: {size: number, text?: string}): Promise<{text: string, received: number}> {
        return {text: 'x'.repeat(input.size), received: input.text?.length ?? 0}
    }

    @ServiceAction({method: 'wait'})
    public async wait(input: {name: string}): Promise<void> {
        await new Promise<void>((resolve: () => void): void => {
            this.signal?.addEventListener('abort', (): void => {
                aborted.push(input.name)
                resolve()
            })
        })
    }

    @ServiceAction({method: 'slow'})
    public async slow(): Promise<string> {
        await new Promise<void>((resolve: () => void): unknown => setTimeout(resolve, 1000))
        return 'done'
    }
}

/**
 * A device: an application whose service actions are called through the data channels of its rooms
 * @param options
 */
async function device(options: WebRTCServiceEntrypointOptions): Promise<{container: Container, entrypoint: Entrypoint}> {
    const container: Container = new Container()
    const entrypoint: Entrypoint = await container.setNamed<Entrypoint>('entrypoint', Entrypoint, buildEntrypoints({
        controllers: [DeviceController],
        service: webrtcServiceEntrypoint(options)
    }))
    return {container: container, entrypoint: entrypoint}
}

/**
 * The proxy of the device's service in a room joined by a member
 * @param room
 * @param label
 */
async function proxyOf(room: Room, label: string = 'service'): Promise<PeerServiceProxy> {
    const peer: Peer = room.peer('device') ?? await next<Peer>((resolve: (peer: Peer) => void): unknown => room.on('peer', (each: Peer): void => {
        if (each.id === 'device') resolve(each)
    }), 15000, 'the device')
    return new PeerServiceProxy(peer.createDataChannel(label))
}

/**
 * The error a call fails with
 * @param call
 */
async function failure(call: Promise<unknown>): Promise<PeerServiceError> {
    try {
        await call
    } catch (error) {
        assert.ok(error instanceof PeerServiceError)
        return error
    }
    assert.fail('The call did not fail')
}

/**
 * Calls of the device by a member, through a room with or without a media server
 * @param server
 * @param room The room's name
 */
async function callsTheDevice(server: TestServer, room: string): Promise<void> {
    const errors: unknown[] = []
    const {container, entrypoint} = await device({signaling: {url: server.socketIO, id: 'device'}, rooms: [room], metadata: {kind: 'door'}, onError: (error: unknown): void => void errors.push(error)})
    const clients: Container = new Container()
    try {
        const alice: SignalingClient = await clients.get(SignalingClient, {url: server.jsonRPC, id: 'alice'})
        const joined: Room = await alice.join(room, {metadata: {name: 'Alice'}})
        const proxy: PeerServiceProxy = await proxyOf(joined)
        assert.strictEqual(await proxy.invoke({method: 'echo', text: 'hello'}), 'hello')
        assert.deepStrictEqual(await proxy.invoke({method: 'whoami'}), {
            clientId: 'alice',
            peer: 'alice',
            room: room,
            metadata: {name: 'Alice'},
            label: 'service',
            transport: 'webrtc'
        })
        assert.deepStrictEqual(joined.peer('device')!.metadata, {kind: 'door'})
        //The input validated, the access control applied, the unknown methods refused, with the whole errors
        const invalid: PeerServiceError = await failure(proxy.invoke({method: 'echo'}))
        assert.strictEqual(invalid.code, -32602)
        assert.strictEqual(invalid.errno, 'E_INVALID_VALUE')
        const denied: PeerServiceError = await failure(proxy.invoke({method: 'secret'}))
        assert.strictEqual(denied.code, -32000)
        assert.strictEqual(denied.errno, 'E_ACCESS_DENY')
        assert.strictEqual((denied.data as {errno?: string}).errno, 'E_ACCESS_DENY')
        assert.strictEqual(typeof (denied.data as {stack?: string}).stack, 'string')
        const unknown: PeerServiceError = await failure(proxy.invoke({method: 'nothing'}))
        assert.strictEqual(unknown.code, -32601)
        //Larger than a message of a data channel, both ways, several calls at once
        const results: {text: string, received: number}[] = await Promise.all([1, 2, 3].map((index: number): Promise<{text: string, received: number}> => proxy.invoke({method: 'large', size: index * 300000, text: 'y'.repeat(index * 200000)})))
        assert.deepStrictEqual(results.map((result: {text: string, received: number}): number[] => [result.text.length, result.received]), [[300000, 200000], [600000, 400000], [900000, 600000]])
        //The events pushed to the member, and to every member
        const events: unknown[][] = []
        proxy.on('progress', (...args: unknown[]): number => events.push(['progress', ...args]))
        proxy.once('news', (...args: unknown[]): number => events.push(['news', ...args]))
        assert.strictEqual(entrypoint.notify('alice', 'progress', 50, {step: 'download'}), true)
        assert.strictEqual(entrypoint.notify('bob', 'progress', 60), false)
        assert.strictEqual(entrypoint.broadcast('news', 'first'), 1)
        entrypoint.broadcast('news', 'second')
        await until((): boolean => events.length === 2, 10000, 'the events')
        assert.deepStrictEqual(events, [['progress', 50, {step: 'download'}], ['news', 'first']])
        //A channel with another label is left to the application
        const other: PeerChannel = joined.peer('device')!.createDataChannel('files')
        await next<void>((resolve: () => void): unknown => other.addEventListener('open', resolve), 15000, 'the other channel')
        assert.strictEqual(other.readyState, 'open')
        //The requests of a channel closed are aborted
        aborted.length = 0
        const waiting: Promise<unknown> = proxy.invoke({method: 'wait', name: 'first'}).catch((error: unknown): unknown => error)
        await new Promise<void>((resolve: () => void): unknown => setTimeout(resolve, 500))
        proxy.close()
        assert.strictEqual((await waiting as PeerServiceError).errno, 'E_PEER_SERVICE_CLOSED')
        await until((): boolean => aborted.includes('first'), 10000, 'the abort')
        await until((): boolean => !entrypoint.notify('alice', 'progress', 70), 10000, 'the channel removed')
        assert.deepStrictEqual(errors, [])
    } finally {
        await clients.destroy()
        await container.destroy()
    }
}

describe('WebRTC service', (): void => {

    it('serves the service actions to the members of its rooms, with the member as the client', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        try {
            await callsTheDevice(server, 'device')
        } finally {
            await server.stop()
        }
    })

    for (const workers of [0, 2]) {
        it(`serves the members of a room with a media server${workers ? `, forwarding in ${workers} worker threads` : ''}`, {timeout: 90000}, async (): Promise<void> => {
            const server: TestServer = await startServer({sfu: {workers: workers}})
            try {
                await callsTheDevice(server, 'meeting')
            } finally {
                await server.stop()
            }
        })
    }

    it('answers the requests in progress when it stops, refusing the new ones, then closes the channels', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const {container} = await device({signaling: {url: server.socketIO, id: 'device'}, rooms: ['device']})
        const clients: Container = new Container()
        try {
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'alice'})
            const proxy: PeerServiceProxy = await proxyOf(await alice.join('device'))
            assert.strictEqual(await proxy.invoke({method: 'echo', text: 'ready'}), 'ready')
            const slow: Promise<string> = proxy.invoke({method: 'slow'})
            await new Promise<void>((resolve: () => void): unknown => setTimeout(resolve, 200))
            const stopped: Promise<void> = container.destroy()
            await new Promise<void>((resolve: () => void): unknown => setTimeout(resolve, 200))
            const refused: PeerServiceError = await failure(proxy.invoke({method: 'echo', text: 'late'}))
            assert.strictEqual(refused.code, -32001)
            assert.strictEqual(await slow, 'done')
            await stopped
            //The device left its room: the channel is closed
            await until((): boolean => proxy.channel.readyState === 'closed', 10000, 'the channel closed')
            assert.strictEqual((await failure(proxy.invoke({method: 'echo', text: 'after'}))).errno, 'E_PEER_SERVICE_CLOSED')
        } finally {
            await clients.destroy()
            await server.stop()
        }
    })

    it('serves the members of a signaling server of the same application, started after the adapter', {timeout: 60000}, async (): Promise<void> => {
        //A free port, for the Socket.IO adapter started after the WebRTC one
        const probe: Server = createServer()
        await new Promise<void>((resolve: () => void): unknown => probe.listen(0, '127.0.0.1', resolve))
        const url: string = `http://127.0.0.1:${(probe.address() as AddressInfo).port}`
        await new Promise<void>((resolve: () => void): unknown => probe.close((): void => resolve()))
        const application: Container = new Container()
        const clients: Container = new Container()
        const errors: unknown[] = []
        try {
            await application.setNamed<Signaling>('signaling', Signaling, {})
            await application.setNamed<Entrypoint>('entrypoint', Entrypoint, buildEntrypoints({
                controllers: [SignalingController, DeviceController],
                service: [
                    webrtcServiceEntrypoint({signaling: {url: url, id: 'device'}, rooms: ['device'], onError: (error: unknown): void => void errors.push(error)}),
                    socketIOServiceEntrypoint({port: Number(new URL(url).port), host: '127.0.0.1'})
                ]
            }))
            const alice: SignalingClient = await clients.get(SignalingClient, {url: url, id: 'alice'})
            const proxy: PeerServiceProxy = await proxyOf(await alice.join('device'))
            assert.strictEqual(await proxy.invoke({method: 'echo', text: 'same application'}), 'same application')
            //The actions of the signaling are not served through the channel
            assert.strictEqual((await failure(proxy.invoke({method: 'webrtc.join', room: 'other'}))).errno, 'E_SIGNALING_CLIENT_REQUIRED')
            assert.deepStrictEqual(errors, [])
        } finally {
            await clients.destroy()
            await application.destroy()
        }
    })

    it('serves the rooms of a signaling client of the application, leaving it to the application', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer({signaling: {authorize: (_peer: {peerId: string}, room: string): boolean => room !== 'private'}})
        const clients: Container = new Container()
        const errors: unknown[] = []
        const own: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'device'})
        const ownRoom: Room = await own.join('device', {metadata: {kind: 'camera'}})
        const {container} = await device({
            client: (): SignalingClient => own,
            rooms: ['device', 'private'],
            onError: (error: unknown): void => void errors.push(error)
        })
        try {
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'alice'})
            const joined: Room = await alice.join('device')
            const proxy: PeerServiceProxy = await proxyOf(joined)
            assert.strictEqual(await proxy.invoke({method: 'echo', text: 'shared'}), 'shared')
            //The room joined by the application is served as it is: not joined again
            assert.deepStrictEqual(joined.peer('device')!.metadata, {kind: 'camera'})
            //A room refused is reported once, not tried again
            await until((): boolean => errors.length === 1, 10000, 'the refusal')
            assert.strictEqual((errors[0] as {errno?: string}).errno, 'E_SIGNALING_DENIED')
            await new Promise<void>((resolve: () => void): unknown => setTimeout(resolve, 2500))
            assert.strictEqual(errors.length, 1)
            await container.destroy()
            //The client and its room are the application's
            assert.strictEqual(ownRoom.left, false)
            assert.strictEqual(own.connected, true)
            await until((): boolean => proxy.channel.readyState === 'closed', 10000, 'the channel closed')
        } finally {
            await clients.destroy()
            await server.stop()
        }
    })

    it('tries a room again until it can be joined, reporting each failure', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer({signaling: {maxPeers: 1}})
        const clients: Container = new Container()
        const errors: unknown[] = []
        try {
            //The room is full: the device waits for a place
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'alice'})
            await alice.join('device')
            const {container} = await device({signaling: {url: server.socketIO, id: 'device'}, rooms: ['device'], onError: (error: unknown): void => void errors.push(error)})
            try {
                await until((): boolean => errors.length >= 2, 10000, 'two failures')
                assert.ok(errors.every((error: unknown): boolean => (error as {errno?: string}).errno === 'E_SIGNALING_LIMIT'))
                await alice.close()
                await until((): boolean => server.signaling.rooms().device?.includes('device') ?? false, 15000, 'the device in the room')
                //The device holds the one place of the room
                const bob: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'bob'})
                await assert.rejects(bob.join('device'), {errno: 'E_SIGNALING_LIMIT'})
            } finally {
                await container.destroy()
            }
        } finally {
            await clients.destroy()
            await server.stop()
        }
    })

    it('rejects the calls of a proxy without a response in time, and its input without a method', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const {container} = await device({signaling: {url: server.socketIO, id: 'device'}, rooms: ['device']})
        const clients: Container = new Container()
        try {
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'alice'})
            const proxy: PeerServiceProxy = await proxyOf(await alice.join('device'))
            assert.strictEqual((await failure(proxy.invoke({method: 'slow'}, 300))).errno, 'E_PEER_SERVICE_TIMEOUT')
            //Over the limit of the application: failed at once, not sent
            const large: PeerServiceError = await failure(proxy.invoke({method: 'large', size: 1, text: 'y'.repeat(11 * 1024 * 1024)}, 60000))
            assert.strictEqual(large.errno, 'E_PEER_SERVICE_TOO_LARGE')
            assert.strictEqual(await proxy.invoke({method: 'echo', text: 'still open'}), 'still open')
            assert.throws((): unknown => proxy.invoke({name: 'slow'}), TypeError)
            //Another method field
            const named: PeerServiceProxy = new PeerServiceProxy(alice.rooms[0].peer('device')!.createDataChannel('service'), {methodField: 'cmd'})
            assert.strictEqual(await named.invoke({cmd: 'echo', text: 'by cmd'}), 'by cmd')
        } finally {
            await clients.destroy()
            await container.destroy()
            await server.stop()
        }
    })
})

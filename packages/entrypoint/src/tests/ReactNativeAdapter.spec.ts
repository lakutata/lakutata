import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawn} from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import type {Duplex} from 'node:stream'
import {fileURLToPath} from 'node:url'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {type ActionInvocation, buildEntrypoints, Controller, Entrypoint, type Next, ServiceContext} from '../exports/Entrypoint.js'
import type {ServiceResponse} from '../exports/Channel.js'
import {ServiceAction} from '../exports/CTRLDecorators.js'
import {reactNativeServiceEntrypoint, type ReactNativeServiceMessage} from '../exports/ReactNativeAdapter.js'

class EchoDTO extends DTO {
    @Expect(DTO.Number().required())
    public value: number
}

class EchoController extends Controller {

    @ServiceAction({cmd: 'echo'}, EchoDTO)
    public async echo(input: EchoDTO): Promise<{ value: number, clientId?: string }> {
        return {value: input.value, clientId: (this.context as ServiceContext).clientId}
    }

    @ServiceAction({cmd: 'big'})
    public async big(): Promise<bigint> {
        return 1n
    }

    @ServiceAction({cmd: 'wait'})
    public async wait(): Promise<string> {
        //Its signal aborted once its client is unsubscribed
        await new Promise<void>((resolve: () => void): void => void this.signal?.addEventListener('abort', (): void => resolve(), {once: true}))
        return 'aborted'
    }

    @ServiceAction({cmd: 'notify'})
    public async notify(input: { to: string }): Promise<boolean> {
        const entrypoint: Entrypoint = await this.getObject<Entrypoint>('entrypoint')
        return entrypoint.notify(input.to, 'progress', 50)
    }
}

/**
 * The host in the tests: its end of a connection to the adapter, the lines it writes, the messages it received
 */
class FakeHost {
    public readonly received: ReactNativeServiceMessage[] = []
    #buffer: string = ''

    constructor(public readonly socket: Duplex) {
        socket.setEncoding('utf8')
        socket.on('data', (chunk: string): void => {
            this.#buffer += chunk
            for (let end: number = this.#buffer.indexOf('\n'); end >= 0; end = this.#buffer.indexOf('\n')) {
                this.received.push(JSON.parse(this.#buffer.slice(0, end)) as ReactNativeServiceMessage)
                this.#buffer = this.#buffer.slice(end + 1)
            }
        })
    }

    /**
     * Write a message of the host as a line
     * @param message
     */
    public send(message: unknown): void {
        this.socket.write(JSON.stringify(message) + '\n')
    }

    /**
     * The first message received matching a test, once received
     * @param test
     */
    public async message(test: (message: ReactNativeServiceMessage) => boolean): Promise<ReactNativeServiceMessage> {
        for (let attempt: number = 0; attempt < 200; attempt++) {
            const found: ReactNativeServiceMessage | undefined = this.received.find(test)
            if (found) return found
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 10))
        }
        throw new Error('No such message')
    }

    /**
     * The response of an invocation, once received
     * @param id
     */
    public async response(id: string | number): Promise<ServiceResponse> {
        return (await this.message((message: ReactNativeServiceMessage): boolean => message.type === 'response' && message.id === id)).response!
    }
}

/**
 * Two sockets connected to each other (the end of the host, the end of the adapter)
 */
async function connectedPair(): Promise<[net.Socket, net.Socket]> {
    const server: net.Server = net.createServer()
    await new Promise<void>((resolve: () => void): unknown => server.listen(0, '127.0.0.1', resolve))
    const accepted: Promise<net.Socket> = new Promise((resolve: (socket: net.Socket) => void): unknown => server.once('connection', resolve))
    const host: net.Socket = net.connect((server.address() as net.AddressInfo).port, '127.0.0.1')
    const adapter: net.Socket = await accepted
    server.close()
    return [host, adapter]
}

/**
 * Start an application whose entrypoint serves the adapter's end of a connection
 * @param socket
 * @param options
 */
async function start(socket: Duplex, options: Partial<Parameters<typeof reactNativeServiceEntrypoint>[0]> = {}): Promise<Container> {
    const container: Container = new Container()
    await container.setNamed<Entrypoint>('entrypoint', Entrypoint, buildEntrypoints({
        controllers: [EchoController],
        service: reactNativeServiceEntrypoint({socket: socket, ...options})
    }))
    return container
}

describe('React Native service adapter', (): void => {

    it('answers the invocations of the host in lines of JSON, its errors whole', async (): Promise<void> => {
        const [hostEnd, adapterEnd] = await connectedPair()
        const host: FakeHost = new FakeHost(hostEnd)
        //Written before the application listens: it waits in the socket
        host.send({type: 'invoke', id: 0, data: {cmd: 'echo', value: 1}})
        const container: Container = await start(adapterEnd)
        try {
            assert.deepStrictEqual(await host.response(0), {success: true, error: null, payload: {value: 1}})
            host.send({type: 'invoke', id: 1, clientId: 'ui', data: {cmd: 'echo', value: 3}})
            assert.deepStrictEqual(await host.response(1), {success: true, error: null, payload: {value: 3, clientId: 'ui'}})
            //A line cut across writes
            const line: string = JSON.stringify({type: 'invoke', id: 'two', data: {cmd: 'echo', value: 'x'}}) + '\n'
            hostEnd.write(line.slice(0, 10))
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
            hostEnd.write(line.slice(10))
            const failed: ServiceResponse = await host.response('two')
            assert.strictEqual(failed.success, false)
            assert.strictEqual((failed.error as unknown as Record<string, unknown>).errno, 'E_INVALID_VALUE')
            host.send({type: 'invoke', id: 3, data: {cmd: 'missing'}})
            assert.strictEqual(((await host.response(3)).error as unknown as Record<string, unknown>).statusCode, 404)
            //A result JSON cannot hold: an error
            host.send({type: 'invoke', id: 4, data: {cmd: 'big'}})
            assert.match(((await host.response(4)).error as unknown as Record<string, unknown>).message as string, /cannot be sent as JSON/)
            //The lines that are not requests are ignored
            hostEnd.write('hello\n\n')
            host.send('hello')
            host.send({type: 'invoke', data: {cmd: 'echo', value: 1}})
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
            assert.strictEqual(host.received.length, 5)
        } finally {
            await container.destroy()
            hostEnd.destroy()
        }
    })

    it('pushes the events to the clients subscribed, aborts the requests of a client unsubscribed', async (): Promise<void> => {
        const [hostEnd, adapterEnd] = await connectedPair()
        const host: FakeHost = new FakeHost(hostEnd)
        //The signals of the requests, given to their invocations
        const signals: AbortSignal[] = []
        const container: Container = await start(adapterEnd, {
            middlewares: [async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
                signals.push(invocation.signal!)
                return next()
            }]
        })
        try {
            //Each subscription answered, the ones sent again too
            host.send({type: 'subscribe', clientId: 'ui'})
            host.send({type: 'subscribe', clientId: 'ui'})
            host.send({type: 'invoke', id: 1, clientId: 'other', data: {cmd: 'notify', to: 'ui'}})
            assert.strictEqual((await host.response(1)).payload, true)
            assert.deepStrictEqual(host.received.filter((message: ReactNativeServiceMessage): boolean => message.type === 'subscribed'), [{type: 'subscribed', clientId: 'ui'}, {type: 'subscribed', clientId: 'ui'}])
            assert.deepStrictEqual(host.received.filter((message: ReactNativeServiceMessage): boolean => message.type === 'event'), [{type: 'event', clientId: 'ui', event: 'progress', args: [50]}])
            //An unknown client: nothing pushed
            host.send({type: 'invoke', id: 2, data: {cmd: 'notify', to: 'nobody'}})
            assert.strictEqual((await host.response(2)).payload, false)
            const entrypoint: Entrypoint = await container.get<Entrypoint>('entrypoint')
            assert.strictEqual(entrypoint.broadcast('ready'), 1)
            //Unsubscribed: its request in progress aborted (its result given), no event pushed to it
            host.send({type: 'invoke', id: 3, clientId: 'ui', data: {cmd: 'wait'}})
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
            assert.strictEqual(signals.at(-1)!.aborted, false)
            host.send({type: 'unsubscribe', clientId: 'ui'})
            assert.strictEqual((await host.response(3)).success, true)
            assert.strictEqual(signals.at(-1)!.aborted, true)
            assert.strictEqual(entrypoint.broadcast('ready'), 0)
        } finally {
            await container.destroy()
            hostEnd.destroy()
        }
    })

    it('calls its pause option before answering paused, its resume option, their failures ignored', async (): Promise<void> => {
        const [hostEnd, adapterEnd] = await connectedPair()
        const host: FakeHost = new FakeHost(hostEnd)
        const calls: string[] = []
        const container: Container = await start(adapterEnd, {
            pause: async (): Promise<void> => {
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
                calls.push('pause')
                throw new Error('nothing to write')
            },
            resume: (): void => void calls.push('resume')
        })
        try {
            host.send({type: 'pause'})
            await host.message((message: ReactNativeServiceMessage): boolean => message.type === 'paused')
            calls.push('paused')
            host.send({type: 'resume'})
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
            assert.deepStrictEqual(calls, ['pause', 'paused', 'resume'])
        } finally {
            await container.destroy()
        }
        //Stopped: it listens no more, the socket given left open
        assert.strictEqual(adapterEnd.listenerCount('data'), 0)
        assert.strictEqual(adapterEnd.destroyed, false)
        hostEnd.destroy()
        adapterEnd.destroy()
    })

    it('opens the socket on the file descriptor LAKUTATA_NODE_FD gives, refused without it', async (): Promise<void> => {
        const adapter: string = new URL('../exports/ReactNativeAdapter.js', import.meta.url).href
        const script: string = `
const {reactNativeServiceEntrypoint} = await import(${JSON.stringify(adapter)})
const entrypoint = reactNativeServiceEntrypoint()
try {
    entrypoint.start({dispatch: async (context) => context.data.text})
} catch (error) {
    console.log('REFUSED ' + error.message)
    process.exit(0)
}
`
        const run = (env: NodeJS.ProcessEnv): Promise<{ stdout: string, host: FakeHost, exit: Promise<number | null> }> => {
            //The fourth stdio of the child: a socket of the parent's, its file descriptor 3
            const child = spawn(process.execPath, ['--input-type=module', '-e', script], {cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'), env: env, stdio: ['ignore', 'pipe', 'pipe', 'pipe']})
            let stdout: string = ''
            child.stdout!.on('data', (chunk: Buffer): unknown => stdout += chunk.toString())
            const exit: Promise<number | null> = new Promise((resolve: (code: number | null) => void): unknown => child.once('exit', resolve))
            return Promise.resolve({get stdout(): string {
                return stdout
            }, host: new FakeHost(child.stdio[3] as Duplex), exit: exit})
        }
        const opened = await run({...process.env, LAKUTATA_NODE_FD: '3'})
        opened.host.send({type: 'invoke', id: 1, data: {text: 'hi'}})
        assert.deepStrictEqual(await opened.host.response(1), {success: true, error: null, payload: 'hi'})
        opened.host.socket.destroy()
        const refused = await run({...process.env, LAKUTATA_NODE_FD: ''})
        assert.strictEqual(await refused.exit, 0)
        assert.match(refused.stdout, /REFUSED reactNativeServiceEntrypoint runs in the Node\.js started by the native module of the application \(LAKUTATA_NODE_FD\), or is given a socket/)
        refused.host.socket.destroy()
        //The child of the opened socket ends once the host closes its end
        assert.strictEqual(await opened.exit, 0)
    })
})

import {describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile} from 'node:child_process'
import {createServer, type IncomingMessage, request, type Server} from 'node:http'
import * as nodeModule from 'node:module'
import {EventEmitter} from 'node:events'
import {type AddressInfo, createServer as createNetServer, type Server as NetServer, type Socket} from 'node:net'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {Container, type IInterfaceListener, type IInterfaceListening, type IListeningAddress} from '@lakutata/core'
import {type InterfaceAddress, listInterfaces, type NetworkInterfaceInfo} from '@lakutata/netif'
import {io as Connect, type Socket as ClientSocket} from 'socket.io-client'
import {buildEntrypoints, Controller, Entrypoint, httpServiceEntrypoint} from '../exports/Entrypoint.js'
import {GET, ServiceAction} from '../exports/CTRLDecorators.js'
import {expressHTTPEntrypoint} from '../exports/ExpressAdapter.js'
import {jsonRPCServiceEntrypoint} from '../exports/JSONRPCAdapter.js'
import {socketIOServiceEntrypoint} from '../exports/SocketIOAdapter.js'
import {FASTIFY, NO_FASTIFY} from './support/Fastify.js'
import {keepAliveAgent} from './support/KeepAlive.js'

/**
 * The loopback interface, found by its address
 */
const LOOPBACK: string = listInterfaces().find((entry: NetworkInterfaceInfo): boolean => entry.addresses.some((address: InterfaceAddress): boolean => address.address === '127.0.0.1'))!.name

class PingController extends Controller {
    @GET('/ping')
    public async http(): Promise<{ pong: string }> {
        return {pong: 'http'}
    }

    @ServiceAction({cmd: 'ping'})
    public async service(): Promise<string> {
        return 'pong'
    }

    @ServiceAction({method: 'ping'})
    public async rpc(): Promise<string> {
        return 'pong'
    }
}

/**
 * Starts an entrypoint with the adapters given: its container, and the listeners given to the listening callback
 */
async function start(adapters: Record<string, unknown>): Promise<Container> {
    const container: Container = new Container()
    await container.set(Entrypoint, buildEntrypoints({controllers: [PingController], ...adapters}))
    return container
}

/**
 * A GET of the path through an agent keeping its connection alive: the text, and the socket kept open
 */
function getKeptAlive(port: number, path: string): Promise<{ text: string, socket: Socket }> {
    return new Promise((resolve: (value: { text: string, socket: Socket }) => void, reject: (error: Error) => void): void => {
        let socket: Socket | undefined
        const sent = request({host: '127.0.0.1', port: port, path: path, agent: keepAliveAgent()}, (response: IncomingMessage): void => {
            let text: string = ''
            response.setEncoding('utf8').on('data', (chunk: string): unknown => text += chunk).once('end', (): void => resolve({text: text, socket: socket!}))
        })
        //The socket, kept by the agent once the response ended
        sent.once('socket', (given: Socket): void => {
            socket = given
        })
        sent.once('error', reject).end()
    })
}

/**
 * A listener of another implementation: a server listening on 127.0.0.1 that gives its connections to the server of the
 * adapter
 */
class AcceptingListener extends EventEmitter implements IInterfaceListener {
    public readonly networkInterface: { name: string, loopback: boolean } = {name: 'fake0', loopback: true}
    public readonly enforced: boolean = false
    public readonly reason: string | undefined = 'a listener of the tests, on 127.0.0.1'
    public closed: boolean = false

    constructor(protected readonly acceptor: NetServer) {
        super()
    }

    public get port(): number | undefined {
        return (this.acceptor.address() as AddressInfo | null)?.port
    }

    public get addresses(): IListeningAddress[] {
        return this.port === undefined ? [] : [{address: '127.0.0.1', family: 'IPv4', port: this.port}]
    }

    public get listening(): boolean {
        return this.acceptor.listening
    }

    public async close(): Promise<void> {
        //The connections given to the server are left to it
        this.acceptor.close()
        this.closed = true
    }
}

/**
 * Wait for a promise with the event loop held: the promise waits for events of no handle of the test (an idle socket of
 * an agent, the threads of a native library), and the test runner of Node.js 18 fails a test whose event loop empties
 * @param promise
 */
async function held<T>(promise: Promise<T>): Promise<T> {
    const timer: NodeJS.Timeout = setInterval((): undefined => undefined, 1000)
    try {
        return await promise
    } finally {
        clearInterval(timer)
    }
}

describe('An adapter listening on an interface', (): void => {

    it('serves the actions of express through the interface, the server not listening itself', async (): Promise<void> => {
        let listeners: IInterfaceListener[] | undefined
        let server: Server | undefined
        const container: Container = await start({
            http: expressHTTPEntrypoint({
                port: 0,
                interface: LOOPBACK,
                family: 'IPv4',
                listening: (listening: Server, made?: IInterfaceListener[]): void => {
                    server = listening
                    listeners = made
                }
            })
        })
        const port: number = listeners![0].port!
        try {
            assert.strictEqual(listeners!.length, 1)
            assert.strictEqual(server!.listening, false)
            assert.deepStrictEqual(await (await fetch(`http://127.0.0.1:${port}/ping`)).json(), {pong: 'http'})
        } finally {
            await container.destroy()
        }
        await assert.rejects(fetch(`http://127.0.0.1:${port}/ping`))
        assert.strictEqual(listeners![0].closed, true)
    })

    it('closes the idle kept-alive connections given to the server when it stops', async (): Promise<void> => {
        let port: number = 0
        const container: Container = await start({
            http: expressHTTPEntrypoint({port: 0, interface: LOOPBACK, family: 'IPv4', listening: (server: Server, listeners?: IInterfaceListener[]): void => {
                port = listeners![0].port!
            }})
        })
        const {text, socket} = await getKeptAlive(port, '/ping')
        assert.strictEqual(text, JSON.stringify({pong: 'http'}))
        assert.strictEqual(socket.destroyed, false)
        const closed: Promise<void> = new Promise((resolve: () => void): void => {
            socket.once('close', (): void => resolve())
        })
        const started: number = Date.now()
        await held((async (): Promise<void> => {
            await container.destroy()
            await closed
        })())
        assert.ok(Date.now() - started < 5000, 'the stop waited for the idle connection')
    })

    it('serves the actions of fastify through the interface, and closes its idle kept-alive connections when it stops', {skip: NO_FASTIFY}, async (): Promise<void> => {
        let listeners: IInterfaceListener[] | undefined
        let server: Server | undefined
        const container: Container = await start({
            http: FASTIFY.fastifyHTTPEntrypoint({
                port: 0,
                interface: LOOPBACK,
                family: 'IPv4',
                listening: (listening: Server, made?: IInterfaceListener[]): void => {
                    server = listening
                    listeners = made
                }
            })
        })
        const port: number = listeners![0].port!
        assert.strictEqual(server!.listening, false)
        const {text, socket} = await getKeptAlive(port, '/ping')
        assert.strictEqual(text, JSON.stringify({pong: 'http'}))
        const closed: Promise<void> = new Promise((resolve: () => void): void => {
            socket.once('close', (): void => resolve())
        })
        const started: number = Date.now()
        await held((async (): Promise<void> => {
            await container.destroy()
            await closed
        })())
        assert.ok(Date.now() - started < 5000, 'the stop waited for the idle connection')
        assert.strictEqual(listeners![0].closed, true)
        await assert.rejects(fetch(`http://127.0.0.1:${port}/ping`))
    })

    it('serves the service actions of the http service adapter, socket.io and JSON-RPC', async (): Promise<void> => {
        const ports: Record<string, number> = {}
        const container: Container = await start({
            service: [
                httpServiceEntrypoint({name: 'http', port: 0, interface: LOOPBACK, family: 'IPv4', listening: (server: Server, listeners?: IInterfaceListener[]): void => {
                    ports.http = listeners![0].port!
                }}),
                //Bun cannot upgrade a connection given to a server: polling only there
                socketIOServiceEntrypoint({name: 'io', port: 0, interface: LOOPBACK, family: 'IPv4', options: process.versions.bun ? {transports: ['polling']} : {}, listening: (io: unknown, server: unknown, listeners?: IInterfaceListener[]): void => {
                    ports.io = listeners![0].port!
                }}),
                jsonRPCServiceEntrypoint({name: 'rpc', port: 0, interface: LOOPBACK, family: 'IPv4', listening: (server: Server, listeners?: IInterfaceListener[]): void => {
                    ports.rpc = listeners![0].port!
                }})
            ]
        })
        let client: ClientSocket | undefined
        try {
            const posted: Response = await fetch(`http://127.0.0.1:${ports.http}/`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({cmd: 'ping'})})
            assert.deepStrictEqual(await posted.json(), {success: true, error: null, payload: 'pong'})
            client = Connect(`http://127.0.0.1:${ports.io}`, {transports: process.versions.bun ? ['polling'] : ['websocket'], reconnection: false})
            assert.deepStrictEqual(await client.timeout(3000).emitWithAck('message', {cmd: 'ping'}), {success: true, error: null, payload: 'pong'})
            const rpc: Response = await fetch(`http://127.0.0.1:${ports.rpc}/`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', method: 'ping', id: 1})})
            assert.deepStrictEqual(await rpc.json(), {jsonrpc: '2.0', id: 1, result: 'pong'})
        } finally {
            client?.close()
            await container.destroy()
        }
    })

    it('starts while the interface does not exist, and listens on it once it can', async (): Promise<void> => {
        let listeners: IInterfaceListener[] | undefined
        const container: Container = await start({
            http: expressHTTPEntrypoint({port: 0, interface: 'netif-absent0', listening: (server: Server, made?: IInterfaceListener[]): void => {
                listeners = made
            }})
        })
        try {
            assert.strictEqual(listeners![0].listening, false)
            assert.deepStrictEqual(listeners![0].addresses, [])
        } finally {
            await container.destroy()
        }
    })

    it('listens through another implementation given in interfaceListening', async (): Promise<void> => {
        const calls: unknown[] = []
        const implementation: IInterfaceListening = {
            listenOnAll: async (selectors, server, options): Promise<IInterfaceListener[]> => {
                calls.push({selectors: selectors, options: options})
                const acceptor: NetServer = createNetServer((socket: Socket): unknown => server.emit('connection', socket))
                await new Promise<void>((resolve: () => void): unknown => acceptor.listen(0, '127.0.0.1', resolve))
                return [new AcceptingListener(acceptor)]
            }
        }
        let listeners: IInterfaceListener[] | undefined
        const container: Container = await start({
            http: expressHTTPEntrypoint({port: 0, interface: 'fake0', family: 'IPv4', interfaceListening: implementation, listening: (server: Server, made?: IInterfaceListener[]): void => {
                listeners = made
            }})
        })
        try {
            assert.deepStrictEqual(calls, [{selectors: 'fake0', options: {port: 0, family: 'IPv4', strict: undefined}}])
            assert.deepStrictEqual(await (await fetch(`http://127.0.0.1:${listeners![0].port}/ping`)).json(), {pong: 'http'})
        } finally {
            await container.destroy()
        }
        assert.strictEqual(listeners![0].closed, true)
    })

    it('refuses the options that contradict', async (): Promise<void> => {
        assert.throws((): unknown => expressHTTPEntrypoint({host: '127.0.0.1', interface: LOOPBACK}), TypeError)
        if (!NO_FASTIFY) assert.throws((): unknown => FASTIFY.fastifyHTTPEntrypoint({host: '127.0.0.1', interface: LOOPBACK}), TypeError)
        assert.throws((): unknown => httpServiceEntrypoint({strict: true}), TypeError)
        assert.throws((): unknown => expressHTTPEntrypoint({onError: (): void => undefined, family: 'IPv4'}), TypeError)
        assert.throws((): unknown => httpServiceEntrypoint({interfaceListening: {listenOnAll: async (): Promise<IInterfaceListener[]> => []}}), TypeError)
        assert.throws((): unknown => socketIOServiceEntrypoint({server: createServer(), interface: LOOPBACK}), TypeError)
        assert.throws((): unknown => jsonRPCServiceEntrypoint({transport: 'stdio', interface: LOOPBACK}), TypeError)
        //Several interfaces and the port 0: refused when the adapter starts
        await assert.rejects(start({http: expressHTTPEntrypoint({port: 0, interface: [LOOPBACK, 'netif-absent0']})}), TypeError)
    })

    it('refuses the WebSockets in Bun, which cannot upgrade a connection given to a server', {skip: process.versions.bun ? false : 'Bun only'}, async (): Promise<void> => {
        await assert.rejects(start({service: jsonRPCServiceEntrypoint({port: 0, transport: 'websocket', interface: LOOPBACK})}), /Bun cannot upgrade to a WebSocket/)
        await assert.rejects(start({service: socketIOServiceEntrypoint({port: 0, interface: LOOPBACK})}), /Bun cannot upgrade to a WebSocket/)
    })

    it('tells how to install @lakutata/netif when it is missing', {skip: (process.versions.bun || typeof (nodeModule as { registerHooks?: unknown }).registerHooks !== 'function') && 'the module hooks of Node.js (22.15) make the package missing'}, async (): Promise<void> => {
        const exports: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'exports')
        //The resolution of @lakutata/netif fails as when it is not installed (in Electron, its executable run as Node.js)
        const hook: string = `import {registerHooks} from 'node:module'
registerHooks({resolve: (specifier, context, next) => {
    if (specifier !== '@lakutata/netif') return next(specifier, context)
    throw Object.assign(new Error("Cannot find package '@lakutata/netif' imported from the test"), {code: 'ERR_MODULE_NOT_FOUND'})
}})`
        const script: string = `import {Container} from '@lakutata/core'
import {buildEntrypoints, Entrypoint} from '${pathToFileURL(path.join(exports, 'Entrypoint.js')).href}'
import {expressHTTPEntrypoint} from '${pathToFileURL(path.join(exports, 'ExpressAdapter.js')).href}'
const container = new Container()
try {
    await container.set(Entrypoint, buildEntrypoints({controllers: [], http: expressHTTPEntrypoint({port: 0, interface: 'eth1'})}))
    console.log('started')
} catch (error) {
    for (let cause = error; cause; cause = cause.cause) console.log(cause.message)
}
await container.destroy()`
        const output: string = await new Promise((resolve: (output: string) => void, reject: (error: Error) => void): void => {
            execFile(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(hook)}`, '--input-type=module', '--eval', script], {cwd: path.join(exports, '..', '..', '..'), env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}}, (error: Error | null, stdout: string, stderr: string): void => {
                if (error) return reject(new Error(`${error.message}\n${stderr}`))
                resolve(stdout)
            })
        })
        assert.match(output, /The interface option of expressHTTPEntrypoint needs the package @lakutata\/netif \(npm install @lakutata\/netif\)/)
    })
})

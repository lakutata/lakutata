import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createServer, type IncomingMessage, request, type Server} from 'node:http'
import type {Socket} from 'node:net'
import {Container} from '@lakutata/core'
import {type InterfaceAddress, type InterfaceListener, listInterfaces, type NetworkInterfaceInfo} from '@lakutata/netif'
import {io as Connect, type Socket as ClientSocket} from 'socket.io-client'
import {buildEntrypoints, Controller, Entrypoint, httpServiceEntrypoint} from '../exports/Entrypoint.js'
import {GET, ServiceAction} from '../exports/CTRLDecorators.js'
import {expressHTTPEntrypoint} from '../exports/ExpressAdapter.js'
import {jsonRPCServiceEntrypoint} from '../exports/JSONRPCAdapter.js'
import {socketIOServiceEntrypoint} from '../exports/SocketIOAdapter.js'
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

describe('An adapter listening on an interface', (): void => {

    it('serves the actions of express through the interface, the server not listening itself', async (): Promise<void> => {
        let listeners: InterfaceListener[] | undefined
        let server: Server | undefined
        const container: Container = await start({
            http: expressHTTPEntrypoint({
                port: 0,
                interface: LOOPBACK,
                family: 'IPv4',
                listening: (listening: Server, made?: InterfaceListener[]): void => {
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
            http: expressHTTPEntrypoint({port: 0, interface: LOOPBACK, family: 'IPv4', listening: (server: Server, listeners?: InterfaceListener[]): void => {
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
        await container.destroy()
        await closed
        assert.ok(Date.now() - started < 5000, 'the stop waited for the idle connection')
    })

    it('serves the service actions of the http service adapter, socket.io and JSON-RPC', async (): Promise<void> => {
        const ports: Record<string, number> = {}
        const container: Container = await start({
            service: [
                httpServiceEntrypoint({name: 'http', port: 0, interface: LOOPBACK, family: 'IPv4', listening: (server: Server, listeners?: InterfaceListener[]): void => {
                    ports.http = listeners![0].port!
                }}),
                //Bun cannot upgrade a connection given to a server: polling only there
                socketIOServiceEntrypoint({name: 'io', port: 0, interface: LOOPBACK, family: 'IPv4', options: process.versions.bun ? {transports: ['polling']} : {}, listening: (io: unknown, server: unknown, listeners?: InterfaceListener[]): void => {
                    ports.io = listeners![0].port!
                }}),
                jsonRPCServiceEntrypoint({name: 'rpc', port: 0, interface: LOOPBACK, family: 'IPv4', listening: (server: Server, listeners?: InterfaceListener[]): void => {
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
        let listeners: InterfaceListener[] | undefined
        const container: Container = await start({
            http: expressHTTPEntrypoint({port: 0, interface: 'netif-absent0', listening: (server: Server, made?: InterfaceListener[]): void => {
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

    it('refuses the options that contradict', async (): Promise<void> => {
        assert.throws((): unknown => expressHTTPEntrypoint({host: '127.0.0.1', interface: LOOPBACK}), TypeError)
        assert.throws((): unknown => httpServiceEntrypoint({strict: true}), TypeError)
        assert.throws((): unknown => expressHTTPEntrypoint({onError: (): void => undefined, family: 'IPv4'}), TypeError)
        assert.throws((): unknown => socketIOServiceEntrypoint({server: createServer(), interface: LOOPBACK}), TypeError)
        assert.throws((): unknown => jsonRPCServiceEntrypoint({transport: 'stdio', interface: LOOPBACK}), TypeError)
        //Several interfaces and the port 0: refused when the adapter starts
        await assert.rejects(start({http: expressHTTPEntrypoint({port: 0, interface: [LOOPBACK, 'netif-absent0']})}), TypeError)
    })

    it('refuses the WebSockets in Bun, which cannot upgrade a connection given to a server', {skip: process.versions.bun ? false : 'Bun only'}, async (): Promise<void> => {
        await assert.rejects(start({service: jsonRPCServiceEntrypoint({port: 0, transport: 'websocket', interface: LOOPBACK})}), (error: Error): boolean => error.name === 'NetIfNotSupportedException')
        await assert.rejects(start({service: socketIOServiceEntrypoint({port: 0, interface: LOOPBACK})}), (error: Error): boolean => error.name === 'NetIfNotSupportedException')
    })
})

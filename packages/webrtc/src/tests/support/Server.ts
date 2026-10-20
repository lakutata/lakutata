import type {AddressInfo} from 'node:net'
import type {Server} from 'node:http'
import {Container} from '@lakutata/core'
import {buildEntrypoints, Entrypoint} from '@lakutata/entrypoint'
import {socketIOServiceEntrypoint} from '@lakutata/entrypoint/adapter/socket.io'
import {jsonRPCServiceEntrypoint} from '@lakutata/entrypoint/adapter/jsonrpc'
import {Signaling, type SignalingOptions} from '../../signaling/Signaling.js'
import {SignalingController} from '../../signaling/SignalingController.js'
import {TURNServer, type TURNServerOptions} from '../../turn/TURNServer.js'

/**
 * A signaling server for the tests: Socket.IO and JSON-RPC over WebSocket on random ports of 127.0.0.1, with a TURN
 * server when asked
 */
export type TestServer = {
    container: Container
    signaling: Signaling
    entrypoint: Entrypoint
    turn?: TURNServer
    //http://127.0.0.1:<port> (Socket.IO)
    socketIO: string
    //ws://127.0.0.1:<port>/ (JSON-RPC)
    jsonRPC: string
    stop(): Promise<void>
}

/**
 * Start a signaling server
 * @param options
 */
export async function startServer(options: {signaling?: SignalingOptions, turn?: TURNServerOptions} = {}): Promise<TestServer> {
    const container: Container = new Container()
    let turn: TURNServer | undefined
    if (options.turn) {
        turn = await container.setNamed<TURNServer>('turn', TURNServer, {host: '127.0.0.1', port: 0, publicAddress: '127.0.0.1', tcp: false, ...options.turn})
    }
    const signaling: Signaling = await container.setNamed<Signaling>('signaling', Signaling, {...(turn ? {turn: 'turn'} : {}), ...options.signaling})
    let socketIOPort: number = 0
    let jsonRPCPort: number = 0
    const entrypoint: Entrypoint = await container.setNamed<Entrypoint>('entrypoint', Entrypoint, buildEntrypoints({
        controllers: [SignalingController],
        service: [
            socketIOServiceEntrypoint({
                port: 0,
                host: '127.0.0.1',
                listening: (_io: unknown, server?: Server): void => {
                    socketIOPort = (server!.address() as AddressInfo).port
                }
            }),
            jsonRPCServiceEntrypoint({
                transport: 'websocket',
                port: 0,
                host: '127.0.0.1',
                listening: (server: Server): void => {
                    jsonRPCPort = (server.address() as AddressInfo).port
                }
            })
        ]
    }))
    return {
        container: container,
        signaling: signaling,
        entrypoint: entrypoint,
        turn: turn,
        socketIO: `http://127.0.0.1:${socketIOPort}`,
        jsonRPC: `ws://127.0.0.1:${jsonRPCPort}/`,
        stop: (): Promise<void> => container.destroy()
    }
}

/**
 * Wait for a condition, polling it
 * @param condition
 * @param timeout
 * @param what
 */
export async function until(condition: () => boolean, timeout: number = 10000, what: string = 'the condition'): Promise<void> {
    const deadline: number = Date.now() + timeout
    while (!condition()) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
    }
}

/**
 * The first emission of an event, with a timeout
 * @param subscribe
 * @param timeout
 * @param what
 */
export function next<T>(subscribe: (resolve: (value: T) => void) => void, timeout: number = 15000, what: string = 'the event'): Promise<T> {
    return new Promise<T>((resolve: (value: T) => void, reject: (error: Error) => void): void => {
        const timer: NodeJS.Timeout = setTimeout((): void => reject(new Error(`Timed out waiting for ${what}`)), timeout)
        subscribe((value: T): void => {
            clearTimeout(timer)
            resolve(value)
        })
    })
}

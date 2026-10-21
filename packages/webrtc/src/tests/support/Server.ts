import type {AddressInfo} from 'node:net'
import type {Server} from 'node:http'
import {Container} from '@lakutata/core'
import {buildEntrypoints, Entrypoint} from '@lakutata/entrypoint'
import {socketIOServiceEntrypoint} from '@lakutata/entrypoint/adapter/socket.io'
import {jsonRPCServiceEntrypoint} from '@lakutata/entrypoint/adapter/jsonrpc'
import {expressHTTPEntrypoint} from '@lakutata/entrypoint/adapter/express'
import {fastifyHTTPEntrypoint} from '@lakutata/entrypoint/adapter/fastify'
import {Signaling, type SignalingOptions} from '../../signaling/Signaling.js'
import {SignalingController} from '../../signaling/SignalingController.js'
import {TURNServer, type TURNServerOptions} from '../../turn/TURNServer.js'
import {Cluster, type ClusterOptions} from '../../cluster/Cluster.js'
import {WHIP, type WHIPOptions} from '../../whip/WHIP.js'
import {WHIPController} from '../../whip/WHIPController.js'

/**
 * A signaling server for the tests: Socket.IO and JSON-RPC over WebSocket on random ports of 127.0.0.1, with a TURN
 * server when asked
 */
export type TestServer = {
    container: Container
    signaling: Signaling
    entrypoint: Entrypoint
    turn?: TURNServer
    cluster?: Cluster
    //http://127.0.0.1:<port> (Socket.IO)
    socketIO: string
    //ws://127.0.0.1:<port>/ (JSON-RPC)
    jsonRPC: string
    stop(): Promise<void>
}

/**
 * Start a signaling server, a node of a cluster when given its options
 * @param options
 */
export async function startServer(options: {signaling?: SignalingOptions, turn?: TURNServerOptions, cluster?: ClusterOptions} = {}): Promise<TestServer> {
    const container: Container = new Container()
    let cluster: Cluster | undefined
    if (options.cluster) cluster = await container.setNamed<Cluster>('cluster', Cluster, {...options.cluster})
    let turn: TURNServer | undefined
    if (options.turn) {
        turn = await container.setNamed<TURNServer>('turn', TURNServer, {host: '127.0.0.1', port: 0, publicAddress: '127.0.0.1', tcp: false, ...options.turn})
    }
    const signaling: Signaling = await container.setNamed<Signaling>('signaling', Signaling, {...(turn ? {turn: 'turn'} : {}), ...(cluster ? {cluster: 'cluster'} : {}), ...options.signaling})
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
        cluster: cluster,
        socketIO: `http://127.0.0.1:${socketIOPort}`,
        jsonRPC: `ws://127.0.0.1:${jsonRPCPort}/`,
        stop: (): Promise<void> => container.destroy()
    }
}

const WHIP_TEXT_TYPES: string[] = ['application/sdp', 'application/trickle-ice-sdpfrag']

/**
 * A WHIP server on a random port of 127.0.0.1, a node of a cluster when given its options
 * @param adapter
 * @param options
 * @param cluster
 */
export async function startWHIP(adapter: 'express' | 'fastify', options: WHIPOptions = {}, cluster?: ClusterOptions): Promise<{url: string, whip: WHIP, container: Container}> {
    const container: Container = new Container()
    if (cluster) await container.setNamed<Cluster>('cluster', Cluster, {...cluster})
    const whip: WHIP = await container.setNamed<WHIP>('whip', WHIP, {...cluster ? {cluster: 'cluster'} : {}, ...options})
    let server: Server | undefined
    const capture = (_app: unknown, context: {server: Server}): void => {
        server = context.server
    }
    await container.setNamed<Entrypoint>('entrypoint', Entrypoint, buildEntrypoints({
        controllers: [WHIPController],
        http: adapter === 'express'
            ? expressHTTPEntrypoint({port: 0, host: '127.0.0.1', body: {text: WHIP_TEXT_TYPES}, before: capture})
            : fastifyHTTPEntrypoint({port: 0, host: '127.0.0.1', body: {text: WHIP_TEXT_TYPES}, before: capture})
    }))
    return {url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, whip: whip, container: container}
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

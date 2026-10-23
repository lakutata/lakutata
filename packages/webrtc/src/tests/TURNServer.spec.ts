import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createSocket, type RemoteInfo, type Socket} from 'node:dgram'
import {setTimeout as sleep} from 'node:timers/promises'
import {Container} from '@lakutata/core'
import {setDebugHandler} from '../lib/common/log.js'
import type {Address} from '../lib/common/network.js'
import {createTurnClient, type TurnProtocol} from '../lib/ice/turn/protocol.js'
import {TURNServer} from '../turn/TURNServer.js'
import {portsShareable} from '../turn/TURNWorkers.js'
import {readFixture} from './engine/support/fixture.js'

//Whether the worker threads of a server share its ports here (Linux), or it serves in the main thread
const shareable: boolean = await portsShareable('127.0.0.1')

/**
 * Allocations of clients of a server, each with a user of its own, the clients put in the list given as they allocate
 * (the caller closes them, even when one fails)
 * @param port
 * @param count
 * @param clients
 */
async function allocate(port: number, count: number, clients: TurnProtocol[]): Promise<void> {
    for (let index = 0; index < count; index += 50) {
        const results: PromiseSettledResult<TurnProtocol>[] = await Promise.allSettled(Array.from({length: Math.min(50, count - index)}, (_: unknown, offset: number): Promise<TurnProtocol> => createTurnClient({address: ['127.0.0.1', port], username: `user${index + offset}`, password: 'password'})))
        for (const result of results) if (result.status === 'fulfilled') clients.push(result.value)
        const failed: PromiseRejectedResult | undefined = results.find((result: PromiseSettledResult<TurnProtocol>): result is PromiseRejectedResult => result.status === 'rejected')
        if (failed) throw failed.reason
    }
}

/**
 * A UDP socket bound on the loopback
 */
async function udpSocket(port: number = 0): Promise<Socket> {
    const socket: Socket = createSocket('udp4')
    await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
        socket.once('error', reject)
        socket.bind(port, '127.0.0.1', (): void => resolve())
    })
    return socket
}

/**
 * Relay a datagram from a client to a peer and the answer of the peer back, through the allocation of the client
 * @param client
 * @param peer
 */
async function relays(client: TurnProtocol, peer: Socket): Promise<void> {
    const reached: Promise<[Buffer, RemoteInfo]> = new Promise((resolve: (received: [Buffer, RemoteInfo]) => void): void => {
        peer.once('message', (data: Buffer, from: RemoteInfo): void => resolve([data, from]))
    })
    await client.sendData(Buffer.from('ping'), ['127.0.0.1', peer.address().port])
    const [data, from] = await reached
    assert.strictEqual(data.toString(), 'ping')
    assert.deepStrictEqual([from.address, from.port], [...client.relayedAddress])
    const answered: Promise<[Buffer, Address]> = client.onData.asPromise(5000)
    peer.send('pong', from.port, from.address)
    assert.strictEqual((await answered)[0].toString(), 'pong')
}

/**
 * Wait until a condition holds, 5 seconds at most
 * @param condition
 */
async function until(condition: () => boolean): Promise<void> {
    for (let waited: number = 0; !condition(); waited += 20) {
        if (waited > 5000) throw new Error('The condition did not hold in 5 seconds')
        await sleep(20)
    }
}

describe('TURNServer', (): void => {

    it('makes as many allocations as asked without maxAllocations', {timeout: 60000}, async (): Promise<void> => {
        const container: Container = new Container()
        const users: Record<string, string> = Object.fromEntries(Array.from({length: 300}, (_: unknown, index: number): [string, string] => [`user${index}`, 'password']))
        await container.setNamed('turn', TURNServer, {host: '127.0.0.1', port: 0, publicAddress: '127.0.0.1', users: users})
        const clients: TurnProtocol[] = []
        try {
            const turn: TURNServer = await container.get<TURNServer>('turn')
            //More than the 256 of the engine
            await allocate(turn.address.port, 300, clients)
            assert.strictEqual(turn.allocations, 300)
        } finally {
            await Promise.all(clients.map((client: TurnProtocol): Promise<unknown> => client.close().catch((): undefined => undefined)))
            await container.destroy()
        }
    })

    it('refuses a relay port range with fewer ports than worker threads', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await assert.rejects(container.setNamed('turn', TURNServer, {host: '127.0.0.1', port: 0, publicAddress: '127.0.0.1', workers: 3, relayPortRange: [46100, 46101]}), /2 ports, fewer than the 3 worker threads/)
        } finally {
            await container.destroy()
        }
    })

    it('serves in worker threads sharing its ports, counting their allocations together', {timeout: 60000, skip: shareable ? false : 'the ports cannot be shared among threads here (SO_REUSEPORT)'}, async (): Promise<void> => {
        const container: Container = new Container()
        const users: Record<string, string> = Object.fromEntries(Array.from({length: 8}, (_: unknown, index: number): [string, string] => [`user${index}`, 'password']))
        const tls: {cert: Buffer, key: Buffer, port: number} = {cert: readFixture('dtls/assets/cert.pem'), key: readFixture('dtls/assets/key.pem'), port: 0}
        await container.setNamed('turn', TURNServer, {host: '127.0.0.1', port: 0, publicAddress: '127.0.0.1', users: users, tls: tls, workers: 2, maxAllocations: 7})
        const clients: TurnProtocol[] = []
        const peer: Socket = await udpSocket()
        try {
            const turn: TURNServer = await container.get<TURNServer>('turn')
            const port: number = turn.address.port
            //Over UDP, from five ports the system spreads among the threads, over TCP and over TLS
            await allocate(port, 5, clients)
            clients.push(await createTurnClient({address: ['127.0.0.1', port], username: 'user5', password: 'password'}, {transport: 'tcp'}))
            clients.push(await createTurnClient({address: ['127.0.0.1', turn.tlsAddress!.port], username: 'user6', password: 'password'}, {transport: 'tls', tlsOptions: {rejectUnauthorized: false}}))
            assert.strictEqual(turn.allocations, 7)
            await assert.rejects(createTurnClient({address: ['127.0.0.1', port], username: 'user7', password: 'password'}))
            for (const client of clients) await relays(client, peer)
            await Promise.all(clients.splice(0).map((client: TurnProtocol): Promise<unknown> => client.close()))
            await until((): boolean => turn.allocations === 0)
        } finally {
            await Promise.all(clients.map((client: TurnProtocol): Promise<unknown> => client.close().catch((): undefined => undefined)))
            peer.close()
            await container.destroy()
        }
    })

    it('gives each worker thread a part of the relay ports, the debug messages of the threads going to the handler', {timeout: 60000, skip: shareable ? false : 'the ports cannot be shared among threads here (SO_REUSEPORT)'}, async (): Promise<void> => {
        //Two ports in a row, taken: each thread has one, the allocations fail
        const taken: Socket[] = []
        while (taken.length < 2) {
            const first: Socket = await udpSocket()
            const next: Socket | undefined = await udpSocket(first.address().port + 1).catch((): undefined => undefined)
            if (next) taken.push(first, next)
            else first.close()
        }
        const first: number = taken[0].address().port
        const messages: string[] = []
        setDebugHandler((namespace: string, args: unknown[]): void => void messages.push(`${namespace} ${String(args[0])}`))
        const container: Container = new Container()
        const clients: TurnProtocol[] = []
        try {
            await container.setNamed('turn', TURNServer, {host: '127.0.0.1', port: 0, publicAddress: '127.0.0.1', users: Object.fromEntries(Array.from({length: 4}, (_: unknown, index: number): [string, string] => [`user${index}`, 'password'])), workers: 2, relayPortRange: [first, first + 1]})
            const turn: TURNServer = await container.get<TURNServer>('turn')
            await assert.rejects(allocate(turn.address.port, 4, clients))
            await until((): boolean => messages.some((message: string): boolean => /^webrtc\/turn\/server \[thread [01]\] relay bind failed/.test(message)))
            assert.strictEqual(turn.allocations, 0)
        } finally {
            setDebugHandler(undefined)
            await Promise.all(clients.map((client: TurnProtocol): Promise<unknown> => client.close().catch((): undefined => undefined)))
            for (const socket of taken) socket.close()
            await container.destroy()
        }
    })

    it('serves in the main thread where the ports cannot be shared, and says so', {timeout: 60000, skip: shareable ? 'the ports can be shared among threads here' : false}, async (): Promise<void> => {
        const messages: string[] = []
        setDebugHandler((namespace: string, args: unknown[]): void => void messages.push(`${namespace} ${String(args[0])}`))
        const container: Container = new Container()
        const clients: TurnProtocol[] = []
        try {
            await container.setNamed('turn', TURNServer, {host: '127.0.0.1', port: 0, publicAddress: '127.0.0.1', users: {user0: 'password', user1: 'password'}, workers: 2})
            const turn: TURNServer = await container.get<TURNServer>('turn')
            assert.ok(messages.some((message: string): boolean => message.startsWith('webrtc/turn the ports cannot be shared')))
            await allocate(turn.address.port, 2, clients)
            assert.strictEqual(turn.allocations, 2)
        } finally {
            setDebugHandler(undefined)
            await Promise.all(clients.map((client: TurnProtocol): Promise<unknown> => client.close().catch((): undefined => undefined)))
            await container.destroy()
        }
    })
})

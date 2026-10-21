import {describe, test, expect} from '../../support/vitest.js'
import {type Socket, createSocket} from 'node:dgram'

import type {Address} from '../../../../lib/common/index.js'
import type {Connection} from '../../../../lib/ice/ice.js'
import {classes, methods} from '../../../../lib/ice/stun/const.js'
import {Message, parseMessage} from '../../../../lib/ice/stun/message.js'
import {createTurnClient} from '../../../../lib/ice/turn/protocol.js'
import {getHostAddresses} from '../../../../lib/ice/utils.js'
import {NodeTurnServer} from '../../../../lib/turn/index.js'
import {
    TURN_TEST_PASSWORD,
    TURN_TEST_USERNAME,
    createLocalTurnServer,
    createTestConnection
} from '../utils.js'

const localHost = getHostAddresses(true, false)[0]!

/** A STUN server that answers every binding request with the same mapped address, as one behind a NAT would. */
async function createMappingStunServer(mapped: Address) {
    const socket: Socket = createSocket('udp4')
    socket.on('message', (data, remote) => {
        const request = parseMessage(data)
        if (!request || request.messageMethod !== methods.BINDING) return
        const response = new Message(methods.BINDING, classes.RESPONSE, request.transactionId)
        response.setAttribute('XOR-MAPPED-ADDRESS', mapped)
        socket.send(response.bytes, remote.port, remote.address)
    })
    await new Promise<void>((resolve) => socket.bind(0, localHost, resolve))
    return {
        address: [localHost, socket.address().port] as Address,
        close: () => new Promise<void>((resolve) => socket.close(() => resolve()))
    }
}

/** A port nothing listens on. */
async function unusedPort() {
    const socket = createSocket('udp4')
    await new Promise<void>((resolve) => socket.bind(0, localHost, resolve))
    const {port} = socket.address()
    await new Promise<void>((resolve) => socket.close(() => resolve()))
    return port
}

function candidatesOf(connection: Connection, type: string) {
    return connection.localCandidates.filter((candidate) => candidate.type === type)
}

const hostOnly = {interfaceAddresses: {udp4: localHost}, useIpv6: false}

describe('ICE servers', () => {
    test('queries every STUN server, and gives each address once', async () => {
        const first = await createMappingStunServer(['203.0.113.7', 40001])
        const second = await createMappingStunServer(['203.0.113.8', 40002])
        const same = await createMappingStunServer(['203.0.113.7', 40001])
        const connection = createTestConnection(true, {
            ...hostOnly,
            stunServer: [localHost, await unusedPort()],
            stunServers: [first.address, second.address, same.address],
            stunGatherTimeout: 1
        })
        try {
            await connection.gatherCandidates()

            const srflx = candidatesOf(connection, 'srflx')
            expect(srflx.map((candidate) => `${candidate.host}:${candidate.port}`).sort()).toEqual([
                '203.0.113.7:40001',
                '203.0.113.8:40002'
            ])
        } finally {
            await connection.close()
            await Promise.all([first.close(), second.close(), same.close()])
        }
    })

    test('gives no server reflexive candidate that is a host candidate', async () => {
        const stun = await createLocalTurnServer(localHost)
        const connection = createTestConnection(true, {...hostOnly, stunServer: stun.address})
        try {
            await connection.gatherCandidates()

            expect(candidatesOf(connection, 'host').length).toBeGreaterThan(0)
            expect(candidatesOf(connection, 'srflx')).toHaveLength(0)
        } finally {
            await connection.close()
            await stun.close()
        }
    })

    test('gathers a relay candidate from each TURN server', async () => {
        const first = await createLocalTurnServer(localHost)
        const second = await createLocalTurnServer('127.0.0.1')
        const credentials = {username: TURN_TEST_USERNAME, password: TURN_TEST_PASSWORD}
        const connection = createTestConnection(true, {
            ...hostOnly,
            turnServers: [
                {address: first.address!, transport: 'udp', ...credentials},
                {address: second.address!, transport: 'udp', ...credentials}
            ]
        })
        try {
            await connection.gatherCandidates()

            const relays = candidatesOf(connection, 'relay')
            expect(relays.map((candidate) => candidate.host).sort()).toEqual(['127.0.0.1', localHost].sort())
            expect(relays[0]!.foundation).not.toBe(relays[1]!.foundation)
            expect(first.protocol.allocationCount).toBe(1)
            expect(second.protocol.allocationCount).toBe(1)
        } finally {
            await connection.close()
            await first.close()
            await second.close()
        }
    })

    test('makes one allocation on a TURN server with several transports, UDP first', async () => {
        const server = await createLocalTurnServer(localHost)
        const credentials = {username: TURN_TEST_USERNAME, password: TURN_TEST_PASSWORD}
        const connection = createTestConnection(true, {
            ...hostOnly,
            turnServers: [
                {address: server.address!, transport: 'udp', ...credentials},
                {address: server.address!, transport: 'tcp', ...credentials}
            ]
        })
        try {
            await connection.gatherCandidates()
            await new Promise((resolve) => setTimeout(resolve, 1500))

            expect(candidatesOf(connection, 'relay')).toHaveLength(1)
            expect(server.protocol.allocationCount).toBe(1)
        } finally {
            await connection.close()
            await server.close()
        }
    })

    test('tries the next transport of a TURN server when one does not answer', async () => {
        const server = await createLocalTurnServer(localHost)
        const credentials = {username: TURN_TEST_USERNAME, password: TURN_TEST_PASSWORD}
        const connection = createTestConnection(true, {
            ...hostOnly,
            turnServers: [
                {address: [localHost, await unusedPort()], transport: 'udp', ...credentials},
                {address: server.address!, transport: 'tcp', ...credentials}
            ]
        })
        try {
            const started = Date.now()
            await connection.gatherCandidates()

            expect(candidatesOf(connection, 'relay')).toHaveLength(1)
            expect(server.protocol.allocationCount).toBe(1)
            //UDP gives up after about 6 s: the TCP allocation does not wait for it
            expect(Date.now() - started).toBeLessThan(4000)
        } finally {
            await connection.close()
            await server.close()
        }
    })

    test('an ICE restart queries the STUN servers again and keeps the allocation', async () => {
        const stun = await createMappingStunServer(['203.0.113.7', 40001])
        const turn = await createLocalTurnServer(localHost)
        const connection = createTestConnection(true, {
            ...hostOnly,
            stunServer: stun.address,
            turnServer: turn.address,
            turnUsername: TURN_TEST_USERNAME,
            turnPassword: TURN_TEST_PASSWORD,
            turnTransport: 'udp'
        })
        try {
            await connection.gatherCandidates()
            const [relay] = candidatesOf(connection, 'relay')

            await connection.restart()
            await connection.gatherCandidates()

            const srflx = candidatesOf(connection, 'srflx')
            expect(srflx).toHaveLength(1)
            expect(srflx[0]!.ufrag).toBe(connection.localUsername)
            const relays = candidatesOf(connection, 'relay')
            expect(relays).toHaveLength(1)
            expect(relays[0]!.port).toBe(relay!.port)
            expect(relays[0]!.ufrag).toBe(connection.localUsername)
            expect(turn.protocol.allocationCount).toBe(1)
        } finally {
            await connection.close()
            await stun.close()
            await turn.close()
        }
    })

    test('an ICE restart replaces a relay the TURN server no longer has', async () => {
        const turn = await createLocalTurnServer(localHost)
        const address = turn.address!
        const connection = createTestConnection(true, {
            ...hostOnly,
            turnServer: address,
            turnUsername: TURN_TEST_USERNAME,
            turnPassword: TURN_TEST_PASSWORD,
            turnTransport: 'udp'
        })
        let restarted: NodeTurnServer | undefined
        try {
            await connection.gatherCandidates()
            const [relay] = candidatesOf(connection, 'relay')
            //The server restarts and loses its allocations
            await turn.close()
            restarted = new NodeTurnServer({
                host: localHost,
                port: address[1],
                relayAddress: localHost,
                relayBindAddress: localHost,
                credentials: {[TURN_TEST_USERNAME]: TURN_TEST_PASSWORD},
                realm: 'werift.local'
            })
            await restarted.listen()

            await connection.restart()
            await connection.gatherCandidates()

            const relays = candidatesOf(connection, 'relay')
            expect(relays).toHaveLength(1)
            expect(relays[0]!.port).not.toBe(relay!.port)
            expect(restarted.protocol.allocationCount).toBe(1)
        } finally {
            await connection.close()
            await restarted?.close()
        }
    })

    test('closing deletes the allocations on the TURN server', async () => {
        const turn = await createLocalTurnServer(localHost)
        const connection = createTestConnection(true, {
            ...hostOnly,
            turnServer: turn.address,
            turnUsername: TURN_TEST_USERNAME,
            turnPassword: TURN_TEST_PASSWORD,
            turnTransport: 'udp'
        })
        try {
            await connection.gatherCandidates()
            expect(turn.protocol.allocationCount).toBe(1)

            await connection.close()

            expect(turn.protocol.allocationCount).toBe(0)
        } finally {
            await turn.close()
        }
    })

    test('an allocation is refreshed after its nonce goes stale', async () => {
        const server = new NodeTurnServer({
            host: localHost,
            port: 0,
            relayAddress: localHost,
            relayBindAddress: localHost,
            realm: 'werift.local',
            credentials: {[TURN_TEST_USERNAME]: TURN_TEST_PASSWORD},
            nonceLifetime: 1
        })
        await server.listen()
        const turn = await createTurnClient({
            address: server.address!,
            username: TURN_TEST_USERNAME,
            password: TURN_TEST_PASSWORD
        })
        try {
            await new Promise((resolve) => setTimeout(resolve, 1500))

            const started = Date.now()
            expect(await turn.refreshAllocation()).toBe(true)
            expect(Date.now() - started).toBeLessThan(1000)
        } finally {
            await turn.close()
            await server.close()
        }
    })

    test('an allocation outlives its time-limited credentials', async () => {
        let valid = true
        const server = new NodeTurnServer({
            host: localHost,
            port: 0,
            relayAddress: localHost,
            relayBindAddress: localHost,
            realm: 'werift.local',
            allocationLifetime: 2,
            getPassword: (username) => (valid && username === TURN_TEST_USERNAME ? TURN_TEST_PASSWORD : undefined)
        })
        await server.listen()
        const credentials = {address: server.address!, username: TURN_TEST_USERNAME, password: TURN_TEST_PASSWORD}
        const turn = await createTurnClient(credentials, {lifetime: 2})
        try {
            //The credentials expire: the allocation is refreshed with them, a new one is refused
            valid = false
            await new Promise((resolve) => setTimeout(resolve, 3500))

            expect(server.protocol.allocationCount).toBe(1)
            expect(await turn.refreshAllocation()).toBe(true)
            let refused = false
            await createTurnClient(credentials).catch(() => {
                refused = true
            })
            expect(refused).toBe(true)
        } finally {
            await turn.close()
            await server.close()
        }
    })
})

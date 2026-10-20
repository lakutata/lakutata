import {describe, test, expect, vi} from '../support/vitest.js'
import {createSocket} from 'node:dgram'
import {setTimeout} from 'node:timers/promises'

import {SCTP, SCTP_STATE} from '../../../lib/sctp/index.js'
import {AbortChunk, DataChunk, SackChunk, serializePacket} from '../../../lib/sctp/chunk.js'
import {StreamAddOutgoingParam} from '../../../lib/sctp/param.js'
import {type Transport, createUdpTransport} from '../../../lib/sctp/transport.js'

describe('sctp', () => {
    test('test_connect_client_limits_streams', async () => {
        const port = 8799

        const socket = createSocket('udp4')
        socket.bind(port)
        const server = SCTP.server(createUdpTransport(socket))

        const clientSocket = createSocket('udp4')
        const client = SCTP.client(
            createUdpTransport(clientSocket, {
                port,
                address: '127.0.0.1'
            })
        )

        try {
            client._inboundStreamsMax = 2048
            client._outboundStreamsCount = 256

            await Promise.all([client.start(5000), server.start(5000)])
            await Promise.all([
                client.stateChanged.connected.asPromise(),
                server.stateChanged.connected.asPromise()
            ])

            expect(client.maxChannels).toBe(256)
            expect(client.associationState).toBe(SCTP_STATE.ESTABLISHED)
            expect(client._inboundStreamsCount).toBe(2048)
            expect(client._outboundStreamsCount).toBe(256)
            expect(client.remoteExtensions).toEqual([192, 130])
            expect(server.associationState).toBe(SCTP_STATE.ESTABLISHED)
            expect(server._inboundStreamsCount).toBe(256)
            expect(server._outboundStreamsCount).toBe(2048)
            expect(server.remoteExtensions).toEqual([192, 130])

            const param = new StreamAddOutgoingParam(client.reconfigRequestSeq, 16)
            await client.sendReconfigParam(param)
            await setTimeout(100)

            expect(server.maxChannels).toBe(272)
            expect(server._inboundStreamsCount).toBe(272)
            expect(server._outboundStreamsCount).toBe(2048)

            void client.stop()

            await server.stateChanged.closed.asPromise()
            expect(client.associationState).toBe(SCTP_STATE.CLOSED)
            expect(server.associationState).toBe(SCTP_STATE.CLOSED)
        } finally {
            socket.close()
            clientSocket.close()
        }
    })
})

describe('sctp timers and ack policy', () => {
    const createMockSctp = () => {
        const transport: Transport = {
            send: vi.fn(async () => {}),
            close: vi.fn()
        }
        const sctp = SCTP.client(transport, 5000)
        sctp.setRemotePort(5001)
        return {sctp, transport}
    }

    const createDataChunk = (tsn: number) => {
        const chunk = new DataChunk(0, undefined)
        chunk.flags = 0x03
        chunk.tsn = tsn
        chunk.streamId = 1
        chunk.streamSeqNum = 0
        chunk.protocol = 51
        chunk.userData = Buffer.from('x')
        return chunk
    }

    const receiveDataPacket = async (
        sctp: SCTP,
        tsn: number,
        flags = 0x03,
        verificationTag?: number
    ) => {
        const chunk = createDataChunk(tsn)
        chunk.flags = flags
        const packet = serializePacket(
            5001,
            5000,
            verificationTag ?? (sctp as any).localVerificationTag,
            chunk
        )
        await (sctp as any).handleData(packet)
    }

    test('timer3Restart converts rto seconds to milliseconds', () => {
        const {sctp} = createMockSctp()
        const spy = vi.spyOn(global, 'setTimeout');

        (sctp as any).rto = 5;
        (sctp as any).timer3Restart()

        expect(spy).toHaveBeenCalledWith(expect.any(Function), 5000);
        (sctp as any).timer3Cancel()
        spy.mockRestore()
    })

    test('peer rwnd is derived from latest advertised rwnd and flight size', async () => {
        const {sctp} = createMockSctp();
        (sctp as any).lastSackedTsn = 0
        const sent = createDataChunk(1)
        sent.bookSize = 100;
        (sctp as any).sentQueue = [sent];
        (sctp as any).flightSize = 100

        const sack = new SackChunk(0, undefined)
        sack.cumulativeTsn = 0
        sack.advertisedRwnd = 150

        await (sctp as any).receiveSackChunk(sack)
        expect((sctp as any).peerAdvertisedRwnd).toBe(150)
        expect((sctp as any).peerRwnd).toBe(50)
    })

    test('a single DATA packet is acked after the delay, every second packet at once', async () => {
        vi.useFakeTimers()
        const {sctp, transport} = createMockSctp();
        (sctp as any).lastReceivedTsn = 0

        await receiveDataPacket(sctp, 1)
        expect((transport.send as any).mock.calls.length).toBe(0)
        await vi.advanceTimersByTimeAsync(20)
        expect((transport.send as any).mock.calls.length).toBe(1)

        await receiveDataPacket(sctp, 2)
        expect((transport.send as any).mock.calls.length).toBe(1)
        await receiveDataPacket(sctp, 3)
        expect((transport.send as any).mock.calls.length).toBe(2)
        vi.useRealTimers()
    })

    test('a fragment in order is acked with the delayed sack', async () => {
        vi.useFakeTimers()
        const {sctp, transport} = createMockSctp();
        (sctp as any).lastReceivedTsn = 0
        const fragment = createDataChunk(1)
        fragment.flags = 0x02;

        (sctp as any).receiveDataChunk(fragment)
        await (sctp as any).scheduleSack()
        expect((transport.send as any).mock.calls.length).toBe(0)
        await vi.advanceTimersByTimeAsync(20)
        expect((transport.send as any).mock.calls.length).toBe(1)
        vi.useRealTimers()
    })

    test('gap/loss-signaled data triggers immediate sack', async () => {
        const {sctp, transport} = createMockSctp();
        (sctp as any).lastReceivedTsn = 0;

        (sctp as any).receiveDataChunk(createDataChunk(2))
        await (sctp as any).scheduleSack()

        expect((transport.send as any).mock.calls.length).toBe(1)
    })

    test('duplicate tsn triggers immediate sack', async () => {
        const {sctp, transport} = createMockSctp();
        (sctp as any).lastReceivedTsn = 1;

        (sctp as any).receiveDataChunk(createDataChunk(1))
        expect((sctp as any).sackImmediate).toBe(true)
        expect((sctp as any).sackDuplicates).toEqual([1])

        await (sctp as any).scheduleSack()
        expect((transport.send as any).mock.calls.length).toBe(1)
    })

    test('heartbeat timer uses rto + heartbeat interval', () => {
        const {sctp} = createMockSctp()
        const spy = vi.spyOn(global, 'setTimeout');
        (sctp as any).associationState = SCTP_STATE.ESTABLISHED;
        (sctp as any).rto = 2

        sctp.setHeartbeatInterval(30)
        expect(spy).toHaveBeenCalledWith(expect.any(Function), 32000)

        sctp.setHeartbeatInterval(5)
        expect(spy).toHaveBeenCalledWith(expect.any(Function), 7000);

        (sctp as any).heartbeatCancel()
        spy.mockRestore()
    })

    test('larger heartbeat interval delays no-response probe timing', async () => {
        vi.useFakeTimers()
        try {
            const fast = createMockSctp().sctp
            const slow = createMockSctp().sctp;
            (fast as any).associationState = SCTP_STATE.ESTABLISHED;
            (slow as any).associationState = SCTP_STATE.ESTABLISHED;
            (fast as any).rto = 1;
            (slow as any).rto = 1
            fast.setHeartbeatInterval(1)
            slow.setHeartbeatInterval(5)

            await vi.advanceTimersByTimeAsync(1999)
            expect(((fast as any).transport.send as any).mock.calls.length).toBe(0)
            expect(((slow as any).transport.send as any).mock.calls.length).toBe(0)

            await vi.advanceTimersByTimeAsync(1)
            expect(((fast as any).transport.send as any).mock.calls.length).toBe(1)
            expect(((slow as any).transport.send as any).mock.calls.length).toBe(0)

            await vi.advanceTimersByTimeAsync(3999)
            expect(((fast as any).transport.send as any).mock.calls.length).toBe(2)
            expect(((slow as any).transport.send as any).mock.calls.length).toBe(0)

            await vi.advanceTimersByTimeAsync(1)
            expect(((fast as any).transport.send as any).mock.calls.length).toBe(3)
            expect(((slow as any).transport.send as any).mock.calls.length).toBe(1)
        } finally {
            vi.useRealTimers()
        }
    })

    test('larger heartbeat interval increases no-response detection cadence and abort is handled', async () => {
        vi.useFakeTimers()
        try {
            const fast = createMockSctp().sctp
            const slow = createMockSctp().sctp;
            (fast as any).associationState = SCTP_STATE.ESTABLISHED;
            (slow as any).associationState = SCTP_STATE.ESTABLISHED;
            (fast as any).rto = 1;
            (slow as any).rto = 1
            fast.setHeartbeatInterval(1)
            slow.setHeartbeatInterval(5)

            await vi.advanceTimersByTimeAsync(6000)

            const fastHeartbeats = ((fast as any).transport.send as any).mock.calls
                .length
            const slowHeartbeats = ((slow as any).transport.send as any).mock.calls
                .length
            expect(fastHeartbeats).toBeGreaterThanOrEqual(3)
            expect(slowHeartbeats).toBe(1)

            await (fast as any).receiveChunk(new AbortChunk())
            await (slow as any).receiveChunk(new AbortChunk())
            expect(fast.associationState).toBe(SCTP_STATE.CLOSED)
            expect(slow.associationState).toBe(SCTP_STATE.CLOSED)
        } finally {
            vi.useRealTimers()
        }
    })
})

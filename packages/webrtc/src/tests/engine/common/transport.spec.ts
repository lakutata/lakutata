import {describe, test, expect, vi} from '../support/vitest.js'
import {TcpTransport, TlsTransport, UdpTransport} from '../../../lib/common/transport.js'
import {createHangingStreamServer} from './utils.js'

describe('stream transport connection timeout', () => {
    test('times out and destroys a socket when TLS negotiation never completes', async () => {
        // Arrange: TCP 接続だけを受理し、TLS handshake に応答しないサーバーを用意する。
        const server = await createHangingStreamServer()
        const startedAt = Date.now()

        try {
            // Act: 短い上限時間で TLS transport の初期化を試みる。
            await expect(
                TlsTransport.init(
                    server.address,
                    {rejectUnauthorized: false},
                    {
                        connectTimeoutMs: 200
                    }
                )
            ).rejects.toThrow('tls connect timed out after 200ms')

            // Assert: OS の接続待ちに依存せず終了し、サーバー側の socket も閉じられる。
            expect(Date.now() - startedAt).toBeLessThan(1_000)
            await vi.waitFor(() => expect(server.sockets.size).toBe(0))
        } finally {
            await server.close()
        }
    })

    test('bounds a pending TCP connection attempt', async () => {
        // Arrange: 外部へルーティングされない TEST-NET 宛先と短い上限時間を設定する。
        const startedAt = Date.now()

        // Act: TCP transport の初期化が失敗するまで待つ。
        await expect(
            TcpTransport.init(['192.0.2.1', 9], {connectTimeoutMs: 200})
        ).rejects.toThrow()

        // Assert: OS の長い SYN timeout を待たず、指定時間付近で処理が戻る。
        expect(Date.now() - startedAt).toBeLessThan(1_000)
    })
})

describe('UDP transport connected to the other side of a pair', () => {
    /**
     * The packets a transport receives
     */
    function received(transport: UdpTransport): Buffer[] {
        const packets: Buffer[] = []
        transport.onData = (data: Buffer) => void packets.push(data)
        return packets
    }

    test('connects once application data comes from the address, then sends only there', async () => {
        const [a, b, c] = await Promise.all([UdpTransport.init('udp4'), UdpTransport.init('udp4'), UdpTransport.init('udp4')])
        const atB = received(b)
        const atC = received(c)
        const atA = received(a)
        try {
            a.connectTo(['127.0.0.1', b.port])
            //A STUN message (first byte 0) does not tell that the other side sends its data on the pair
            await b.send(Buffer.from([0, 1, 0, 0]), ['127.0.0.1', a.port])
            await vi.waitFor(() => expect(atA.length).toBe(1))
            expect(() => a.socket.remoteAddress()).toThrow()
            //A DTLS record (first byte 23) does
            await b.send(Buffer.from([23, 254, 253]), ['127.0.0.1', a.port])
            await vi.waitFor(() => expect(a.socket.remoteAddress().port).toBe(b.port))
            await a.send(Buffer.from('to c'), ['127.0.0.1', c.port])
            await a.send(Buffer.from('to b'), ['127.0.0.1', b.port])
            await c.send(Buffer.from('from c'), ['127.0.0.1', a.port])
            await vi.waitFor(() => expect(atB.map(String)).toEqual(['to b']))
            await new Promise((resolve) => setTimeout(resolve, 100))
            expect(atC).toEqual([])
            expect(atA.length).toBe(2)
            //Disconnected, it sends to and receives from any address again
            a.disconnect()
            await a.send(Buffer.from('to c'), ['127.0.0.1', c.port])
            await c.send(Buffer.from('from c'), ['127.0.0.1', a.port])
            await vi.waitFor(() => expect(atC.map(String)).toEqual(['to c']))
            await vi.waitFor(() => expect(atA.map(String).at(-1)).toBe('from c'))
        } finally {
            await Promise.all([a.close(), b.close(), c.close()])
        }
    })

    test('sends what is sent while it connects, as a reply to the packet starting the connection', async () => {
        const [a, b] = await Promise.all([UdpTransport.init('udp4'), UdpTransport.init('udp4')])
        const atB = received(b)
        //The reply of a DTLS server to the first record of its client
        a.onData = (data: Buffer) => void a.send(Buffer.from(`reply to ${data[0]}`), ['127.0.0.1', b.port])
        try {
            a.connectTo(['127.0.0.1', b.port])
            await b.send(Buffer.from([22]), ['127.0.0.1', a.port])
            await vi.waitFor(() => expect(atB.map(String)).toEqual(['reply to 22']))
            await vi.waitFor(() => expect(a.socket.remoteAddress().port).toBe(b.port))
        } finally {
            await Promise.all([a.close(), b.close()])
        }
    })

    test('does not connect to a host name', async () => {
        const [a, b] = await Promise.all([UdpTransport.init('udp4'), UdpTransport.init('udp4')])
        try {
            a.connectTo(['localhost', b.port])
            await b.send(Buffer.from([23]), ['127.0.0.1', a.port])
            await new Promise((resolve) => setTimeout(resolve, 100))
            expect(() => a.socket.remoteAddress()).toThrow()
        } finally {
            await Promise.all([a.close(), b.close()])
        }
    })
})

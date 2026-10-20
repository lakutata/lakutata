import {test, expect} from '../support/vitest.js'
import {createSocket} from 'node:dgram'

import {SCTP, WEBRTC_PPID} from '../../../lib/sctp/index.js'
import {createUdpTransport} from '../../../lib/sctp/transport.js'

test('udp', async () => {
    const port = 5556

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
        await new Promise<void>((done, fail) => {
            server.onReceive.subscribe((_, __, data) => {
                expect(data.toString()).toBe('ping')
                void server.send(0, WEBRTC_PPID.STRING, Buffer.from('pong'))
            })
            client.onReceive.subscribe((_, __, data) => {
                expect(data.toString()).toBe('pong')
                done()
            })

            const connect = async () => {
                await Promise.all([client.start(5000), server.start(5000)])
                await Promise.all([
                    client.stateChanged.connected.asPromise(),
                    server.stateChanged.connected.asPromise()
                ])

                void client.send(0, WEBRTC_PPID.STRING, Buffer.from('ping'))
            }
            connect().catch(fail)
        })
    } finally {
        await Promise.all([client.stop(), server.stop()])
        socket.close()
        clientSocket.close()
    }
})

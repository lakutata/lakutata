import {afterEach, describe, test, expect} from '../../support/vitest.js'
import {RTCDataChannel, RTCSctpTransport} from '../../../../lib/peer/index.js'
import {RTCDataChannelParameters} from '../../../../lib/peer/dataChannel.js'
import {dtlsTransportPair, stopTransportPairs} from '../fixture.js'

afterEach(stopTransportPairs)

describe('RTCSctpTransportTest', () => {
    test('reuses outbound MTU when replacing the DTLS transport', async () => {
        const [first] = await dtlsTransportPair()
        const [second] = await dtlsTransportPair()
        const transport = new RTCSctpTransport(5000, undefined, {mtu: 1052})

        // Act: DTLS transport を差し替えて SCTP association を再生成する。
        transport.setDtlsTransport(first)
        transport.setDtlsTransport(second)

        // Assert: constructor で指定した MTU が再生成後にも保持される。
        expect(transport.sctp.mtu).toBe(1052)
    })

    function trackChannels(transport: RTCSctpTransport) {
        const channels: RTCDataChannel[] = []

        transport.onDataChannel.subscribe((channel) => {
            channels.push(channel)
        })

        return {channels, event: transport.onDataChannel}
    }

    async function waitForOutcome(
        client: RTCSctpTransport,
        server: RTCSctpTransport
    ) {
        await Promise.all([
            client.sctp.stateChanged.connected.asPromise(),
            server.sctp.stateChanged.connected.asPromise()
        ])
    }

    test('the DTLS client takes the even stream ids and the server the odd ones, whatever the roles of ICE', async () => {
        const [clientTransport, serverTransport] = await dtlsTransportPair()
        // Arrange: DTLS server が ICE では controlled (ICE の役割で選ぶと偶数になる)。
        clientTransport.iceTransport.connection.iceControlling = true
        serverTransport.iceTransport.connection.iceControlling = false
        const client = new RTCSctpTransport()
        client.setDtlsTransport(clientTransport)
        const server = new RTCSctpTransport()
        server.setDtlsTransport(serverTransport)
        await Promise.all([server.start(client.port), client.start(server.port)])
        await waitForOutcome(client, server)

        // Act: 両側が id 指定なしの channel を 2 つずつ作る。
        const opened = (transport: RTCSctpTransport) => {
            const channels = [1, 2].map((index) => new RTCDataChannel(transport, new RTCDataChannelParameters({label: `c${index}`})))
            return Promise.all(channels.map((channel) => channel.stateChanged.watch((state) => state === 'open').then(() => channel.id)))
        }
        const [clientIds, serverIds] = await Promise.all([opened(client), opened(server)])

        // Assert: RFC 8832 section 6 どおり、client は偶数、server は奇数。
        expect(clientIds).toEqual([0, 2])
        expect(serverIds).toEqual([1, 3])
        await Promise.all([client.stop(), server.stop()])
    })

    test('test_connect_then_client_creates_data_channel', async () =>
        new Promise<void>((done, fail) => {
            (async () => {
                const [clientTransport, serverTransport] = await dtlsTransportPair()

                const client = new RTCSctpTransport()
                client.setDtlsTransport(clientTransport)
                const server = new RTCSctpTransport()
                server.setDtlsTransport(serverTransport)

                await Promise.all([server.start(client.port), client.start(server.port)])

                // wait for sctp connected
                await waitForOutcome(client, server)

                const serverChannels = trackChannels(server)
                serverChannels.event.subscribe((channel) => {
                    channel.send(Buffer.from('ping'))
                    channel.onMessage.subscribe((data) => {
                        expect(data.toString()).toBe('pong')
                        done()
                    })
                })

                const channel = new RTCDataChannel(
                    client,
                    new RTCDataChannelParameters({label: 'chat', id: 1})
                )
                channel.onMessage.subscribe((data) => {
                    expect(data.toString()).toBe('ping')
                    channel.send(Buffer.from('pong'))
                })
            })().catch(fail)
        }))
})

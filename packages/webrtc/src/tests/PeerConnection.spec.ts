import {describe, it} from 'node:test'
import assert from 'node:assert'
import {randomBytes} from 'node:crypto'
import {Container} from '@lakutata/core'
import {PeerConnection} from '../peer/PeerConnection.js'
import type {PeerChannel} from '../peer/PeerChannel.js'
import {ChunkedChannel} from '../shared/ChunkedChannel.js'
import type {SignalingCandidate} from '../protocol/SignalingProtocol.js'
import {next} from './support/Server.js'

/**
 * Two connections exchanging their descriptions and candidates directly, the offerer opening a channel
 * @param container
 */
async function connectedPair(container: Container): Promise<{offerer: PeerConnection, answerer: PeerConnection, local: PeerChannel, remote: PeerChannel}> {
    const offerer: PeerConnection = await container.get(PeerConnection)
    const answerer: PeerConnection = await container.get(PeerConnection)
    offerer.on('icecandidate', (candidate: SignalingCandidate | null): void => void answerer.addIceCandidate(candidate))
    answerer.on('icecandidate', (candidate: SignalingCandidate | null): void => void offerer.addIceCandidate(candidate))
    const remote: Promise<PeerChannel> = next<PeerChannel>((resolve: (channel: PeerChannel) => void): unknown => answerer.once('datachannel', resolve), 15000, 'the channel')
    const local: PeerChannel = offerer.createDataChannel('data')
    await offerer.setLocalDescription()
    await answerer.setRemoteDescription(offerer.localDescription!)
    await answerer.setLocalDescription()
    await offerer.setRemoteDescription(answerer.localDescription!)
    await next<void>((resolve: () => void): unknown => local.once('open', resolve), 15000, 'the open channel')
    return {offerer: offerer, answerer: answerer, local: local, remote: await remote}
}

describe('PeerConnection', (): void => {

    it('has the interface of RTCPeerConnection: events in both styles, states, descriptions', {timeout: 30000}, async (): Promise<void> => {
        const container: Container = new Container()
        try {
            const states: string[] = []
            const {offerer, answerer, local, remote} = await connectedPair(container)
            offerer.addEventListener('connectionstatechange', (): unknown => states.push(offerer.connectionState))
            assert.strictEqual(offerer.connectionState, 'connected')
            assert.strictEqual(offerer.signalingState, 'stable')
            assert.strictEqual(offerer.remoteDescription?.type, 'answer')
            assert.ok(offerer.sctp && offerer.sctp.maxMessageSize > 0)
            //The W3C style: the event object, the handler property
            const viaEvent: Promise<unknown> = next((resolve: (value: unknown) => void): void => remote.addEventListener('message', (event: MessageEvent): void => resolve(event.data)), 5000, 'message')
            const viaHandler: Promise<unknown> = next((resolve: (value: unknown) => void): void => {
                remote.onmessage = (event: MessageEvent): void => resolve(event.data)
            }, 5000, 'onmessage')
            local.send('text')
            assert.strictEqual(await viaEvent, 'text')
            assert.strictEqual(await viaHandler, 'text')
            //Binary: a Buffer, or an ArrayBuffer
            const binary: Promise<unknown> = next((resolve: (value: unknown) => void): unknown => remote.once('message', resolve), 5000, 'binary')
            local.send(new Uint8Array([1, 2, 3]))
            assert.deepStrictEqual(await binary, Buffer.from([1, 2, 3]))
            remote.binaryType = 'arraybuffer'
            const arrayBuffer: Promise<unknown> = next((resolve: (value: unknown) => void): unknown => remote.once('message', resolve), 5000, 'array buffer')
            local.send(Buffer.from([4, 5]))
            assert.ok((await arrayBuffer) instanceof ArrayBuffer)
            //A label and a protocol of other characters than ASCII
            const named: Promise<PeerChannel> = next<PeerChannel>((resolve: (channel: PeerChannel) => void): unknown => answerer.once('datachannel', resolve), 10000, 'the named channel')
            offerer.createDataChannel('会议', {protocol: 'mitglied-ü'})
            assert.deepStrictEqual([(await named).label, (await named).protocol], ['会议', 'mitglied-ü'])
            //Unordered and partially reliable
            const partial: Promise<PeerChannel> = next<PeerChannel>((resolve: (channel: PeerChannel) => void): unknown => answerer.once('datachannel', resolve), 10000, 'the unordered channel')
            offerer.createDataChannel('state', {ordered: false, maxRetransmits: 0})
            assert.deepStrictEqual([(await partial).ordered, (await partial).maxRetransmits], [false, 0])
            //An event dispatched reaches the listeners of both styles
            const dispatched: unknown[] = []
            const listener = (event: MessageEvent): number => dispatched.push(event.data)
            remote.addEventListener('message', listener)
            remote.on('message', (data: unknown): number => dispatched.push(data))
            assert.strictEqual(remote.dispatchEvent(new MessageEvent('message', {data: 'again'})), true)
            assert.deepStrictEqual(dispatched, ['again', 'again'])
            remote.removeEventListener('message', listener)
            //Closing the channel closes the other side
            const closed: Promise<void> = next<void>((resolve: () => void): unknown => remote.once('close', resolve), 10000, 'close')
            local.close()
            await closed
            assert.strictEqual(remote.readyState, 'closed')
            assert.throws((): void => local.send('late'), {name: 'InvalidStateError'})
            answerer.close()
            offerer.close()
        } finally {
            await container.destroy()
        }
    })

    it('sends messages of any size with a chunked channel: text, bytes, Blob, empty', {timeout: 60000}, async (): Promise<void> => {
        const container: Container = new Container()
        try {
            const {local, remote} = await connectedPair(container)
            const sender: ChunkedChannel = new ChunkedChannel(local)
            const receiver: ChunkedChannel = new ChunkedChannel(remote, {maxMessageSize: 32 * 1024 * 1024})
            const received: (string | Uint8Array)[] = []
            receiver.on('message', (data: string | Uint8Array): unknown => received.push(data))
            const large: Buffer = randomBytes(20 * 1024 * 1024)
            const text: string = 'é'.repeat(100000)
            await Promise.all([
                sender.send(large),
                sender.send(text),
                sender.send(new Blob([Buffer.from('a blob, '), Buffer.from('in two parts')])),
                sender.send('')
            ])
            const deadline: number = Date.now() + 30000
            while (received.length < 4 && Date.now() < deadline) await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
            assert.strictEqual(received.length, 4)
            assert.ok(Buffer.from(received[0] as Uint8Array).equals(large))
            assert.strictEqual(received[1], text)
            assert.strictEqual(Buffer.from(received[2] as Uint8Array).toString(), 'a blob, in two parts')
            assert.strictEqual(received[3], '')
            //Over the limit: dropped, with an error
            const error: Promise<Error> = next<Error>((resolve: (error: Error) => void): unknown => receiver.on('error', resolve), 30000, 'the error')
            await sender.send(new Uint8Array(33 * 1024 * 1024))
            assert.match((await error).message, /dropped/)
            await sender.send('after')
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 200))
            assert.strictEqual(received.at(-1), 'after')
        } finally {
            await container.destroy()
        }
    })
})

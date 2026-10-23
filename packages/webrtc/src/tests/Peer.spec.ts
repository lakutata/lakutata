import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {MediaTrack} from '../peer/MediaTrack.js'
import {PeerConnection, type PeerTrackEvent} from '../peer/PeerConnection.js'
import {Peer, type PeerHost, type PeerSignal} from '../shared/Peer.js'
import {feed, from} from './support/Media.js'
import {next} from './support/Server.js'

describe('Peer', (): void => {

    it('answers an offer before offering what a track it brings needs, the negotiations chained with the signals', {timeout: 30000}, async (): Promise<void> => {
        const container: Container = new Container()
        //The descriptions each side sends, in order
        const sent: Record<string, string[]> = {member: [], server: []}
        const peers: Record<string, Peer<PeerConnection>> = {}
        const host = (localId: string, other: string, polite: boolean): PeerHost<PeerConnection> => ({
            localId: localId,
            create: (): Promise<PeerConnection> => container.get(PeerConnection, {}),
            send: async (_to: string, signal: PeerSignal): Promise<void> => {
                if (signal.description) sent[localId].push(signal.description.type)
                peers[other].receive(signal)
            },
            signalingUp: true,
            closed: (): void => undefined,
            polite: polite
        })
        const stops: (() => void)[] = []
        try {
            //The server, which does not give up its offers, sends the member a video as soon as the member's comes
            peers.member = new Peer<PeerConnection>(host('member', 'server', true), 'server', {}, undefined)
            peers.server = new Peer<PeerConnection>(host('server', 'member', false), 'member', {}, undefined)
            await Promise.all([peers.member.ready, peers.server.ready])
            const received: Promise<PeerTrackEvent> = next<PeerTrackEvent>((resolve: (event: PeerTrackEvent) => void): unknown => peers.member.on('track', resolve), 15000, 'the video of the server')
            peers.server.on('track', (): void => {
                const video: MediaTrack = new MediaTrack('video', {codec: 'video/VP8'})
                stops.push(feed(video, 200000))
                peers.server.connection.addTransceiver(video, {direction: 'sendonly'})
            })
            const forwarded: Promise<PeerTrackEvent> = next<PeerTrackEvent>((resolve: (event: PeerTrackEvent) => void): unknown => peers.server.on('track', resolve), 15000, 'the video of the member')
            const camera: MediaTrack = new MediaTrack('video', {codec: 'video/VP8'})
            stops.push(feed(camera, 100000))
            peers.member.connection.addTransceiver(camera, {direction: 'sendonly'})
            assert.ok(await from((await forwarded).track, 100000), 'the packets of the member')
            assert.ok(await from((await received).track, 200000), 'the packets of the server')
            //No offer between the offer of the member and its answer
            assert.deepStrictEqual(sent.server, ['answer', 'offer'])
            assert.deepStrictEqual(sent.member, ['offer', 'answer'])
        } finally {
            stops.forEach((stop: () => void): void => stop())
            peers.member?.close()
            peers.server?.close()
            await container.destroy()
        }
    })
})

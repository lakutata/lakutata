import {describe, test, expect} from '../../support/vitest.js'
import {
    MediaStreamTrack,
    RTCRtpTransceiver,
    RtpHeader,
    RtpPacket,
    defaultPeerConfig
} from '../../../../lib/peer/index.js'
import {
    RTCRtpCodecParameters,
    RTCRtpCodingParameters
} from '../../../../lib/peer/media/parameters.js'
import {RtpRouter} from '../../../../lib/peer/media/router.js'
import {RTCRtpReceiver} from '../../../../lib/peer/media/rtpReceiver.js'
import {RTCRtpSender} from '../../../../lib/peer/media/rtpSender.js'
import {PictureLossIndication, RtcpPayloadSpecificFeedback} from '../../../../lib/rtp/index.js'
import {createDtlsTransport} from '../fixture.js'

describe('media/router', () => {
    test('routeRtp', async () => {
        const router = new RtpRouter()
        const receiver = new RTCRtpReceiver(defaultPeerConfig, 'audio', 0)
        await new Promise<void>((done) => {
            const dtls = createDtlsTransport()
            const transceiver = new RTCRtpTransceiver(
                'audio',
                dtls,
                receiver,
                new RTCRtpSender('audio'),
                'recvonly'
            )
            const ssrc = 123
            const track = new MediaStreamTrack({kind: 'audio', ssrc})
            transceiver.addTrack(track)

            router.registerRtpReceiverBySsrc(transceiver, {
                encodings: [new RTCRtpCodingParameters({ssrc, payloadType: 0})],
                codecs: [],
                headerExtensions: []
            })

            transceiver.receiver.prepareReceive({
                encodings: [],
                codecs: [
                    new RTCRtpCodecParameters({
                        clockRate: 90000,
                        mimeType: 'Video/VP6',
                        payloadType: 0
                    })
                ],
                headerExtensions: []
            })

            const packet = new RtpPacket(
                new RtpHeader({ssrc, payloadType: 0}),
                Buffer.from('hello')
            )
            track.onReceiveRtp.once((rtp) => {
                expect(rtp.payload.toString()).toBe('hello')
                done()
            })
            router.routeRtp(packet)
        }).finally(() => receiver.stop())
    })

    test('routes a picture loss indication to the sender of its media source', () => {
        const router = new RtpRouter()
        //A sendrecv transceiver: the other side's source sends the feedback and is received here
        const sender = new RTCRtpSender('video')
        const receiver = new RTCRtpReceiver(defaultPeerConfig, 'video', sender.ssrc)
        router.registerRtpSender(sender)
        router.ssrcTable[4242] = receiver
        let senderGotIt = false
        let receiverGotIt = false
        sender.onPictureLossIndication.subscribe(() => {
            senderGotIt = true
        })
        receiver.handleRtcpPacket = () => {
            receiverGotIt = true
        }
        router.routeRtcp(new RtcpPayloadSpecificFeedback({
            feedback: new PictureLossIndication({senderSsrc: 4242, mediaSsrc: sender.ssrc})
        }))
        expect(senderGotIt).toBe(true)
        expect(receiverGotIt).toBe(false)
    })
})

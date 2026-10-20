import {networkTests} from '../../support/requirements.js'
import {describe, test, expect} from '../../support/vitest.js'
import {RTCPeerConnection} from '../../../../lib/peer/index.js'

describe('trickle', () => {
    test('half trickle', {...networkTests, timeout: 15 * 1000}, async () => {
        const pcOffer = new RTCPeerConnection({
            iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
        })
        const pcAnswer = new RTCPeerConnection({
            iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
        })
        try {
            await new Promise<void>((done, fail) => {
                pcAnswer.onDataChannel.subscribe((dc) => {
                    dc.onMessage.subscribe((data) => {
                        expect(data.toString()).toBe('hello')
                        done()
                    })
                })

                pcOffer.onIceCandidate.subscribe((candidate) => {
                    if (!candidate) {
                        expect(pcOffer._localDescription?.media.length).toBe(1)
                        return
                    }
                    pcAnswer.addIceCandidate(candidate).catch((error) => {
                        if (
                            (error as Error).message !== 'The remote description was null'
                        ) {
                            throw error
                        }
                    })
                })

                const dc = pcOffer.createDataChannel('dc')
                dc.stateChanged.subscribe((state) => {
                    if (state === 'open') {
                        dc.send(Buffer.from('hello'))
                    }
                })

                const negotiate = async () => {
                    const offer = await pcOffer.createOffer()
                    void pcOffer.setLocalDescription(offer).then(() => {
                        expect(pcOffer._localDescription?.media.length).toBe(1)
                    })

                    await pcAnswer.setRemoteDescription(offer)
                    await pcAnswer.setLocalDescription(await pcAnswer.createAnswer())

                    await pcOffer.setRemoteDescription(pcAnswer.localDescription!)
                }
                negotiate().catch(fail)
            })
        } finally {
            await Promise.all([pcOffer.close(), pcAnswer.close()])
        }
    })

    test('trickle', {...networkTests, timeout: 15 * 1000}, async () => {
        const pcOffer = new RTCPeerConnection({
            iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
        })
        const pcAnswer = new RTCPeerConnection({
            iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
        })
        try {
            await new Promise<void>((done, fail) => {
                pcAnswer.onDataChannel.subscribe((dc) => {
                    dc.onMessage.subscribe((data) => {
                        expect(data.toString()).toBe('hello')
                        done()
                    })
                })

                pcOffer.onIceCandidate.subscribe((candidate) => {
                    if (!candidate) {
                        return
                    }
                    pcAnswer.addIceCandidate(candidate).catch((error) => {
                        if (
                            (error as Error).message !== 'The remote description was null'
                        ) {
                            throw error
                        }
                    })
                })
                pcAnswer.onIceCandidate.subscribe((candidate) => {
                    if (!candidate) {
                        return
                    }
                    pcOffer.addIceCandidate(candidate).catch((error) => {
                        if (
                            (error as Error).message !== 'The remote description was null'
                        ) {
                            throw error
                        }
                    })
                })

                const dc = pcOffer.createDataChannel('dc')
                dc.stateChanged.subscribe((state) => {
                    if (state === 'open') {
                        dc.send(Buffer.from('hello'))
                    }
                })

                const negotiate = async () => {
                    const offer = await pcOffer.createOffer()
                    void pcOffer.setLocalDescription(offer)
                    await pcAnswer.setRemoteDescription(offer)

                    const answer = await pcAnswer.createAnswer()
                    void pcAnswer.setLocalDescription(answer)
                    await pcOffer.setRemoteDescription(answer)
                }
                negotiate().catch(fail)
            })
        } finally {
            await Promise.all([pcOffer.close(), pcAnswer.close()])
        }
    })
})

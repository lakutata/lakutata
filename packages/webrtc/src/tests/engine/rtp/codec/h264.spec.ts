import {describe, it, expect} from '../../support/vitest.js'
import {H264RtpPayload} from '../../../../lib/rtp/index.js'

// from pion-rtp

describe('packages/rtp/tests/codec/h264.test.ts', () => {
    const singlePayload = Buffer.from([0x90, 0x90, 0x90])
    const singlePayloadUnmarshaled = Buffer.from([
        0x00, 0x00, 0x00, 0x01, 0x90, 0x90, 0x90
    ])

    it('singlePayload', () => {
        const res = H264RtpPayload.deSerialize(singlePayload).payload
        expect(res).toEqual(singlePayloadUnmarshaled)
    })
})

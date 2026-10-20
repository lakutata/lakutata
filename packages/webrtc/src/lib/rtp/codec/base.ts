import type {RtpHeader} from '../rtp/rtp.js'

export abstract class DePacketizerBase {
    payload!: Buffer
    fragment?: Buffer

    static deSerialize(_buf: Buffer, _fragment?: Buffer) {
        return {} as unknown as DePacketizerBase
    }

    static isDetectedFinalPacketInSequence(_header: RtpHeader) {
        return true as boolean
    }

    get isKeyframe() {
        return true as boolean
    }
}

import type {RtcpHeader} from '../../rtcp/header.js'
import type {RtpHeader} from '../../rtp/rtp.js'

export abstract class CipherAesBase {
    constructor(
        public srtpSessionKey: Buffer,
        public srtpSessionSalt: Buffer,
        public srtcpSessionKey: Buffer,
        public srtcpSessionSalt: Buffer
    ) {}

    encryptRtp(
        _header: RtpHeader,
        _payload: Buffer,
        _rolloverCounter: number
    ): Buffer {
        return Buffer.from([])
    }

    decryptRtp(
        _cipherText: Buffer,
        _rolloverCounter: number,
        _header?: RtpHeader
    ): [Buffer, RtpHeader] {
        return [] as any
    }

    encryptRTCP(_rawRtcp: Buffer, _srtcpIndex: number): Buffer {
        return Buffer.from([])
    }

    decryptRTCP(_encrypted: Buffer): [Buffer, RtcpHeader] {
        return [] as any
    }
}

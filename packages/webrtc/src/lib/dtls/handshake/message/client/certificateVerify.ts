import {binaryData} from '../../../imports/common.js'

import type {SignatureSchemes} from '../../../cipher/const.js'
import {FragmentedHandshake} from '../../../record/message/fragment.js'
import type {Handshake} from '../../../typings/domain.js'
import {HandshakeType} from '../../const.js'

const {decode, encode, types} = binaryData

export class CertificateVerify implements Handshake {
    msgType = HandshakeType.certificate_verify_15
    messageSeq?: number

    static readonly spec = {
        algorithm: types.uint16be,
        signature: types.buffer(types.uint16be)
    }

    constructor(
        public algorithm: SignatureSchemes,
        public signature: Buffer
    ) {}

    static createEmpty() {
        return new CertificateVerify(undefined as any, undefined as any)
    }

    static deSerialize(buf: Buffer) {
        const res = decode(buf, CertificateVerify.spec)
        return new CertificateVerify(
            //@ts-expect-error The decoded values are spread in the order of the spec, which TypeScript cannot follow
            ...Object.values(res)
        )
    }

    serialize() {
        return encode(this, CertificateVerify.spec)
    }

    toFragment() {
        const body = this.serialize()
        return new FragmentedHandshake(
            this.msgType,
            body.length,
            this.messageSeq!,
            0,
            body.length,
            body
        )
    }
}

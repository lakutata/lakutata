import {binaryData} from '../../imports/common.js'

import {FragmentedHandshake} from '../../record/message/fragment.js'
import type {Handshake} from '../../typings/domain.js'
import {ASN11Cert} from '../binary.js'
import {HandshakeType} from '../const.js'

const {decode, encode, types} = binaryData

// 7.4.2.  Server Certificate
// 7.4.6.  Client Certificate

export class Certificate implements Handshake {
    msgType = HandshakeType.certificate_11
    messageSeq?: number
    static readonly spec = {
        certificateList: types.array(ASN11Cert, types.uint24be, 'bytes')
    }

    constructor(public certificateList: Buffer[]) {}

    static createEmpty() {
        return new Certificate(undefined as any)
    }

    static deSerialize(buf: Buffer) {
        return new Certificate(
            //@ts-expect-error The decoded values are spread in the order of the spec, which TypeScript cannot follow
            ...Object.values(decode(buf, Certificate.spec))
        )
    }

    serialize() {
        return encode(this, Certificate.spec)
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

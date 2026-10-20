import {binaryData} from '../../../imports/common.js'

import {FragmentedHandshake} from '../../../record/message/fragment.js'
import type {Handshake} from '../../../typings/domain.js'
import {HandshakeType} from '../../const.js'

const {decode, encode} = binaryData

// 7.4.5.  Server Hello Done

export class ServerHelloDone implements Handshake {
    msgType = HandshakeType.server_hello_done_14
    messageSeq?: number
    static readonly spec = {}

    static createEmpty() {
        return new ServerHelloDone()
    }

    static deSerialize(buf: Buffer) {
        return new ServerHelloDone(
            //@ts-expect-error The decoded values are spread in the order of the spec, which TypeScript cannot follow
            ...Object.values(decode(buf, ServerHelloDone.spec))
        )
    }

    serialize() {
        return encode(this, ServerHelloDone.spec)
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

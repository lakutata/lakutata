import {binaryData} from '../../../imports/common.js'

import {FragmentedHandshake} from '../../../record/message/fragment.js'
import type {Handshake} from '../../../typings/domain.js'
import {ProtocolVersion} from '../../binary.js'
import {HandshakeType} from '../../const.js'

const {decode, encode, types} = binaryData

// 4.2.1.  Denial-of-Service Countermeasures

export class ServerHelloVerifyRequest implements Handshake {
    msgType = HandshakeType.hello_verify_request_3
    messageSeq?: number
    static readonly spec = {
        serverVersion: ProtocolVersion,
        cookie: types.buffer(types.uint8)
    }

    constructor(
        public serverVersion: {major: number, minor: number},
        public cookie: Buffer
    ) {}

    static createEmpty() {
        return new ServerHelloVerifyRequest(undefined as any, undefined as any)
    }

    static deSerialize(buf: Buffer) {
        return new ServerHelloVerifyRequest(
            //@ts-expect-error The decoded values are spread in the order of the spec, which TypeScript cannot follow
            ...Object.values(decode(buf, ServerHelloVerifyRequest.spec))
        )
    }

    serialize() {
        return encode(this, ServerHelloVerifyRequest.spec)
    }

    get version() {
        return {
            major: 255 - this.serverVersion.major,
            minor: 255 - this.serverVersion.minor
        }
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

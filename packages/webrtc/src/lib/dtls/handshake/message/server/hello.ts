import {binaryData} from '../../../imports/common.js'

import type {CipherSuites} from '../../../cipher/const.js'
import {FragmentedHandshake} from '../../../record/message/fragment.js'
import type {
    Extension,
    Handshake,
    Random,
    Version
} from '../../../typings/domain.js'
import {ExtensionList, ProtocolVersion} from '../../binary.js'
import {HandshakeType} from '../../const.js'
import {DtlsRandom} from '../../random.js'

const {decode, encode, types} = binaryData

// 7.4.1.3.  Server Hello

export class ServerHello implements Handshake {
    msgType = HandshakeType.server_hello_2
    messageSeq?: number
    static readonly spec = {
        serverVersion: ProtocolVersion,
        random: DtlsRandom.spec,
        sessionId: types.buffer(types.uint8),
        cipherSuite: types.uint16be,
        compressionMethod: types.uint8
    }

    constructor(
        public serverVersion: Version,
        public random: Random,
        public sessionId: Buffer,
        public cipherSuite: CipherSuites,
        public compressionMethod: number,
        public extensions: Extension[]
    ) {}

    static createEmpty() {
        return new ServerHello(
            undefined as any,
            undefined as any,
            undefined as any,
            undefined as any,
            undefined as any,
            undefined as any
        )
    }

    static deSerialize(buf: Buffer) {
        const res = decode(buf, ServerHello.spec)
        const cls = new ServerHello(
            //@ts-expect-error The decoded values are spread in the order of the spec, which TypeScript cannot follow
            ...Object.values(res)
        )
        const expect = cls.serialize()
        if (expect.length < buf.length) {
            return new ServerHello(
                //@ts-expect-error The decoded values are spread in the order of the spec, which TypeScript cannot follow
                ...Object.values(
                    decode(buf, {...ServerHello.spec, extensions: ExtensionList})
                )
            )
        }
        return cls
    }

    serialize() {
        return this.extensions === undefined
            ? encode(this, ServerHello.spec)
            : encode(this, {
                ...ServerHello.spec,
                extensions: ExtensionList
            })
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

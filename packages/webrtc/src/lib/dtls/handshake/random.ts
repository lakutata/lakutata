import {randomBytes} from 'node:crypto'
import {binaryData} from '../imports/common.js'

const {decode, encode, types} = binaryData

export class DtlsRandom {
    static readonly spec = {
        gmt_unix_time: types.uint32be,
        random_bytes: types.buffer(28)
    }

    constructor(
        public gmt_unix_time = Math.floor(Date.now() / 1000),
        public random_bytes = randomBytes(28)
    ) {}

    static deSerialize(buf: Buffer) {
        return new DtlsRandom(
            //@ts-expect-error The decoded values are spread in the order of the spec, which TypeScript cannot follow
            ...Object.values(decode(buf, DtlsRandom.spec))
        )
    }

    static from(spec: binaryData.Decoded<typeof DtlsRandom.spec>) {
    //@ts-expect-error The decoded values are spread in the order of the spec, which TypeScript cannot follow
        return new DtlsRandom(...Object.values(spec))
    }

    serialize() {
        return encode(this, DtlsRandom.spec)
    }
}

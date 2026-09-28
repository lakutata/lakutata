import {Codec} from 'nats'

export function JSONCodec(): Codec<any> {
    return {
        encode(d: any): Uint8Array {
            return Buffer.from(JSON.stringify([d]))
        },
        decode(a: Uint8Array): any {
            const [res] = JSON.parse(Buffer.from(a).toString())
            return res
        }
    }
}
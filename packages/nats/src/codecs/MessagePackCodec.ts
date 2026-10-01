import {Codec} from 'nats'
import {MessagePack} from '@lakutata/utils'

export function MessagePackCodec(): Codec<any> {
    return {
        encode(d: any): Uint8Array {
            return MessagePack.encode(JSON.parse(JSON.stringify([d])))
        },
        decode(a: Uint8Array): any {
            const [res] = MessagePack.decode(a)
            return res
        }
    }
}
import {Codec} from 'nats'
import {MessagePack} from '@lakutata/utils'

/**
 * Create the MessagePack codec of the NATS messages, the default `codec` of the {@link NATS} component. A value is sent
 * as the MessagePack encoding of a one-element array holding it, smaller and faster to decode than JSON.
 *
 * The value is first normalized through JSON (`JSON.parse(JSON.stringify(value))`), so that the peers written in other
 * languages receive plain JSON data: a `Date` arrives as its ISO string, a `Buffer` as `{type: 'Buffer', data: [...]}`
 * (the binary data is not kept as binary), a class instance as a plain object, `undefined` as `null` (and is dropped
 * from the objects); a `bigint` or a circular value fails the encoding with a `TypeError`. Decoding bytes which are not
 * MessagePack throws. Both sides of a subject must use the same codec.
 * @returns The codec.
 * @example
 * ```typescript
 * import {messagePackCodec} from '@lakutata/nats'
 *
 * const codec = messagePackCodec()
 * const bytes: Uint8Array = codec.encode({id: 1, tags: ['a', 'b']})
 * console.log(codec.decode(bytes)) //{id: 1, tags: ['a', 'b']}
 * console.log(codec.decode(codec.encode(undefined))) //null
 * ```
 */
export function messagePackCodec(): Codec<any> {
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
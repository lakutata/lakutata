import {Codec} from 'nats'

/**
 * Create the JSON codec of the NATS messages, for the `codec` option of {@link BuildNatsClientOptions}. A value is sent
 * as the UTF-8 JSON text of a one-element array (`{id: 1}` is sent as `[{"id":1}]`), so that every value, `null` and
 * the strings included, has a JSON form; the peers written in other languages wrap and unwrap that array.
 *
 * The values go through `JSON.stringify()`: a `Date` arrives as its ISO string, a `Buffer` as
 * `{type: 'Buffer', data: [...]}`, a class instance as a plain object, `undefined` as `null` (and is dropped from the
 * objects), `NaN` and `Infinity` as `null`; a `bigint` or a circular value fails the encoding with a `TypeError`.
 * Decoding bytes which are not such JSON throws a `SyntaxError`. Both sides of a subject must use the same codec.
 * @returns The codec.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {BuildNatsClientOptions, JSONCodec} from '@lakutata/nats'
 *
 * Application.run({
 *     id: 'json.app',
 *     name: 'JSON',
 *     components: {
 *         //Readable messages, for peers which do not speak MessagePack
 *         nats: BuildNatsClientOptions({servers: 'nats://127.0.0.1:4222', codec: JSONCodec()})
 *     }
 * })
 *
 * const codec = JSONCodec()
 * const bytes: Uint8Array = codec.encode({id: 1, at: new Date(0)})
 * console.log(Buffer.from(bytes).toString()) //[{"id":1,"at":"1970-01-01T00:00:00.000Z"}]
 * console.log(codec.decode(bytes)) //{id: 1, at: '1970-01-01T00:00:00.000Z'}
 * ```
 */
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
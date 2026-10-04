import {Encoder} from './internal/msgpack/Encoder.js'
import {Decoder} from './internal/msgpack/Decoder.js'

/**
 * The encoder and the decoder, reused (a reentrant use creates another one)
 */
const encoder: Encoder = new Encoder()

const decoder: Decoder = new Decoder()

/**
 * Serialize values to and from MessagePack, a compact binary format (smaller and faster than JSON, with binary data and
 * dates). Its static methods encode to bytes (`encode`/`decode`) or to a string (`stringify`/`parse`, Base64 by
 * default).
 *
 * What survives the round trip: `null`, booleans, numbers (`NaN` and the infinities included), strings, arrays, plain
 * objects, `Date` (to the millisecond), the bytes (`Buffer`, `Uint8Array`, which come back as a `Uint8Array`) and the
 * `bigint` values from `-(2n ** 63n)` to `2n ** 64n - 1n`. What changes: the `undefined` properties are dropped
 * (`undefined` itself and in an array becomes `null`), a class instance becomes a plain object of its own enumerable
 * properties, a `Map` is encoded as a map of its entries and decodes as a plain object (its number keys as strings), a
 * `Set` is encoded as an array of its values and decodes as an array, and `Error`, `RegExp` and the other typed arrays
 * and buffers lose their content (an `ArrayBuffer` becomes `{}`, a `Float32Array` its raw bytes).
 * @example
 * ```typescript
 * import {MessagePack} from 'lakutata/utils'
 *
 * const bytes: Uint8Array = MessagePack.encode({id: 1, at: new Date(0), tags: ['a', 'b']})
 * console.log(MessagePack.decode(bytes))
 * //{id: 1, at: 1970-01-01T00:00:00.000Z, tags: ['a', 'b']}
 *
 * //As text, to store in a string column or to send in a header
 * const text: string = MessagePack.stringify({ok: true})
 * console.log(text, MessagePack.parse(text))
 * //gaJva8M= {ok: true}
 * ```
 */
export class MessagePack {
    /**
     * Encode a value as MessagePack bytes (see the class for the values supported).
     * @param value The value to encode.
     * @returns The encoded bytes, in a new `Uint8Array`.
     * @throws {RangeError} When the value contains a `bigint` out of the 64-bit ranges (below `-(2n ** 63n)` or above
     * `2n ** 64n - 1n`).
     * @throws {Error} When the value is or contains a function or a symbol (`Unrecognized object`), a `Map` with a key
     * which is neither a string nor a number, or nests more than 100 levels deep (a circular reference included).
     */
    public static encode(value: any): Uint8Array {
        return encoder.encode(value)
    }

    /**
     * Decode MessagePack bytes into a value. The bytes must hold exactly one encoded value.
     * @param buffer The bytes: a `Uint8Array` (a `Buffer`), another typed array or `DataView`, an `ArrayBuffer`, or an
     * array of byte values.
     * @returns The decoded value: the binary data as a `Uint8Array`, the 64-bit integers as `bigint`.
     * @throws {RangeError} When the bytes are empty or truncated, or when bytes remain after the value.
     * @throws {Error} When a byte is not a MessagePack type (a `DecodeError`).
     */
    public static decode(buffer: ArrayLike<number> | ArrayBufferView | ArrayBufferLike): any {
        return decoder.decode(buffer)
    }

    /**
     * Encode a value as MessagePack, written as a string.
     * @param value The value to encode (see the class for the values supported).
     * @param encoding How the bytes are written: `'base64'` (the default), `'base64url'`, `'hex'`… A text encoding
     * (`'utf8'`) does not keep the bytes: use a binary-to-text one.
     * @returns The encoded value as a string.
     * @throws {RangeError} When the value contains a `bigint` out of the 64-bit ranges.
     * @throws {Error} When the value is or contains a function or a symbol, a `Map` with a key which is neither a string
     * nor a number, or nests more than 100 levels deep.
     */
    public static stringify(value: any, encoding: BufferEncoding = 'base64'): string {
        return Buffer.from(this.encode(value)).toString(encoding)
    }

    /**
     * Decode a string written by `stringify` into a value.
     * @param str The encoded string.
     * @param encoding The encoding the string was written with: `'base64'` (the default) unless `stringify` was given
     * another one. The characters which do not belong to the encoding are skipped by `Buffer`, not rejected.
     * @returns The decoded value.
     * @throws {RangeError} When the string decodes to no bytes, to truncated ones, or to bytes remaining after the
     * value.
     * @throws {Error} When a byte is not a MessagePack type.
     */
    public static parse(str: string, encoding: BufferEncoding = 'base64'): any {
        return this.decode(Buffer.from(str, encoding))
    }
}
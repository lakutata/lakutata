import {Encoder} from './internal/msgpack/Encoder.js'
import {Decoder} from './internal/msgpack/Decoder.js'

/**
 * The encoder and the decoder, reused (a reentrant use creates another one)
 */
const encoder: Encoder = new Encoder()

const decoder: Decoder = new Decoder()

export class MessagePack {
    /**
     * Encode
     * @param value
     */
    public static encode(value: any): Uint8Array {
        return encoder.encode(value)
    }

    /**
     * Decode
     * @param buffer
     */
    public static decode(buffer: ArrayLike<number> | ArrayBufferView | ArrayBufferLike): any {
        return decoder.decode(buffer)
    }

    /**
     * Stringify
     * @param value
     * @param encoding
     */
    public static stringify(value: any, encoding: BufferEncoding = 'base64'): string {
        return Buffer.from(this.encode(value)).toString(encoding)
    }

    /**
     * Parse
     * @param str
     * @param encoding
     */
    public static parse(str: string, encoding: BufferEncoding = 'base64'): any {
        return this.decode(Buffer.from(str, encoding))
    }
}
import {encode, decode} from '@msgpack/msgpack'

export class MessagePack {
    /**
     * Encode
     * @param value
     */
    public static encode(value: any): Uint8Array {
        return encode(value, {useBigInt64: true, ignoreUndefined: true})
    }

    /**
     * Decode
     * @param buffer
     */
    public static decode(buffer: ArrayLike<number> | ArrayBufferView | ArrayBufferLike): any {
        return decode(buffer, {useBigInt64: true})
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
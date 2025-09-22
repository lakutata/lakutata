import {
    v1,
    v3,
    v4,
    v5,
    v6,
    Version1Options as UUIDVersion1Options,
    Version4Options as UUIDVersion4Options,
    Version6Options as UUIDVersion6Options,
    UUIDTypes,
    NIL,
    MAX,
    validate,
    version,
    parse,
    stringify
} from 'uuid'

export {
    type UUIDVersion1Options,
    type UUIDVersion4Options,
    type UUIDVersion6Options,
    type UUIDTypes
}

export class UUID {

    /**
     * The nil UUID string (all zeros).
     */
    public static readonly NIL: string = NIL

    /**
     * The max UUID string (all ones).
     */
    public static readonly MAX: string = MAX

    /**
     * Convert UUID string to array of bytes
     * @param uuid
     * @returns Uint8Array[16]
     * @throws TypeError if str is not a valid UUID
     */
    public static parse(uuid: string): Uint8Array {
        return parse(uuid)
    }

    /**
     * Convert array of bytes to UUID string
     * @param arr
     * @param offset
     * @returns string
     * @throws TypeError if a valid UUID string cannot be generated
     */
    public static stringify(arr: Uint8Array, offset?: number): string {
        return stringify(arr, offset)
    }


    /**
     * Create an RFC version 1 (timestamp) UUID
     * @param options
     * @param buf
     * @param offset
     */
    public static v1(options?: UUIDVersion1Options, buf?: undefined, offset?: number): string
    /**
     * Create an RFC version 1 (timestamp) UUID
     * @param options
     * @param buf
     * @param offset
     */
    public static v1<Buf extends Uint8Array = Uint8Array>(options: UUIDVersion1Options | undefined, buf: Buf, offset?: number): Buf
    public static v1<Buf extends Uint8Array = Uint8Array>(options?: UUIDVersion1Options, buf?: any, offset?: number): any {
        return v1(options, buf, offset)
    }

    /**
     * Create an RFC version 3 (namespace w/ MD5) UUID
     * @param value
     * @param namespace
     * @param buf
     * @param offset
     */
    public static v3(value: string | Uint8Array, namespace: UUIDTypes, buf?: undefined, offset?: number): string
    /**
     * Create an RFC version 3 (namespace w/ MD5) UUID
     * @param value
     * @param namespace
     * @param buf
     * @param offset
     */
    public static v3<TBuf extends Uint8Array = Uint8Array>(value: string | Uint8Array, namespace: UUIDTypes, buf: TBuf, offset?: number): TBuf
    public static v3(value: string | Uint8Array, namespace: UUIDTypes, buf?: any, offset?: number): any {
        return v3(value, namespace, buf, offset)
    }

    /**
     * Create an RFC version 4 (random) UUID
     * @param options
     * @param buf
     * @param offset
     */
    public static v4(options?: UUIDVersion4Options, buf?: undefined, offset?: number): string
    /**
     * Create an RFC version 4 (random) UUID
     * @param options
     * @param buf
     * @param offset
     */
    public static v4<TBuf extends Uint8Array = Uint8Array>(options: UUIDVersion4Options | undefined, buf: TBuf, offset?: number): TBuf
    public static v4(options?: UUIDVersion4Options, buf?: any, offset?: number): any {
        return v4(options, buf, offset)
    }

    /**
     * Create an RFC version 5 (namespace w/ SHA-1) UUID
     * @param value
     * @param namespace
     * @param buf
     * @param offset
     */
    public static v5(value: string | Uint8Array, namespace: UUIDTypes, buf?: undefined, offset?: number): string
    /**
     * Create an RFC version 5 (namespace w/ SHA-1) UUID
     * @param value
     * @param namespace
     * @param buf
     * @param offset
     */
    public static v5<TBuf extends Uint8Array = Uint8Array>(value: string | Uint8Array, namespace: UUIDTypes, buf: TBuf, offset?: number): TBuf
    public static v5(value: string | Uint8Array, namespace: UUIDTypes, buf?: any, offset?: number): any {
        return v5(value, namespace, buf, offset)
    }

    /**
     * Create an RFC version 6 (timestamp, reordered) UUID
     * @param options
     * @param buf
     * @param offset
     */
    public static v6(options?: UUIDVersion6Options, buf?: undefined, offset?: number): string
    /**
     * Create an RFC version 6 (timestamp, reordered) UUID
     * @param options
     * @param buf
     * @param offset
     */
    public static v6<TBuf extends Uint8Array = Uint8Array>(options: UUIDVersion6Options | undefined, buf: TBuf, offset?: number): TBuf
    public static v6(options: UUIDVersion6Options | undefined, buf: any, offset?: number): any {
        return v6(options, buf, offset)
    }

    /**
     * Test a string to see if it is a valid UUID
     * @param uuid
     */
    public static validate(uuid: string): boolean {
        return validate(uuid)
    }

    /**
     * Detect RFC version of a UUID
     * @param uuid
     */
    public static version(uuid: string): number {
        return version(uuid)
    }
}
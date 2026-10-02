import {
    MAX,
    NIL,
    parse,
    stringify,
    v1,
    v3,
    v4,
    v5,
    v6,
    validate,
    version,
    type UUIDTypes,
    type Version1Options as UUIDVersion1Options,
    type Version4Options as UUIDVersion4Options,
    type Version6Options as UUIDVersion6Options
} from './internal/Uuid.js'

export {
    type UUIDVersion1Options,
    type UUIDVersion4Options,
    type UUIDVersion6Options,
    type UUIDTypes
}

/**
 * The UUIDs (the uuid package of 2.x): their generation (v1, v3, v4, v5, v6), parsing, stringifying and validation
 */
export class UUID {

    /**
     * The nil UUID (all zeros)
     */
    public static readonly NIL: string = NIL

    /**
     * The max UUID (all ones)
     */
    public static readonly MAX: string = MAX

    /**
     * The bytes of a UUID
     * @param uuid
     */
    public static parse(uuid: string): Uint8Array {
        return parse(uuid)
    }

    /**
     * The UUID of 16 bytes
     * @param arr
     * @param offset
     */
    public static stringify(arr: Uint8Array, offset?: number): string {
        return stringify(arr, offset)
    }

    /**
     * An RFC version 1 (timestamp) UUID
     */
    public static v1(options?: UUIDVersion1Options, buf?: undefined, offset?: number): string
    public static v1<Buf extends Uint8Array = Uint8Array>(options: UUIDVersion1Options | undefined, buf: Buf, offset?: number): Buf
    public static v1(options?: UUIDVersion1Options, buf?: any, offset?: number): any {
        return v1(options, buf, offset)
    }

    /**
     * An RFC version 3 (namespace w/ MD5) UUID
     */
    public static v3(value: string | Uint8Array, namespace: UUIDTypes, buf?: undefined, offset?: number): string
    public static v3<TBuf extends Uint8Array = Uint8Array>(value: string | Uint8Array, namespace: UUIDTypes, buf: TBuf, offset?: number): TBuf
    public static v3(value: string | Uint8Array, namespace: UUIDTypes, buf?: any, offset?: number): any {
        return v3(value, namespace, buf, offset)
    }

    /**
     * An RFC version 4 (random) UUID
     */
    public static v4(options?: UUIDVersion4Options, buf?: undefined, offset?: number): string
    public static v4<TBuf extends Uint8Array = Uint8Array>(options: UUIDVersion4Options | undefined, buf: TBuf, offset?: number): TBuf
    public static v4(options?: UUIDVersion4Options, buf?: any, offset?: number): any {
        return v4(options, buf, offset)
    }

    /**
     * An RFC version 5 (namespace w/ SHA-1) UUID
     */
    public static v5(value: string | Uint8Array, namespace: UUIDTypes, buf?: undefined, offset?: number): string
    public static v5<TBuf extends Uint8Array = Uint8Array>(value: string | Uint8Array, namespace: UUIDTypes, buf: TBuf, offset?: number): TBuf
    public static v5(value: string | Uint8Array, namespace: UUIDTypes, buf?: any, offset?: number): any {
        return v5(value, namespace, buf, offset)
    }

    /**
     * An RFC version 6 (timestamp, reordered) UUID
     */
    public static v6(options?: UUIDVersion6Options, buf?: undefined, offset?: number): string
    public static v6<TBuf extends Uint8Array = Uint8Array>(options: UUIDVersion6Options | undefined, buf: TBuf, offset?: number): TBuf
    public static v6(options: UUIDVersion6Options | undefined, buf: any, offset?: number): any {
        return v6(options, buf, offset)
    }

    /**
     * Whether a string is a UUID (the nil and max UUIDs included)
     * @param uuid
     */
    public static validate(uuid: string): boolean {
        return validate(uuid)
    }

    /**
     * The version of a UUID (throws for an invalid UUID)
     * @param uuid
     */
    public static version(uuid: string): number {
        return version(uuid)
    }
}

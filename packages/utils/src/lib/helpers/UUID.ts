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
 * Generate, validate and convert UUIDs (RFC 9562), with static methods: `v4()` for random IDs, `v1()` and `v6()` for
 * time-based ones (`v6` sorts by time as a string), `v3()` and `v5()` for the stable ID of a name in a namespace. The
 * UUIDs generated are in lower case.
 * @example
 * ```typescript
 * import {UUID} from 'lakutata/utils'
 *
 * const id: string = UUID.v4()
 * console.log(UUID.validate(id), UUID.version(id))
 * //true 4
 * //The same name in the same namespace always gives the same UUID
 * const DNS: string = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
 * console.log(UUID.v5('example.com', DNS))
 * //cfbff0d1-9375-5685-968c-48ce8b15ae17
 * console.log(UUID.stringify(UUID.parse(DNS)) === DNS)
 * //true
 * ```
 */
export class UUID {

    /**
     * The nil UUID: `'00000000-0000-0000-0000-000000000000'`.
     */
    public static readonly NIL: string = NIL

    /**
     * The max UUID: `'ffffffff-ffff-ffff-ffff-ffffffffffff'`.
     */
    public static readonly MAX: string = MAX

    /**
     * Convert a UUID string into its 16 bytes.
     * @param uuid The UUID, in either case; it must pass `validate()`.
     * @returns A new array of 16 bytes.
     * @throws {TypeError} When `uuid` is not a valid UUID.
     */
    public static parse(uuid: string): Uint8Array {
        return parse(uuid)
    }

    /**
     * Convert 16 bytes into a UUID string, in lower case.
     * @param arr The bytes.
     * @param offset The index of the first of the 16 bytes in `arr`; 0 by default.
     * @returns The UUID string.
     * @throws {TypeError} When the bytes do not make a valid UUID (an unknown version or variant, fewer than 16 bytes
     * after `offset`).
     */
    public static stringify(arr: Uint8Array, offset?: number): string {
        return stringify(arr, offset)
    }

    /**
     * Generate a version 1 UUID: the time (to the 100 nanoseconds), a clock sequence and a node ID. Without options,
     * the UUIDs of a process are unique and in order: a counter separates the ones of the same millisecond, and the
     * node ID and the clock sequence are random bytes kept by the process. It reveals its creation time: prefer `v4`
     * for the IDs shown to the users, `v6` for the IDs sorted by time.
     * @param options The fields of the UUID (see `UUIDVersion1Options`); `undefined` generates them.
     * @param buf Omitted: the UUID is returned as a string. Given: the 16 bytes are written into it, and it is
     * returned.
     * @param offset The index in `buf` of the first byte written; 0 by default.
     * @returns The UUID string, or `buf` when given.
     * @throws {RangeError} When the 16 bytes do not fit in `buf` after `offset`.
     */
    public static v1(options?: UUIDVersion1Options, buf?: undefined, offset?: number): string
    public static v1<Buf extends Uint8Array = Uint8Array>(options: UUIDVersion1Options | undefined, buf: Buf, offset?: number): Buf
    public static v1(options?: UUIDVersion1Options, buf?: any, offset?: number): any {
        return v1(options, buf, offset)
    }

    /**
     * Generate a version 3 UUID: the MD5 hash of a name in a namespace. The same name in the same namespace always
     * gives the same UUID, which makes a stable ID of a name (a URL, a domain, a key of another system). Prefer `v5`,
     * unless a system expects version 3.
     * @param value The name: a string (hashed as UTF-8) or bytes.
     * @param namespace The namespace's UUID, a string or 16 bytes: one of the RFC (DNS
     * `'6ba7b810-9dad-11d1-80b4-00c04fd430c8'`, URL `'6ba7b811-9dad-11d1-80b4-00c04fd430c8'`) or a UUID of the
     * application.
     * @param buf Omitted: the UUID is returned as a string. Given: the 16 bytes are written into it, and it is
     * returned.
     * @param offset The index in `buf` of the first byte written; 0 by default.
     * @returns The UUID string, or `buf` when given.
     * @throws {TypeError} When `namespace` is not a valid UUID string, or not 16 bytes.
     * @throws {RangeError} When the 16 bytes do not fit in `buf` after `offset` (nothing is written).
     */
    public static v3(value: string | Uint8Array, namespace: UUIDTypes, buf?: undefined, offset?: number): string
    public static v3<TBuf extends Uint8Array = Uint8Array>(value: string | Uint8Array, namespace: UUIDTypes, buf: TBuf, offset?: number): TBuf
    public static v3(value: string | Uint8Array, namespace: UUIDTypes, buf?: any, offset?: number): any {
        return v3(value, namespace, buf, offset)
    }

    /**
     * Generate a version 4 UUID: 122 random bits, from the cryptographic random generator (`crypto.randomUUID()`
     * without arguments).
     * @param options The source of the random bytes (see `UUIDVersion4Options`), not changed; `undefined` for the
     * default one.
     * @param buf Omitted: the UUID is returned as a string. Given: the 16 bytes are written into it, and it is
     * returned.
     * @param offset The index in `buf` of the first byte written; 0 by default.
     * @returns The UUID string, or `buf` when given.
     * @throws {RangeError} When the 16 bytes do not fit in `buf` after `offset`.
     * @throws {Error} When `options.random` or the bytes of `options.rng` are fewer than 16.
     */
    public static v4(options?: UUIDVersion4Options, buf?: undefined, offset?: number): string
    public static v4<TBuf extends Uint8Array = Uint8Array>(options: UUIDVersion4Options | undefined, buf: TBuf, offset?: number): TBuf
    public static v4(options?: UUIDVersion4Options, buf?: any, offset?: number): any {
        return v4(options, buf, offset)
    }

    /**
     * Generate a version 5 UUID: the SHA-1 hash of a name in a namespace. The same name in the same namespace always
     * gives the same UUID, which makes a stable ID of a name (a URL, a domain, a key of another system).
     * @param value The name: a string (hashed as UTF-8) or bytes.
     * @param namespace The namespace's UUID, a string or 16 bytes: one of the RFC (DNS
     * `'6ba7b810-9dad-11d1-80b4-00c04fd430c8'`, URL `'6ba7b811-9dad-11d1-80b4-00c04fd430c8'`) or a UUID of the
     * application.
     * @param buf Omitted: the UUID is returned as a string. Given: the 16 bytes are written into it, and it is
     * returned.
     * @param offset The index in `buf` of the first byte written; 0 by default.
     * @returns The UUID string, or `buf` when given.
     * @throws {TypeError} When `namespace` is not a valid UUID string, or not 16 bytes.
     * @throws {RangeError} When the 16 bytes do not fit in `buf` after `offset` (nothing is written).
     */
    public static v5(value: string | Uint8Array, namespace: UUIDTypes, buf?: undefined, offset?: number): string
    public static v5<TBuf extends Uint8Array = Uint8Array>(value: string | Uint8Array, namespace: UUIDTypes, buf: TBuf, offset?: number): TBuf
    public static v5(value: string | Uint8Array, namespace: UUIDTypes, buf?: any, offset?: number): any {
        return v5(value, namespace, buf, offset)
    }

    /**
     * Generate a version 6 UUID: the fields of a version 1 UUID reordered, the time first, so that the UUIDs sort by
     * their creation time as strings and as bytes. Without options, the node ID and the clock sequence are random at
     * each call.
     * @param options The fields of the UUID (see `UUIDVersion6Options`); `undefined` generates them.
     * @param buf Omitted: the UUID is returned as a string. Given: the 16 bytes are written into it, and it is
     * returned.
     * @param offset The index in `buf` of the first byte written; 0 by default.
     * @returns The UUID string, or `buf` when given.
     * @throws {RangeError} When the 16 bytes do not fit in `buf` after `offset` (nothing is written).
     */
    public static v6(options?: UUIDVersion6Options, buf?: undefined, offset?: number): string
    public static v6<TBuf extends Uint8Array = Uint8Array>(options: UUIDVersion6Options | undefined, buf: TBuf, offset?: number): TBuf
    public static v6(options: UUIDVersion6Options | undefined, buf: any, offset?: number): any {
        return v6(options, buf, offset)
    }

    /**
     * Tell whether a string is a UUID: the `8-4-4-4-12` hexadecimal form, in either case, of the versions 1 to 8 and
     * the RFC variant, or the nil and max UUIDs. The braces and the `urn:uuid:` prefix are not accepted.
     * @param uuid The string to test.
     * @returns `true` when it is a UUID.
     */
    public static validate(uuid: string): boolean {
        return validate(uuid)
    }

    /**
     * Get the version of a UUID: 1 to 8, 0 for the nil UUID and 15 for the max UUID.
     * @param uuid The UUID.
     * @returns Its version.
     * @throws {TypeError} When `uuid` is not a valid UUID.
     */
    public static version(uuid: string): number {
        return version(uuid)
    }
}

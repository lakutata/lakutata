import {createHash, randomFillSync, randomUUID} from 'node:crypto'

/**
 * Derived from dist-node of uuid 13.0.0 (MIT, see THIRD_PARTY_NOTICES.md): the UUIDs of 2.x (v1, v3, v4, v5, v6, their
 * parsing, stringifying and validation); v4 does not change the random bytes given, and v3, v5 and v6 check the buffer
 * before writing into it
 */

/**
 * A UUID, as its string (`'6ba7b810-9dad-11d1-80b4-00c04fd430c8'`) or as its 16 bytes.
 */
export type UUIDTypes<TBuf extends Uint8Array = Uint8Array> = string | TBuf

/**
 * The options of a version 1 (time-based) UUID. Without options, the UUIDs of the process share a state: the
 * timestamp is the current time, a counter keeps the UUIDs created in the same millisecond unique and ordered, and the
 * node and clock sequence are random, drawn once. Given any option, the UUID is built from the options alone: the
 * missing time is the current one, the missing node and clock sequence come from the random bytes, and two UUIDs
 * created with the same options in the same millisecond may be equal.
 */
export type Version1Options = {
    /**
     * The node ID, its first 6 bytes (traditionally a MAC address).
     * @default 6 random bytes
     */
    node?: Uint8Array
    /**
     * The clock sequence, an integer from `0` to `0x3fff` (14 bits); a greater value overwrites the variant bits.
     * @default random
     */
    clockseq?: number
    /**
     * 16 random bytes (or more, fewer make the generation throw an `Error`), used for the node and the clock sequence
     * when they are not given; it takes precedence over `rng`.
     * @default bytes from the cryptographic random generator of Node.js
     */
    random?: Uint8Array
    /**
     * A function returning 16 random bytes (or more), called when `random` is not given.
     * @default the cryptographic random generator of Node.js
     */
    rng?: () => Uint8Array
    /**
     * The time of the UUID, in milliseconds since the Unix epoch.
     * @default Date.now()
     */
    msecs?: number
    /**
     * The 100-nanosecond intervals added to `msecs`, an integer from `0` to `9999`.
     * @default 0
     */
    nsecs?: number
    /**
     * Internal: set by the version 6 generation, to draw a new node and clock sequence for each UUID. Do not set it.
     */
    _v6?: boolean
}

/**
 * The options of a version 4 (random) UUID. Without options, the UUID comes from `crypto.randomUUID()`.
 */
export type Version4Options = {
    /**
     * 16 random bytes (or more, fewer make the generation throw an `Error`) making the UUID, with its version and
     * variant bits set (in a copy: the array is not changed); it takes precedence over `rng`.
     * @default bytes from the cryptographic random generator of Node.js
     */
    random?: Uint8Array
    /**
     * A function returning 16 random bytes (or more), called when `random` is not given.
     * @default the cryptographic random generator of Node.js
     */
    rng?: () => Uint8Array
}

/**
 * The options of a version 6 UUID (version 1 with its timestamp ordered for sorting), the same as {@link
 * Version1Options}. Unless given, the node and the clock sequence are random for each UUID.
 */
export type Version6Options = Version1Options

export const NIL: string = '00000000-0000-0000-0000-000000000000'

export const MAX: string = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

const REGEX: RegExp = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i

const BYTE_TO_HEX: string[] = Array.from({length: 256}, (_: unknown, i: number): string => (i + 0x100).toString(16).slice(1))

/**
 * The random bytes: 16 bytes of a pool filled at once
 */
const RANDOM_POOL: Uint8Array = new Uint8Array(256)
let poolPointer: number = RANDOM_POOL.length

function rng(): Uint8Array {
    if (poolPointer > RANDOM_POOL.length - 16) {
        randomFillSync(RANDOM_POOL)
        poolPointer = 0
    }
    return RANDOM_POOL.slice(poolPointer, (poolPointer += 16))
}

export function validate(uuid: unknown): boolean {
    return typeof uuid === 'string' && REGEX.test(uuid)
}

export function version(uuid: string): number {
    if (!validate(uuid)) throw TypeError('Invalid UUID')
    return parseInt(uuid.slice(14, 15), 16)
}

export function parse(uuid: string): Uint8Array {
    if (!validate(uuid)) throw TypeError('Invalid UUID')
    let v: number
    return Uint8Array.of(
        (v = parseInt(uuid.slice(0, 8), 16)) >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff,
        (v = parseInt(uuid.slice(9, 13), 16)) >>> 8, v & 0xff,
        (v = parseInt(uuid.slice(14, 18), 16)) >>> 8, v & 0xff,
        (v = parseInt(uuid.slice(19, 23), 16)) >>> 8, v & 0xff,
        ((v = parseInt(uuid.slice(24, 36), 16)) / 0x10000000000) & 0xff, (v / 0x100000000) & 0xff, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff
    )
}

/**
 * The UUID of 16 bytes, not validated
 * @param arr
 * @param offset
 */
function unsafeStringify(arr: ArrayLike<number>, offset: number = 0): string {
    const hex = (index: number): string => BYTE_TO_HEX[arr[offset + index]]
    return (hex(0) + hex(1) + hex(2) + hex(3) + '-' + hex(4) + hex(5) + '-' + hex(6) + hex(7) + '-' + hex(8) + hex(9) + '-' + hex(10) + hex(11) + hex(12) + hex(13) + hex(14) + hex(15)).toLowerCase()
}

export function stringify(arr: ArrayLike<number>, offset: number = 0): string {
    const uuid: string = unsafeStringify(arr, offset)
    if (!validate(uuid)) throw TypeError('Stringified UUID is invalid')
    return uuid
}

/**
 * The state of the v1 UUIDs: their time, their nanoseconds, their node and their clock sequence
 */
type V1State = { msecs?: number, nsecs?: number, node?: Uint8Array, clockseq?: number }

const V1_STATE: V1State = {}

function updateV1State(state: V1State, now: number, rnds: Uint8Array): V1State {
    state.msecs ??= -Infinity
    state.nsecs ??= 0
    if (now === state.msecs) {
        state.nsecs++
        if (state.nsecs >= 10000) {
            state.node = undefined
            state.nsecs = 0
        }
    } else if (now > state.msecs) {
        state.nsecs = 0
    } else if (now < state.msecs) {
        state.node = undefined
    }
    if (!state.node) {
        state.node = rnds.slice(10, 16)
        state.node[0] |= 0x01
        state.clockseq = ((rnds[8] << 8) | rnds[9]) & 0x3fff
    }
    state.msecs = now
    return state
}

function v1Bytes(rnds: Uint8Array, msecs?: number, nsecs?: number, clockseq?: number, node?: Uint8Array, buf?: Uint8Array, offset: number = 0): Uint8Array {
    if (rnds.length < 16) throw new Error('Random bytes length must be >= 16')
    if (!buf) {
        buf = new Uint8Array(16)
        offset = 0
    } else if (offset < 0 || offset + 16 > buf.length) {
        throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`)
    }
    msecs ??= Date.now()
    nsecs ??= 0
    clockseq ??= ((rnds[8] << 8) | rnds[9]) & 0x3fff
    node ??= rnds.slice(10, 16)
    msecs += 12219292800000
    const tl: number = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000
    buf[offset++] = (tl >>> 24) & 0xff
    buf[offset++] = (tl >>> 16) & 0xff
    buf[offset++] = (tl >>> 8) & 0xff
    buf[offset++] = tl & 0xff
    const tmh: number = ((msecs / 0x100000000) * 10000) & 0xfffffff
    buf[offset++] = (tmh >>> 8) & 0xff
    buf[offset++] = tmh & 0xff
    buf[offset++] = ((tmh >>> 24) & 0xf) | 0x10
    buf[offset++] = (tmh >>> 16) & 0xff
    buf[offset++] = (clockseq >>> 8) | 0x80
    buf[offset++] = clockseq & 0xff
    for (let n: number = 0; n < 6; ++n) buf[offset++] = node[n]
    return buf
}

export function v1(options?: Version1Options, buf?: Uint8Array, offset?: number): any {
    let bytes: Uint8Array
    const isV6: boolean = options?._v6 ?? false
    if (options) {
        const keys: string[] = Object.keys(options)
        if (keys.length === 1 && keys[0] === '_v6') options = undefined
    }
    if (options) {
        bytes = v1Bytes(options.random ?? options.rng?.() ?? rng(), options.msecs, options.nsecs, options.clockseq, options.node, buf, offset)
    } else {
        const now: number = Date.now()
        const rnds: Uint8Array = rng()
        updateV1State(V1_STATE, now, rnds)
        bytes = v1Bytes(rnds, V1_STATE.msecs, V1_STATE.nsecs, isV6 ? undefined : V1_STATE.clockseq, isV6 ? undefined : V1_STATE.node, buf, offset)
    }
    return buf ?? unsafeStringify(bytes)
}

/**
 * The bytes of a string (UTF-8)
 * @param str
 */
function stringToBytes(str: string): Uint8Array {
    str = unescape(encodeURIComponent(str))
    const bytes: Uint8Array = new Uint8Array(str.length)
    for (let i: number = 0; i < str.length; ++i) bytes[i] = str.charCodeAt(i)
    return bytes
}

function hashFunction(algorithm: 'md5' | 'sha1'): (bytes: Uint8Array) => Uint8Array {
    return (bytes: Uint8Array): Uint8Array => createHash(algorithm).update(bytes).digest()
}

function v35(version: number, hash: (bytes: Uint8Array) => Uint8Array, value: string | Uint8Array, namespace: UUIDTypes, buf?: Uint8Array, offset?: number): any {
    const valueBytes: Uint8Array = typeof value === 'string' ? stringToBytes(value) : value
    const namespaceBytes: Uint8Array = typeof namespace === 'string' ? parse(namespace) : namespace
    if (typeof namespace === 'string') namespace = parse(namespace)
    if (namespace?.length !== 16) throw TypeError('Namespace must be array-like (16 iterable integer values, 0-255)')
    let bytes: Uint8Array = new Uint8Array(16 + valueBytes.length)
    bytes.set(namespaceBytes)
    bytes.set(valueBytes, namespaceBytes.length)
    bytes = hash(bytes)
    bytes[6] = (bytes[6] & 0x0f) | version
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    if (buf) {
        offset = offset || 0
        //Checked before writing (the upstream writes the bytes which fit)
        if (offset < 0 || offset + 16 > buf.length) throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`)
        for (let i: number = 0; i < 16; ++i) buf[offset + i] = bytes[i]
        return buf
    }
    return unsafeStringify(bytes)
}

export function v3(value: string | Uint8Array, namespace: UUIDTypes, buf?: Uint8Array, offset?: number): any {
    return v35(0x30, hashFunction('md5'), value, namespace, buf, offset)
}

export function v5(value: string | Uint8Array, namespace: UUIDTypes, buf?: Uint8Array, offset?: number): any {
    return v35(0x50, hashFunction('sha1'), value, namespace, buf, offset)
}

export function v4(options?: Version4Options, buf?: Uint8Array, offset?: number): any {
    if (!buf && !options) return randomUUID()
    options = options || {}
    const source: Uint8Array = options.random ?? options.rng?.() ?? rng()
    if (source.length < 16) throw new Error('Random bytes length must be >= 16')
    //A copy: the bytes of the caller are not changed (the upstream sets their version and variant bits)
    const rnds: Uint8Array = source.slice(0, 16)
    rnds[6] = (rnds[6] & 0x0f) | 0x40
    rnds[8] = (rnds[8] & 0x3f) | 0x80
    if (buf) {
        offset = offset || 0
        if (offset < 0 || offset + 16 > buf.length) throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`)
        for (let i: number = 0; i < 16; ++i) buf[offset + i] = rnds[i]
        return buf
    }
    return unsafeStringify(rnds)
}

/**
 * The bytes of a v6 UUID of the bytes of a v1 UUID
 * @param b
 */
function v1ToV6(b: Uint8Array): Uint8Array {
    return Uint8Array.of(
        ((b[6] & 0x0f) << 4) | ((b[7] >> 4) & 0x0f), ((b[7] & 0x0f) << 4) | ((b[4] & 0xf0) >> 4), ((b[4] & 0x0f) << 4) | ((b[5] & 0xf0) >> 4),
        ((b[5] & 0x0f) << 4) | ((b[0] & 0xf0) >> 4), ((b[0] & 0x0f) << 4) | ((b[1] & 0xf0) >> 4), ((b[1] & 0x0f) << 4) | ((b[2] & 0xf0) >> 4),
        0x60 | (b[2] & 0x0f), b[3], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

export function v6(options?: Version6Options, buf?: Uint8Array, offset?: number): any {
    options ??= {}
    offset ??= 0
    let bytes: Uint8Array = v1({...options, _v6: true}, new Uint8Array(16))
    bytes = v1ToV6(bytes)
    if (buf) {
        //Checked before writing (the upstream writes the bytes which fit)
        if (offset < 0 || offset + 16 > buf.length) throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`)
        for (let i: number = 0; i < 16; i++) buf[offset + i] = bytes[i]
        return buf
    }
    return unsafeStringify(bytes)
}

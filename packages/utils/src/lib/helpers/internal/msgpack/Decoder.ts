/**
 * Derived from src/Decoder.ts and src/CachedKeyDecoder.ts of @msgpack/msgpack 3.1.3 (ISC, see THIRD_PARTY_NOTICES.md),
 * with the options of MessagePack: the int 64 are decoded as bigints (useBigInt64), the other options are the defaults
 * (one value, synchronously)
 */
import {DecodeError, DecodeTimestamp, EXT_TIMESTAMP, ExtData} from './Extension.js'
import {Utf8Decode, Utf8DecodeJs} from './Utf8.js'

type MapKey = string | number

type StackState = {
    type: 'array' | 'map_key' | 'map_value' | undefined
    size: number
    array: unknown[] | undefined
    position: number
    readCount: number
    map: Record<string, unknown> | undefined
    key: MapKey | null
}

const HEAD_BYTE_REQUIRED: number = -1

const MORE_DATA: RangeError = new RangeError('Insufficient data')

const MAX_KEY_LENGTH: number = 16

const MAX_LENGTH_PER_KEY: number = 16

/**
 * The cache of the decoded keys of the maps (up to 16 bytes, 16 by length), shared by the decoders
 */
const keyCaches: { bytes: Uint8Array, value: string }[][] = Array.from({length: MAX_KEY_LENGTH}, (): { bytes: Uint8Array, value: string }[] => [])

/**
 * Decode a key of a map, with the cache
 * @param bytes
 * @param inputOffset
 * @param byteLength
 */
function DecodeKey(bytes: Uint8Array, inputOffset: number, byteLength: number): string {
    const records: { bytes: Uint8Array, value: string }[] = keyCaches[byteLength - 1]
    FIND: for (const record of records) {
        for (let j: number = 0; j < byteLength; j++) if (record.bytes[j] !== bytes[inputOffset + j]) continue FIND
        return record.value
    }
    const value: string = Utf8DecodeJs(bytes, inputOffset, byteLength)
    //A copy of the bytes, the input may be reused
    const record: { bytes: Uint8Array, value: string } = {bytes: Uint8Array.prototype.slice.call(bytes, inputOffset, inputOffset + byteLength), value: value}
    if (records.length >= MAX_LENGTH_PER_KEY) {
        records[(Math.random() * records.length) | 0] = record
    } else {
        records.push(record)
    }
    return value
}

/**
 * The bytes of an input
 * @param buffer
 */
function ToUint8Array(buffer: ArrayLike<number> | ArrayBufferView | ArrayBufferLike): Uint8Array {
    if (buffer instanceof Uint8Array) return buffer
    if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    if (buffer instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer)) return new Uint8Array(buffer)
    return Uint8Array.from(buffer as ArrayLike<number>)
}

export class Decoder {

    #pos: number = 0

    #view: DataView = new DataView(new ArrayBuffer(0))

    #bytes: Uint8Array = new Uint8Array(0)

    #headByte: number = HEAD_BYTE_REQUIRED

    //The states of the arrays and the maps being decoded, reused
    readonly #stack: StackState[] = []

    #stackHead: number = -1

    //A decoding in progress: a reentrant decoding uses another decoder
    #entered: boolean = false

    /**
     * Decode a value
     * @param buffer
     */
    public decode(buffer: ArrayLike<number> | ArrayBufferView | ArrayBufferLike): unknown {
        if (this.#entered) return new Decoder().decode(buffer)
        try {
            this.#entered = true
            this.#headByte = HEAD_BYTE_REQUIRED
            this.#stack.length = 0
            this.#stackHead = -1
            const bytes: Uint8Array = ToUint8Array(buffer)
            this.#bytes = bytes
            this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            this.#pos = 0
            const value: unknown = this.decodeValue()
            if (this.#view.byteLength - this.#pos >= 1) {
                throw new RangeError(`Extra ${this.#view.byteLength - this.#pos} of ${this.#view.byteLength} byte(s) found at buffer[${this.#pos}]`)
            }
            return value
        } finally {
            this.#entered = false
        }
    }

    protected pushState(type: 'array' | 'map_key', size: number): void {
        this.#stackHead++
        if (this.#stackHead === this.#stack.length) {
            this.#stack.push({type: undefined, size: 0, array: undefined, position: 0, readCount: 0, map: undefined, key: null})
        }
        const state: StackState = this.#stack[this.#stackHead]
        state.type = type
        state.size = size
        if (type === 'array') {
            state.position = 0
            state.array = new Array(size)
        } else {
            state.readCount = 0
            state.map = {}
        }
    }

    protected releaseState(state: StackState): void {
        state.size = 0
        state.array = undefined
        state.map = undefined
        state.position = 0
        state.readCount = 0
        state.type = undefined
        this.#stackHead--
    }

    protected decodeValue(): unknown {
        DECODE: while (true) {
            const headByte: number = this.readHeadByte()
            let value: unknown
            if (headByte >= 0xe0) {
                //negative fixint
                value = headByte - 0x100
            } else if (headByte < 0xc0) {
                if (headByte < 0x80) {
                    //positive fixint
                    value = headByte
                } else if (headByte < 0x90) {
                    //fixmap
                    const size: number = headByte - 0x80
                    if (size !== 0) {
                        this.pushState('map_key', size)
                        this.#headByte = HEAD_BYTE_REQUIRED
                        continue
                    }
                    value = {}
                } else if (headByte < 0xa0) {
                    //fixarray
                    const size: number = headByte - 0x90
                    if (size !== 0) {
                        this.pushState('array', size)
                        this.#headByte = HEAD_BYTE_REQUIRED
                        continue
                    }
                    value = []
                } else {
                    //fixstr
                    value = this.decodeString(headByte - 0xa0, 0)
                }
            } else {
                switch (headByte) {
                    case 0xc0:
                        value = null
                        break
                    case 0xc2:
                        value = false
                        break
                    case 0xc3:
                        value = true
                        break
                    case 0xca:
                        value = this.#view.getFloat32(this.#pos)
                        this.#pos += 4
                        break
                    case 0xcb:
                        value = this.#view.getFloat64(this.#pos)
                        this.#pos += 8
                        break
                    case 0xcc:
                        value = this.readU8()
                        break
                    case 0xcd:
                        value = this.readU16()
                        break
                    case 0xce:
                        value = this.readU32()
                        break
                    case 0xcf:
                        value = this.#view.getBigUint64(this.#pos)
                        this.#pos += 8
                        break
                    case 0xd0:
                        value = this.#view.getInt8(this.#pos)
                        this.#pos++
                        break
                    case 0xd1:
                        value = this.#view.getInt16(this.#pos)
                        this.#pos += 2
                        break
                    case 0xd2:
                        value = this.#view.getInt32(this.#pos)
                        this.#pos += 4
                        break
                    case 0xd3:
                        value = this.#view.getBigInt64(this.#pos)
                        this.#pos += 8
                        break
                    case 0xd9:
                        value = this.decodeString(this.#view.getUint8(this.#pos), 1)
                        break
                    case 0xda:
                        value = this.decodeString(this.#view.getUint16(this.#pos), 2)
                        break
                    case 0xdb:
                        value = this.decodeString(this.#view.getUint32(this.#pos), 4)
                        break
                    case 0xdc:
                    case 0xdd: {
                        const size: number = headByte === 0xdc ? this.readU16() : this.readU32()
                        if (size !== 0) {
                            this.pushState('array', size)
                            this.#headByte = HEAD_BYTE_REQUIRED
                            continue DECODE
                        }
                        value = []
                        break
                    }
                    case 0xde:
                    case 0xdf: {
                        const size: number = headByte === 0xde ? this.readU16() : this.readU32()
                        if (size !== 0) {
                            this.pushState('map_key', size)
                            this.#headByte = HEAD_BYTE_REQUIRED
                            continue DECODE
                        }
                        value = {}
                        break
                    }
                    case 0xc4:
                        value = this.decodeBinary(this.#view.getUint8(this.#pos), 1)
                        break
                    case 0xc5:
                        value = this.decodeBinary(this.#view.getUint16(this.#pos), 2)
                        break
                    case 0xc6:
                        value = this.decodeBinary(this.#view.getUint32(this.#pos), 4)
                        break
                    case 0xd4:
                        value = this.decodeExtension(1, 0)
                        break
                    case 0xd5:
                        value = this.decodeExtension(2, 0)
                        break
                    case 0xd6:
                        value = this.decodeExtension(4, 0)
                        break
                    case 0xd7:
                        value = this.decodeExtension(8, 0)
                        break
                    case 0xd8:
                        value = this.decodeExtension(16, 0)
                        break
                    case 0xc7:
                        value = this.decodeExtension(this.#view.getUint8(this.#pos), 1)
                        break
                    case 0xc8:
                        value = this.decodeExtension(this.#view.getUint16(this.#pos), 2)
                        break
                    case 0xc9:
                        value = this.decodeExtension(this.#view.getUint32(this.#pos), 4)
                        break
                    default:
                        throw new DecodeError(`Unrecognized type byte: ${headByte < 0 ? '-' : ''}0x${Math.abs(headByte).toString(16).padStart(2, '0')}`)
                }
            }
            this.#headByte = HEAD_BYTE_REQUIRED
            //The value completes the arrays and the maps
            while (this.#stackHead >= 0) {
                const state: StackState = this.#stack[this.#stackHead]
                if (state.type === 'array') {
                    state.array![state.position++] = value
                    if (state.position !== state.size) continue DECODE
                    value = state.array
                    this.releaseState(state)
                } else if (state.type === 'map_key') {
                    if (value === '__proto__') throw new DecodeError('The key __proto__ is not allowed')
                    if (typeof value !== 'string' && typeof value !== 'number') throw new DecodeError('The type of key must be string or number but ' + typeof value)
                    state.key = value
                    state.type = 'map_value'
                    continue DECODE
                } else {
                    state.map![state.key!] = value
                    if (++state.readCount !== state.size) {
                        state.key = null
                        state.type = 'map_key'
                        continue DECODE
                    }
                    value = state.map
                    this.releaseState(state)
                }
            }
            return value
        }
    }

    protected readHeadByte(): number {
        if (this.#headByte === HEAD_BYTE_REQUIRED) this.#headByte = this.readU8()
        return this.#headByte
    }

    protected isMapKey(): boolean {
        return this.#stackHead >= 0 && this.#stack[this.#stackHead].type === 'map_key'
    }

    protected decodeString(byteLength: number, headerOffset: number): string {
        if (this.#bytes.byteLength < this.#pos + headerOffset + byteLength) throw MORE_DATA
        const offset: number = this.#pos + headerOffset
        const value: string = this.isMapKey() && byteLength > 0 && byteLength <= MAX_KEY_LENGTH
            ? DecodeKey(this.#bytes, offset, byteLength)
            : Utf8Decode(this.#bytes, offset, byteLength)
        this.#pos += headerOffset + byteLength
        return value
    }

    protected decodeBinary(byteLength: number, headerOffset: number): Uint8Array {
        if (this.#view.byteLength - this.#pos < byteLength + headerOffset) throw MORE_DATA
        const offset: number = this.#pos + headerOffset
        const value: Uint8Array = this.#bytes.subarray(offset, offset + byteLength)
        this.#pos += headerOffset + byteLength
        return value
    }

    protected decodeExtension(size: number, headerOffset: number): unknown {
        const type: number = this.#view.getInt8(this.#pos + headerOffset)
        const data: Uint8Array = this.decodeBinary(size, headerOffset + 1)
        //The extension types not decoded are kept as ExtData
        return type === EXT_TIMESTAMP ? DecodeTimestamp(data) : new ExtData(type, data)
    }

    protected readU8(): number {
        const value: number = this.#view.getUint8(this.#pos)
        this.#pos++
        return value
    }

    protected readU16(): number {
        const value: number = this.#view.getUint16(this.#pos)
        this.#pos += 2
        return value
    }

    protected readU32(): number {
        const value: number = this.#view.getUint32(this.#pos)
        this.#pos += 4
        return value
    }
}

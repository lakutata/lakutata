/**
 * Derived from src/Encoder.ts of @msgpack/msgpack 3.1.3 (ISC, see THIRD_PARTY_NOTICES.md), with the options of
 * MessagePack: the bigints are encoded as int 64 (useBigInt64), the properties of undefined value are ignored
 * (ignoreUndefined), the dates are timestamps, the other options are the defaults
 */
import {EncodeTimestamp, EXT_TIMESTAMP, ExtData} from './Extension.js'
import {Utf8Count, Utf8Encode} from './Utf8.js'

const MAX_DEPTH: number = 100

const INITIAL_BUFFER_SIZE: number = 2048

export class Encoder {

    #pos: number = 0

    #view: DataView<ArrayBuffer> = new DataView(new ArrayBuffer(INITIAL_BUFFER_SIZE))

    #bytes: Uint8Array<ArrayBuffer> = new Uint8Array(this.#view.buffer)

    //An encoding in progress: a reentrant encoding uses another encoder
    #entered: boolean = false

    /**
     * Encode a value, the bytes are a copy
     * @param value
     */
    public encode(value: unknown): Uint8Array<ArrayBuffer> {
        if (this.#entered) return new Encoder().encode(value)
        try {
            this.#entered = true
            this.#pos = 0
            this.encodeValue(value, 1)
            return this.#bytes.slice(0, this.#pos)
        } finally {
            this.#entered = false
        }
    }

    protected encodeValue(value: unknown, depth: number): void {
        if (depth > MAX_DEPTH) throw new Error(`Too deep objects in depth ${depth}`)
        if (value == null) {
            this.writeU8(0xc0)
        } else if (typeof value === 'boolean') {
            this.writeU8(value ? 0xc3 : 0xc2)
        } else if (typeof value === 'number') {
            this.encodeNumber(value)
        } else if (typeof value === 'string') {
            this.encodeString(value)
        } else if (typeof value === 'bigint') {
            this.encodeBigInt64(value)
        } else {
            this.encodeObject(value, depth)
        }
    }

    protected ensureBufferSizeToWrite(sizeToWrite: number): void {
        const requiredSize: number = this.#pos + sizeToWrite
        if (this.#view.byteLength < requiredSize) {
            const buffer: ArrayBuffer = new ArrayBuffer(requiredSize * 2)
            const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(buffer)
            bytes.set(this.#bytes)
            this.#view = new DataView(buffer)
            this.#bytes = bytes
        }
    }

    protected encodeNumber(value: number): void {
        if (Number.isSafeInteger(value)) {
            if (value >= 0) {
                if (value < 0x80) {
                    //positive fixint
                    this.writeU8(value)
                } else if (value < 0x100) {
                    this.writeU8(0xcc)
                    this.writeU8(value)
                } else if (value < 0x10000) {
                    this.writeU8(0xcd)
                    this.writeU16(value)
                } else if (value < 0x100000000) {
                    this.writeU8(0xce)
                    this.writeU32(value)
                } else {
                    //With the bigints as int 64, the numbers of 64 bits are floats
                    this.encodeFloat(value)
                }
            } else if (value >= -0x20) {
                //negative fixint
                this.writeU8(0xe0 | (value + 0x20))
            } else if (value >= -0x80) {
                this.writeU8(0xd0)
                this.writeI8(value)
            } else if (value >= -0x8000) {
                this.writeU8(0xd1)
                this.writeI16(value)
            } else if (value >= -0x80000000) {
                this.writeU8(0xd2)
                this.writeI32(value)
            } else {
                this.encodeFloat(value)
            }
        } else {
            this.encodeFloat(value)
        }
    }

    protected encodeFloat(value: number): void {
        //float 64
        this.writeU8(0xcb)
        this.ensureBufferSizeToWrite(8)
        this.#view.setFloat64(this.#pos, value)
        this.#pos += 8
    }

    protected encodeBigInt64(value: bigint): void {
        this.ensureBufferSizeToWrite(9)
        if (value >= BigInt(0)) {
            //uint 64
            this.#view.setUint8(this.#pos, 0xcf)
            this.#view.setBigUint64(this.#pos + 1, value)
        } else {
            //int 64
            this.#view.setUint8(this.#pos, 0xd3)
            this.#view.setBigInt64(this.#pos + 1, value)
        }
        this.#pos += 9
    }

    protected writeStringHeader(byteLength: number): void {
        if (byteLength < 32) {
            //fixstr
            this.writeU8(0xa0 + byteLength)
        } else if (byteLength < 0x100) {
            this.writeU8(0xd9)
            this.writeU8(byteLength)
        } else if (byteLength < 0x10000) {
            this.writeU8(0xda)
            this.writeU16(byteLength)
        } else if (byteLength < 0x100000000) {
            this.writeU8(0xdb)
            this.writeU32(byteLength)
        } else {
            throw new Error(`Too long string: ${byteLength} bytes in UTF-8`)
        }
    }

    protected encodeString(value: string): void {
        const byteLength: number = Utf8Count(value)
        //The maximum size of the header
        this.ensureBufferSizeToWrite(5 + byteLength)
        this.writeStringHeader(byteLength)
        Utf8Encode(value, this.#bytes, this.#pos)
        this.#pos += byteLength
    }

    protected encodeObject(value: unknown, depth: number): void {
        if (value instanceof Date) {
            this.encodeExtension(new ExtData(EXT_TIMESTAMP, EncodeTimestamp(value)))
        } else if (value instanceof ExtData) {
            this.encodeExtension(value)
        } else if (Array.isArray(value)) {
            this.encodeArray(value, depth)
        } else if (ArrayBuffer.isView(value)) {
            this.encodeBinary(value)
        } else if (typeof value === 'object') {
            this.encodeMap(value as Record<string, unknown>, depth)
        } else {
            //symbol, function and the other special objects
            throw new Error(`Unrecognized object: ${Object.prototype.toString.apply(value)}`)
        }
    }

    protected encodeBinary(value: ArrayBufferView): void {
        const size: number = value.byteLength
        if (size < 0x100) {
            this.writeU8(0xc4)
            this.writeU8(size)
        } else if (size < 0x10000) {
            this.writeU8(0xc5)
            this.writeU16(size)
        } else if (size < 0x100000000) {
            this.writeU8(0xc6)
            this.writeU32(size)
        } else {
            throw new Error(`Too large binary: ${size}`)
        }
        this.writeU8a(value instanceof Uint8Array ? value : new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    }

    protected encodeArray(value: unknown[], depth: number): void {
        const size: number = value.length
        if (size < 16) {
            //fixarray
            this.writeU8(0x90 + size)
        } else if (size < 0x10000) {
            this.writeU8(0xdc)
            this.writeU16(size)
        } else if (size < 0x100000000) {
            this.writeU8(0xdd)
            this.writeU32(size)
        } else {
            throw new Error(`Too large array: ${size}`)
        }
        for (const item of value) this.encodeValue(item, depth + 1)
    }

    protected encodeMap(value: Record<string, unknown>, depth: number): void {
        const keys: string[] = Object.keys(value)
        //The properties of undefined value are ignored
        let size: number = 0
        for (const key of keys) if (value[key] !== undefined) size++
        if (size < 16) {
            //fixmap
            this.writeU8(0x80 + size)
        } else if (size < 0x10000) {
            this.writeU8(0xde)
            this.writeU16(size)
        } else if (size < 0x100000000) {
            this.writeU8(0xdf)
            this.writeU32(size)
        } else {
            throw new Error(`Too large map object: ${size}`)
        }
        for (const key of keys) {
            const item: unknown = value[key]
            if (item === undefined) continue
            this.encodeString(key)
            this.encodeValue(item, depth + 1)
        }
    }

    protected encodeExtension(extension: ExtData): void {
        if (typeof extension.data === 'function') {
            const data: Uint8Array = extension.data(this.#pos + 6)
            if (data.length >= 0x100000000) throw new Error(`Too large extension object: ${data.length}`)
            this.writeU8(0xc9)
            this.writeU32(data.length)
            this.writeI8(extension.type)
            this.writeU8a(data)
            return
        }
        const size: number = extension.data.length
        if (size === 1) {
            this.writeU8(0xd4)
        } else if (size === 2) {
            this.writeU8(0xd5)
        } else if (size === 4) {
            this.writeU8(0xd6)
        } else if (size === 8) {
            this.writeU8(0xd7)
        } else if (size === 16) {
            this.writeU8(0xd8)
        } else if (size < 0x100) {
            this.writeU8(0xc7)
            this.writeU8(size)
        } else if (size < 0x10000) {
            this.writeU8(0xc8)
            this.writeU16(size)
        } else if (size < 0x100000000) {
            this.writeU8(0xc9)
            this.writeU32(size)
        } else {
            throw new Error(`Too large extension object: ${size}`)
        }
        this.writeI8(extension.type)
        this.writeU8a(extension.data)
    }

    protected writeU8(value: number): void {
        this.ensureBufferSizeToWrite(1)
        this.#view.setUint8(this.#pos, value)
        this.#pos++
    }

    protected writeU8a(values: ArrayLike<number>): void {
        this.ensureBufferSizeToWrite(values.length)
        this.#bytes.set(values, this.#pos)
        this.#pos += values.length
    }

    protected writeI8(value: number): void {
        this.ensureBufferSizeToWrite(1)
        this.#view.setInt8(this.#pos, value)
        this.#pos++
    }

    protected writeU16(value: number): void {
        this.ensureBufferSizeToWrite(2)
        this.#view.setUint16(this.#pos, value)
        this.#pos += 2
    }

    protected writeI16(value: number): void {
        this.ensureBufferSizeToWrite(2)
        this.#view.setInt16(this.#pos, value)
        this.#pos += 2
    }

    protected writeU32(value: number): void {
        this.ensureBufferSizeToWrite(4)
        this.#view.setUint32(this.#pos, value)
        this.#pos += 4
    }

    protected writeI32(value: number): void {
        this.ensureBufferSizeToWrite(4)
        this.#view.setInt32(this.#pos, value)
        this.#pos += 4
    }
}

/**
 * Derived from src/utils/utf8.ts of @msgpack/msgpack 3.1.3 (ISC, see THIRD_PARTY_NOTICES.md)
 */
import {TextDecoder, TextEncoder} from 'node:util'

const sharedTextEncoder: TextEncoder = new TextEncoder()

const sharedTextDecoder: TextDecoder = new TextDecoder()

/**
 * The strings longer than this are encoded by TextEncoder (faster for the long strings)
 */
const TEXT_ENCODER_THRESHOLD: number = 50

/**
 * The strings longer than this (in bytes) are decoded by TextDecoder
 */
const TEXT_DECODER_THRESHOLD: number = 200

const CHUNK_SIZE: number = 0x1_000

/**
 * The number of bytes of a string in UTF-8
 * @param string
 * @constructor
 */
export function Utf8Count(string: string): number {
    const length: number = string.length
    let byteLength: number = 0
    let pos: number = 0
    while (pos < length) {
        let value: number = string.charCodeAt(pos++)
        if ((value & 0xffffff80) === 0) {
            byteLength++
            continue
        } else if ((value & 0xfffff800) === 0) {
            byteLength += 2
        } else {
            //A surrogate pair
            if (value >= 0xd800 && value <= 0xdbff && pos < length) {
                const extra: number = string.charCodeAt(pos)
                if ((extra & 0xfc00) === 0xdc00) {
                    ++pos
                    value = ((value & 0x3ff) << 10) + (extra & 0x3ff) + 0x10000
                }
            }
            byteLength += (value & 0xffff0000) === 0 ? 3 : 4
        }
    }
    return byteLength
}

/**
 * Encode a string in UTF-8 into bytes
 * @param string
 * @param output
 * @param outputOffset
 */
function Utf8EncodeJs(string: string, output: Uint8Array, outputOffset: number): void {
    const length: number = string.length
    let offset: number = outputOffset
    let pos: number = 0
    while (pos < length) {
        let value: number = string.charCodeAt(pos++)
        if ((value & 0xffffff80) === 0) {
            output[offset++] = value
            continue
        } else if ((value & 0xfffff800) === 0) {
            output[offset++] = ((value >> 6) & 0x1f) | 0xc0
        } else {
            if (value >= 0xd800 && value <= 0xdbff && pos < length) {
                const extra: number = string.charCodeAt(pos)
                if ((extra & 0xfc00) === 0xdc00) {
                    ++pos
                    value = ((value & 0x3ff) << 10) + (extra & 0x3ff) + 0x10000
                }
            }
            if ((value & 0xffff0000) === 0) {
                output[offset++] = ((value >> 12) & 0x0f) | 0xe0
                output[offset++] = ((value >> 6) & 0x3f) | 0x80
            } else {
                output[offset++] = ((value >> 18) & 0x07) | 0xf0
                output[offset++] = ((value >> 12) & 0x3f) | 0x80
                output[offset++] = ((value >> 6) & 0x3f) | 0x80
            }
        }
        output[offset++] = (value & 0x3f) | 0x80
    }
}

/**
 * Encode a string in UTF-8 into bytes
 * @param string
 * @param output
 * @param outputOffset
 * @constructor
 */
export function Utf8Encode(string: string, output: Uint8Array, outputOffset: number): void {
    if (string.length > TEXT_ENCODER_THRESHOLD) {
        sharedTextEncoder.encodeInto(string, output.subarray(outputOffset))
    } else {
        Utf8EncodeJs(string, output, outputOffset)
    }
}

/**
 * Decode UTF-8 bytes
 * @param bytes
 * @param inputOffset
 * @param byteLength
 * @constructor
 */
export function Utf8DecodeJs(bytes: Uint8Array, inputOffset: number, byteLength: number): string {
    let offset: number = inputOffset
    const end: number = offset + byteLength
    const units: number[] = []
    let result: string = ''
    while (offset < end) {
        const byte1: number = bytes[offset++]
        if ((byte1 & 0x80) === 0) {
            units.push(byte1)
        } else if ((byte1 & 0xe0) === 0xc0) {
            const byte2: number = bytes[offset++] & 0x3f
            units.push(((byte1 & 0x1f) << 6) | byte2)
        } else if ((byte1 & 0xf0) === 0xe0) {
            const byte2: number = bytes[offset++] & 0x3f
            const byte3: number = bytes[offset++] & 0x3f
            units.push(((byte1 & 0x1f) << 12) | (byte2 << 6) | byte3)
        } else if ((byte1 & 0xf8) === 0xf0) {
            const byte2: number = bytes[offset++] & 0x3f
            const byte3: number = bytes[offset++] & 0x3f
            const byte4: number = bytes[offset++] & 0x3f
            let unit: number = ((byte1 & 0x07) << 0x12) | (byte2 << 0x0c) | (byte3 << 0x06) | byte4
            if (unit > 0xffff) {
                unit -= 0x10000
                units.push(((unit >>> 10) & 0x3ff) | 0xd800)
                unit = 0xdc00 | (unit & 0x3ff)
            }
            units.push(unit)
        } else {
            units.push(byte1)
        }
        if (units.length >= CHUNK_SIZE) {
            result += String.fromCharCode(...units)
            units.length = 0
        }
    }
    if (units.length > 0) result += String.fromCharCode(...units)
    return result
}

/**
 * Decode UTF-8 bytes
 * @param bytes
 * @param inputOffset
 * @param byteLength
 * @constructor
 */
export function Utf8Decode(bytes: Uint8Array, inputOffset: number, byteLength: number): string {
    if (byteLength > TEXT_DECODER_THRESHOLD) return sharedTextDecoder.decode(bytes.subarray(inputOffset, inputOffset + byteLength))
    return Utf8DecodeJs(bytes, inputOffset, byteLength)
}

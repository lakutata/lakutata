/**
 * Derived from src/ExtData.ts, src/DecodeError.ts, src/timestamp.ts and src/utils/int.ts of @msgpack/msgpack 3.1.3
 * (ISC, see THIRD_PARTY_NOTICES.md): the extension types not decoded are kept as ExtData, the dates are the
 * timestamp extension (-1)
 */

/**
 * The data of an extension type which is not decoded (it is encoded again as it is)
 */
export class ExtData {
    constructor(readonly type: number, readonly data: Uint8Array | ((pos: number) => Uint8Array)) {
    }
}

/**
 * An error of the decoding
 */
export class DecodeError extends Error {
    constructor(message: string) {
        super(message)
        Object.defineProperty(this, 'name', {configurable: true, enumerable: false, value: 'DecodeError'})
    }
}

export const EXT_TIMESTAMP: number = -1

const TIMESTAMP32_MAX_SEC: number = 0x100000000 - 1

const TIMESTAMP64_MAX_SEC: number = 0x400000000 - 1

/**
 * Write a signed integer of 53 bits as an int 64
 * @param view
 * @param offset
 * @param value
 * @constructor
 */
export function SetInt64(view: DataView, offset: number, value: number): void {
    view.setUint32(offset, Math.floor(value / 0x1_0000_0000))
    //The high bits are truncated by DataView
    view.setUint32(offset + 4, value)
}

/**
 * Read an int 64 as a number
 * @param view
 * @param offset
 * @constructor
 */
export function GetInt64(view: DataView, offset: number): number {
    return view.getInt32(offset) * 0x1_0000_0000 + view.getUint32(offset + 4)
}

/**
 * Encode a date as a timestamp (32, 64 or 96 bits)
 * @param date
 * @constructor
 */
export function EncodeTimestamp(date: Date): Uint8Array {
    const milliseconds: number = date.getTime()
    let sec: number = Math.floor(milliseconds / 1e3)
    let nsec: number = (milliseconds - sec * 1e3) * 1e6
    //The nanoseconds are unsigned
    const nsecInSec: number = Math.floor(nsec / 1e9)
    sec += nsecInSec
    nsec -= nsecInSec * 1e9
    if (sec >= 0 && nsec >= 0 && sec <= TIMESTAMP64_MAX_SEC) {
        if (nsec === 0 && sec <= TIMESTAMP32_MAX_SEC) {
            //timestamp 32 = {sec32 (unsigned)}
            const bytes: Uint8Array = new Uint8Array(4)
            new DataView(bytes.buffer).setUint32(0, sec)
            return bytes
        }
        //timestamp 64 = {nsec30 (unsigned), sec34 (unsigned)}
        const bytes: Uint8Array = new Uint8Array(8)
        const view: DataView = new DataView(bytes.buffer)
        view.setUint32(0, (nsec << 2) | ((sec / 0x100000000) & 0x3))
        view.setUint32(4, sec & 0xffffffff)
        return bytes
    }
    //timestamp 96 = {nsec32 (unsigned), sec64 (signed)}
    const bytes: Uint8Array = new Uint8Array(12)
    const view: DataView = new DataView(bytes.buffer)
    view.setUint32(0, nsec)
    SetInt64(view, 4, sec)
    return bytes
}

/**
 * Decode a timestamp as a date
 * @param data
 * @constructor
 */
export function DecodeTimestamp(data: Uint8Array): Date {
    const view: DataView = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let sec: number
    let nsec: number
    switch (data.byteLength) {
        case 4:
            sec = view.getUint32(0)
            nsec = 0
            break
        case 8: {
            const nsec30AndSecHigh2: number = view.getUint32(0)
            sec = (nsec30AndSecHigh2 & 0x3) * 0x100000000 + view.getUint32(4)
            nsec = nsec30AndSecHigh2 >>> 2
            break
        }
        case 12:
            sec = GetInt64(view, 4)
            nsec = view.getUint32(0)
            break
        default:
            throw new DecodeError(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${data.length}`)
    }
    return new Date(sec * 1e3 + nsec / 1e6)
}

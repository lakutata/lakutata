import {writeIEEE754} from '../base/internal/IEEE754.js'

/**
 * IEEE754 number to hex
 * @param ieee754Number
 * @param bits
 * @constructor
 */
export function IEEE754ToHex(ieee754Number: number, bits: 32 | 64 = 32): string {
    const buffer: Buffer = Buffer.alloc(bits / 8)
    writeIEEE754(buffer, ieee754Number, 0, false, buffer.length === 4 ? 23 : 52, buffer.length)
    return buffer.toString('hex').toUpperCase()
}

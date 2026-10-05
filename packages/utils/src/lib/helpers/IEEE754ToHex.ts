import {writeIEEE754} from './internal/IEEE754.js'

/**
 * Write a number as an IEEE 754 floating-point number in big-endian hexadecimal, in upper case and without prefix: 8
 * digits in single precision, 16 in double precision.
 * @param ieee754Number The number to write. In single precision it is rounded to the nearest float (`0.1` gives
 * `3DCCCCCD`), and a value beyond its range gives `±Infinity` (`7F800000`). `NaN` is written as the canonical quiet NaN,
 * `7FC00000` (32 bits) or `7FF8000000000000` (64 bits), and `-0` keeps its sign (`80000000`).
 * @param bits The precision: `32` (single, the default) or `64` (double).
 * @returns The hexadecimal string.
 * @example
 * ```typescript
 * import {ieee754ToHex} from 'lakutata/utils'
 *
 * console.log(ieee754ToHex(1), ieee754ToHex(1, 64), ieee754ToHex(-2.5))
 * //3F800000 3FF0000000000000 C0200000
 * ```
 */
export function ieee754ToHex(ieee754Number: number, bits: 32 | 64 = 32): string {
    //The canonical quiet NaN, as the runtime writes it
    if (Number.isNaN(ieee754Number)) return bits === 64 ? '7FF8000000000000' : '7FC00000'
    const buffer: Buffer = Buffer.alloc(bits / 8)
    writeIEEE754(buffer, ieee754Number, 0, false, buffer.length === 4 ? 23 : 52, buffer.length)
    return buffer.toString('hex').toUpperCase()
}

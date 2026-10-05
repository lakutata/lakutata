import {readIEEE754} from './internal/IEEE754.js'

/**
 * Read a hexadecimal string as an IEEE 754 floating-point number, big-endian: 8 digits (4 bytes) as a single precision
 * (32-bit) number, 16 digits (8 bytes) as a double precision (64-bit) number.
 * @param hex The hexadecimal digits, in either case, with or without a `0x`/`0X` prefix (`'3F800000'`,
 * `'0x3FF0000000000000'`).
 * @returns The number, `NaN` and `±Infinity` included.
 * @throws {SyntaxError} When `hex` has a character which is not a hexadecimal digit.
 * @throws {RangeError} When `hex` does not have 8 or 16 digits.
 * @example
 * ```typescript
 * import {hexToIEEE754} from 'lakutata/utils'
 *
 * console.log(hexToIEEE754('3F800000'), hexToIEEE754('40490FDB'), hexToIEEE754('0x3FF0000000000000'))
 * //1 3.1415927410125732 1
 * ```
 */
export function hexToIEEE754(hex: string): number {
    const digits: string = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
    if (!/^[0-9a-fA-F]*$/.test(digits)) throw new SyntaxError(`Invalid hexadecimal string: "${hex}"`)
    if (digits.length !== 8 && digits.length !== 16) throw new RangeError(`An IEEE 754 number has 8 or 16 hexadecimal digits, "${hex}" has ${digits.length}`)
    const buffer: Buffer = Buffer.from(digits, 'hex')
    //64 bits, a double; 32 bits, a float
    return buffer.length === 8 ? readIEEE754(buffer, 0, false, 52, 8) : readIEEE754(buffer, 0, false, 23, 4)
}

/**
 * Read a hexadecimal string as an unsigned integer (big-endian: the first digit is the most significant).
 * @param hex The hexadecimal digits, in either case, with or without a `0x`/`0X` prefix (`'FF'`, `'0x00ff'`).
 * @returns The unsigned value, from `0` to `Number.MAX_SAFE_INTEGER`.
 * @throws {SyntaxError} When `hex` has no digit (`''`, `'0x'`) or a character which is not a hexadecimal digit (a sign,
 * a space, `'0x1g'`).
 * @throws {RangeError} When the value is above `Number.MAX_SAFE_INTEGER` (`'20000000000000'` and more): it would lose
 * its precision as a `number`.
 * @example
 * ```typescript
 * import {HexToUnsigned} from 'lakutata/utils'
 *
 * console.log(HexToUnsigned('FF'), HexToUnsigned('0x0100'), HexToUnsigned('FFFFFFFF'))
 * //255 256 4294967295
 * ```
 */
export function HexToUnsigned(hex: string): number {
    const digits: string = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
    if (!/^[0-9a-fA-F]+$/.test(digits)) throw new SyntaxError(`Invalid hexadecimal string: "${hex}"`)
    const unsignedNumber: bigint = BigInt(`0x${digits}`)
    if (unsignedNumber > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`The value of "${hex}" is above Number.MAX_SAFE_INTEGER`)
    return Number(unsignedNumber)
}

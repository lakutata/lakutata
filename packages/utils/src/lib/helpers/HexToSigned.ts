/**
 * Read a hexadecimal string as a signed integer in two's complement, its width given by its number of digits (4 bits
 * each): `'FF'` is the 8-bit `-1`, `'00FF'` the 16-bit `255`, `'8000'` the 16-bit `-32768`. Pad the string with zeros
 * to the width of the value read.
 * @param hex The hexadecimal digits, in either case. A `0x`/`0X` prefix is accepted and does not change the width
 * (`'0x00FF'` gives `255`, as `'00FF'` does).
 * @returns The signed value.
 * @throws {SyntaxError} When `hex` has no digit (`''`, `'0x'`) or a character which is not a hexadecimal digit (a sign,
 * a space, `'0x1g'`).
 * @throws {RangeError} When the value is beyond `Number.MAX_SAFE_INTEGER` in magnitude: it would lose its precision as a
 * `number`.
 * @example
 * ```typescript
 * import {HexToSigned} from 'lakutata/utils'
 *
 * console.log(HexToSigned('7F'), HexToSigned('80'), HexToSigned('FFFF'), HexToSigned('00FF'), HexToSigned('0x00FF'))
 * //127 -128 -1 255 255
 * ```
 */
export function HexToSigned(hex: string): number {
    const digits: string = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
    if (!/^[0-9a-fA-F]+$/.test(digits)) throw new SyntaxError(`Invalid hexadecimal string: "${hex}"`)
    const signedNumber: bigint = BigInt.asIntN(digits.length * 4, BigInt(`0x${digits}`))
    if (signedNumber > BigInt(Number.MAX_SAFE_INTEGER) || signedNumber < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new RangeError(`The value of "${hex}" is beyond Number.MAX_SAFE_INTEGER in magnitude`)
    }
    return Number(signedNumber)
}

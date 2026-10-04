/**
 * Write a non-negative integer as hexadecimal, uppercase, padded with zeros to `bits / 4` digits, without prefix
 * (`255` on 16 bits is `'00FF'`). The reverse of `HexToUnsigned`.
 * @param unsignedNumber The integer, from 0 to `2^bits - 1`. Beyond `Number.MAX_SAFE_INTEGER` the number has already
 * lost its precision.
 * @param bits The width in bits: 8, 16, 32 (the default), 64 or 128.
 * @returns The uppercase hexadecimal digits, exactly `bits / 4` of them.
 * @throws {RangeError} When `unsignedNumber` is not an integer (a fraction, `NaN`, `Infinity`), is negative, or does
 * not fit in the width (`256` on 8 bits).
 * @example
 * ```typescript
 * import {UnsignedToHex} from 'lakutata/utils'
 *
 * console.log(UnsignedToHex(255, 8), UnsignedToHex(255, 16), UnsignedToHex(48879))
 * //FF 00FF 0000BEEF
 * ```
 */
export function UnsignedToHex(unsignedNumber: number, bits: 8 | 16 | 32 | 64 | 128 = 32): string {
    const value: bigint = BigInt(unsignedNumber)
    if (value < 0n || value >= 2n ** BigInt(bits)) throw new RangeError(`The number ${unsignedNumber} is out of the unsigned ${bits}-bit range`)
    return value.toString(16).toUpperCase().padStart(bits / 4, '0')
}

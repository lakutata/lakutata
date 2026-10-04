/**
 * Write a signed integer as hexadecimal in two's complement, on a given width: `bits / 4` uppercase digits, without
 * prefix (`-1` on 8 bits is `'FF'`, `5` on 16 bits is `'0005'`). The reverse of `HexToSigned`.
 * @param signedNumber The integer, within the width's range (`-2^(bits-1)` to `2^(bits-1) - 1`). Beyond
 * `Number.MAX_SAFE_INTEGER` the number has already lost its precision.
 * @param bits The width in bits: 8, 16, 32 (the default), 64 or 128.
 * @returns The uppercase hexadecimal digits, exactly `bits / 4` of them.
 * @throws {RangeError} When `signedNumber` is not an integer (a fraction, `NaN`, `Infinity`), or is out of the width's
 * range (`128` or `-129` on 8 bits).
 * @example
 * ```typescript
 * import {SignedToHex} from 'lakutata/utils'
 *
 * console.log(SignedToHex(-1, 8), SignedToHex(-128, 8), SignedToHex(5, 16), SignedToHex(-2))
 * //FF 80 0005 FFFFFFFE
 * ```
 */
export function SignedToHex(signedNumber: number, bits: 8 | 16 | 32 | 64 | 128 = 32): string {
    const limit: bigint = 2n ** BigInt(bits - 1)
    if (BigInt(signedNumber) < -limit || BigInt(signedNumber) >= limit) throw new RangeError(`The number ${signedNumber} is out of the signed ${bits}-bit range`)
    const value: string = (BigInt(2) ** BigInt(bits) + BigInt(signedNumber)).toString(16).toUpperCase()
    return signedNumber < 0 ? value : value.slice(1)
}

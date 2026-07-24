/**
 * Signed number to hex
 * @param signedNumber
 * @param bits
 * @constructor
 */
export function SignedToHex(signedNumber: number, bits: 8 | 16 | 32 | 64 | 128 = 32): string {
    const value: string = (BigInt(2) ** BigInt(bits) + BigInt(signedNumber)).toString(16).toUpperCase()
    return signedNumber < 0 ? value : value.slice(1)
}

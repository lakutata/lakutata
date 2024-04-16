/**
 * Hex to signed number
 * @param hex
 * @constructor
 */
export function HexToSigned(hex: string): number {
    if (hex.startsWith('0x') || hex.startsWith('0X')) hex = parseInt(hex, 16).toString(16)
    const bits: number = hex.length * 4
    const signedNumber: bigint = BigInt.asIntN(bits, BigInt(`0x${hex}`))
    return parseInt(signedNumber.toString())
}

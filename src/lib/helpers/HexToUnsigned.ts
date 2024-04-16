/**
 * Hex to unsigned number
 * @param hex
 * @constructor
 */
export function HexToUnsigned(hex: string): number {
    if (hex.startsWith('0x') || hex.startsWith('0X')) hex = parseInt(hex, 16).toString(16)
    const unsignedNumber: bigint = BigInt(`0x${hex}`)
    return parseInt(unsignedNumber.toString())
}

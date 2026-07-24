/**
 * Unsigned number to hex
 * @param unsignedNumber
 * @param bits
 * @constructor
 */
export function UnsignedToHex(unsignedNumber: number, bits: 8 | 16 | 32 | 64 | 128 = 32): string {
    return BigInt(unsignedNumber).toString(16).toUpperCase().padStart(bits / 4, '0')
}

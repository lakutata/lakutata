import {readIEEE754} from '../base/internal/IEEE754.js'

/**
 * Hex to IEEE754 number
 * @param hex
 * @constructor
 */
export function HexToIEEE754(hex: string): number {
    const buffer: Buffer = Buffer.from(hex, 'hex')
    if (buffer.length === 8) {
        //64bits, Double
        return readIEEE754(Buffer.from(hex, 'hex'), 0, false, 52, 8)
    } else {
        //32bits, Float
        return readIEEE754(Buffer.from(hex, 'hex'), 0, false, 23, 4)
    }
}

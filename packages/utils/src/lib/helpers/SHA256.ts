import {createHash} from 'node:crypto'

/**
 * SHA256 Hash
 * @param message
 * @constructor
 */
export function SHA256(message: string): Buffer {
    return createHash('sha256').update(Buffer.from(message)).digest()
}

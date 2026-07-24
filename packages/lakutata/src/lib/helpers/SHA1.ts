import {createHash} from 'node:crypto'

/**
 * SHA1 Hash
 * @param message
 * @constructor
 */
export function SHA1(message: string): Buffer {
    return createHash('sha1').update(Buffer.from(message)).digest()
}

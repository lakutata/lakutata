import {createHash} from 'node:crypto'

/**
 * MD5 Hash
 * @param message
 * @constructor
 */
export function MD5(message: string): Buffer {
    return createHash('md5').update(Buffer.from(message)).digest()
}

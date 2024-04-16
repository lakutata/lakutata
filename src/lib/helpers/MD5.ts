import {MD5 as CryptoJsMD5, enc} from 'crypto-js'
import {createHash, getHashes} from 'node:crypto'

const hasMD5Hash: boolean = getHashes().includes('md5')

/**
 * MD5 Hash
 * @param message
 * @constructor
 */
export function MD5(message: string): Buffer {
    if (hasMD5Hash) return createHash('md5').update(Buffer.from(message)).digest()
    return Buffer.from(CryptoJsMD5(message).toString(enc.Base64), 'base64')
}

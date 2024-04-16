import {SHA1 as CryptoJsSHA1, enc} from 'crypto-js'
import {createHash, getHashes} from 'node:crypto'

const hasSHA1Hash: boolean = getHashes().includes('sha1')

/**
 * SHA1 Hash
 * @param message
 * @constructor
 */
export function SHA1(message: string): Buffer {
    if (hasSHA1Hash) return createHash('sha1').update(Buffer.from(message)).digest()
    return Buffer.from(CryptoJsSHA1(message).toString(enc.Base64), 'base64')
}

import {SHA256 as CryptoJsSHA256, enc} from 'crypto-js'
import {createHash, getHashes} from 'node:crypto'

const hasSHA256Hash: boolean = getHashes().includes('sha256')

/**
 * SHA256 Hash
 * @param message
 * @constructor
 */
export function SHA256(message: string): Buffer {
    if (hasSHA256Hash) return createHash('sha256').update(Buffer.from(message)).digest()
    return Buffer.from(CryptoJsSHA256(message).toString(enc.Base64), 'base64')
}

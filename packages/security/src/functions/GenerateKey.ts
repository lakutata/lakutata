import {randomBytes} from 'node:crypto'

/**
 * Generate a random key (for the signatures and the encryption), base64url encoded
 * @param bytes the number of random bytes (default 32)
 */
export function GenerateKey(bytes: number = 32): string {
    return randomBytes(bytes).toString('base64url')
}

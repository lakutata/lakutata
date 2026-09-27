import {createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt as scryptCallback, type ScryptOptions} from 'node:crypto'
import {DecryptionFailedException} from '../exceptions/DecryptionFailedException.js'

/**
 * The versions of the encrypted data: the key derivation (the cipher is AES-256-GCM)
 */
const KEY_VERSION: number = 1
const PASSWORD_VERSION: number = 2

const SALT_LENGTH: number = 16
const IV_LENGTH: number = 12
const TAG_LENGTH: number = 16
const HEADER_LENGTH: number = 1 + SALT_LENGTH + IV_LENGTH
const KEY_LENGTH: number = 32

/**
 * The scrypt parameters of the password version (about 16 MB and a few tens of milliseconds)
 */
const SCRYPT_OPTIONS: ScryptOptions = {N: 16384, r: 8, p: 1}

/**
 * The key of a message: derived from the key with the salt of the message (HKDF-SHA256)
 * @param key
 * @param salt
 */
function deriveKey(key: string | Uint8Array, salt: Uint8Array): Buffer {
    return Buffer.from(hkdfSync('sha256', key, salt, 'lakutata-encryption', KEY_LENGTH))
}

/**
 * The key of a message: derived from the password with the salt of the message (scrypt)
 * @param password
 * @param salt
 */
function derivePasswordKey(password: string | Uint8Array, salt: Uint8Array): Promise<Buffer> {
    return new Promise((resolve, reject): void => scryptCallback(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error: Error | null, key: Buffer): void => error ? reject(error) : resolve(key)))
}

/**
 * Encrypt with a key: version, salt, iv, tag and ciphertext, base64url encoded
 * @param version
 * @param salt
 * @param key
 * @param data
 */
function seal(version: number, salt: Buffer, key: Buffer, data: string | Uint8Array): string {
    const iv: Buffer = randomBytes(IV_LENGTH)
    const header: Buffer = Buffer.concat([Buffer.from([version]), salt, iv])
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    //The header is authenticated too
    cipher.setAAD(header)
    const ciphertext: Buffer = Buffer.concat([cipher.update(data), cipher.final()])
    return Buffer.concat([header, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

/**
 * The parts of encrypted data (undefined: not encrypted data of the version)
 * @param encrypted
 * @param version
 */
function parts(encrypted: string, version: number): { header: Buffer, salt: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer } | undefined {
    const buffer: Buffer = Buffer.from(encrypted, 'base64url')
    if (buffer.length < HEADER_LENGTH + TAG_LENGTH || buffer[0] !== version) return undefined
    return {
        header: buffer.subarray(0, HEADER_LENGTH),
        salt: buffer.subarray(1, 1 + SALT_LENGTH),
        iv: buffer.subarray(1 + SALT_LENGTH, HEADER_LENGTH),
        tag: buffer.subarray(HEADER_LENGTH, HEADER_LENGTH + TAG_LENGTH),
        ciphertext: buffer.subarray(HEADER_LENGTH + TAG_LENGTH)
    }
}

/**
 * Decrypt the parts with a key (undefined: the key does not decrypt them, or they were changed)
 * @param part
 * @param key
 */
function open(part: { header: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer }, key: Buffer): Buffer | undefined {
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, part.iv)
        decipher.setAAD(part.header)
        decipher.setAuthTag(part.tag)
        return Buffer.concat([decipher.update(part.ciphertext), decipher.final()])
    } catch {
        return undefined
    }
}

/**
 * Encrypt data with a key (AES-256-GCM, with a key derived for the message): the encrypted data is authenticated,
 * base64url encoded
 * @param data
 * @param key
 */
export function EncryptByKey(data: string | Uint8Array, key: string | Uint8Array): string {
    const salt: Buffer = randomBytes(SALT_LENGTH)
    return seal(KEY_VERSION, salt, deriveKey(key, salt), data)
}

/**
 * Decrypt data encrypted by EncryptByKey(), with one of the keys (the keys are tried in order, for key rotation)
 * @param encrypted
 * @param keys
 * @throws DecryptionFailedException when no key decrypts the data, or the data was changed
 */
export function DecryptByKey(encrypted: string, keys: string | Uint8Array | (string | Uint8Array)[]): Buffer {
    const part: ReturnType<typeof parts> = parts(encrypted, KEY_VERSION)
    if (part) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
            const decrypted: Buffer | undefined = open(part, deriveKey(key, part.salt))
            if (decrypted) return decrypted
        }
    }
    throw new DecryptionFailedException('The data cannot be decrypted')
}

/**
 * Encrypt data with a password (AES-256-GCM, with a key derived from the password by scrypt): the encrypted data is
 * authenticated, base64url encoded
 * @param data
 * @param password
 */
export async function EncryptByPassword(data: string | Uint8Array, password: string | Uint8Array): Promise<string> {
    const salt: Buffer = randomBytes(SALT_LENGTH)
    return seal(PASSWORD_VERSION, salt, await derivePasswordKey(password, salt), data)
}

/**
 * Decrypt data encrypted by EncryptByPassword()
 * @param encrypted
 * @param password
 * @throws DecryptionFailedException when the password does not decrypt the data, or the data was changed
 */
export async function DecryptByPassword(encrypted: string, password: string | Uint8Array): Promise<Buffer> {
    const part: ReturnType<typeof parts> = parts(encrypted, PASSWORD_VERSION)
    const decrypted: Buffer | undefined = part ? open(part, await derivePasswordKey(password, part.salt)) : undefined
    if (decrypted) return decrypted
    throw new DecryptionFailedException('The data cannot be decrypted')
}

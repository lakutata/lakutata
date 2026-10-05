import {createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt as scryptCallback, type ScryptOptions} from 'node:crypto'
import {DecryptionFailedException} from '../exceptions/DecryptionFailedException.js'
import {AssertKey} from '../lib/AssertKey.js'

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
 * The key of a message: derived from the key with the salt of the message (HKDF-sha256)
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
 * Encrypt data with a secret key, using AES-256-GCM (authenticated encryption): the output is confidential and
 * tamper-proof. Each call derives a fresh key from the key and a random 16-byte salt (HKDF-sha256) and uses a random
 * 12-byte IV, so encrypting the same data twice gives different outputs. The {@link Crypt} provider does the same with
 * configured keys and key rotation.
 *
 * The key must be random (see {@link generateSecret}): its derivation is fast, so a password used as a key is open to
 * brute force; use {@link encryptByPassword} for passwords. The function refuses an empty key, but does not check
 * the key's length or strength otherwise.
 * @param data The data to encrypt: a string (encrypted as its UTF-8 bytes) or bytes.
 * @param key The secret key: a string (used as its UTF-8 bytes, not decoded from base64) or bytes, not empty; 32
 * random bytes recommended.
 * @returns The encrypted data, base64url encoded without padding: 1 version byte, the salt, the IV, a 16-byte
 * authentication tag and the ciphertext (45 bytes more than the data, before base64url).
 * @throws {RangeError} When the key is empty.
 * @example
 * ```typescript
 * import {decryptByKey, encryptByKey, generateSecret} from 'lakutata/security'
 *
 * const key: string = process.env.CRYPT_KEY ?? generateSecret()
 * const encrypted: string = encryptByKey('card ending 4242', key)
 * console.log(decryptByKey(encrypted, key).toString('utf8'))
 * ```
 */
export function encryptByKey(data: string | Uint8Array, key: string | Uint8Array): string {
    AssertKey(key)
    const salt: Buffer = randomBytes(SALT_LENGTH)
    return seal(KEY_VERSION, salt, deriveKey(key, salt), data)
}

/**
 * Decrypt data encrypted by {@link encryptByKey} (or {@link Crypt.encrypt}) with one of the keys, tried in order: list
 * the current key and the previous ones during a key rotation. The authentication tag is checked before anything is
 * returned, so changed data is never decrypted.
 * @param encrypted The encrypted data, base64url as {@link encryptByKey} returns it.
 * @param keys The key, or the keys to try: strings (used as their UTF-8 bytes) or bytes, none empty.
 * @returns The decrypted bytes (call `.toString('utf8')` for a string).
 * @throws {DecryptionFailedException} When no key decrypts the data, or it was changed, truncated or not produced by
 * {@link encryptByKey} (data encrypted by {@link encryptByPassword} included).
 * @throws {RangeError} When a key is empty.
 * @example
 * ```typescript
 * import {decryptByKey, DecryptionFailedException} from 'lakutata/security'
 *
 * declare const encrypted: string
 * declare const currentKey: string
 * declare const previousKey: string
 *
 * try {
 *     //The new key first, the previous one while old data remains
 *     const secret: string = decryptByKey(encrypted, [currentKey, previousKey]).toString('utf8')
 *     console.log(secret)
 * } catch (error) {
 *     if (error instanceof DecryptionFailedException) console.log('Changed, or encrypted with an unknown key')
 * }
 * ```
 */
export function decryptByKey(encrypted: string, keys: string | Uint8Array | (string | Uint8Array)[]): Buffer {
    const candidates: (string | Uint8Array)[] = Array.isArray(keys) ? keys : [keys]
    candidates.forEach(AssertKey)
    const part: ReturnType<typeof parts> = parts(encrypted, KEY_VERSION)
    if (part) {
        for (const key of candidates) {
            const decrypted: Buffer | undefined = open(part, deriveKey(key, part.salt))
            if (decrypted) return decrypted
        }
    }
    throw new DecryptionFailedException('The data cannot be decrypted')
}

/**
 * Encrypt data with a password chosen by a person, using AES-256-GCM (authenticated encryption) with a key derived
 * from the password and a random 16-byte salt by scrypt (N = 16384, r = 8, p = 1: about 16 MB of memory and a few
 * tens of milliseconds per call, off the main thread). The slow derivation makes guessing the password costly; a
 * strong password still matters. For a random key, {@link encryptByKey} is faster. To check a login password, use
 * {@link PasswordHash} instead.
 * @param data The data to encrypt: a string (encrypted as its UTF-8 bytes) or bytes.
 * @param password The password: a string (used as its UTF-8 bytes) or bytes. Its length is not checked.
 * @returns The encrypted data, base64url encoded without padding, in the format of {@link encryptByKey} with another
 * version byte: the two are not interchangeable.
 * @example
 * ```typescript
 * import {decryptByPassword, encryptByPassword} from 'lakutata/security'
 *
 * const encrypted: string = await encryptByPassword('backup contents', 'a long passphrase of the user')
 * console.log((await decryptByPassword(encrypted, 'a long passphrase of the user')).toString('utf8'))
 * ```
 */
export async function encryptByPassword(data: string | Uint8Array, password: string | Uint8Array): Promise<string> {
    const salt: Buffer = randomBytes(SALT_LENGTH)
    return seal(PASSWORD_VERSION, salt, await derivePasswordKey(password, salt), data)
}

/**
 * Decrypt data encrypted by {@link encryptByPassword}, deriving the key from the password and the salt stored in the
 * data (the same scrypt cost).
 * @param encrypted The encrypted data, base64url as {@link encryptByPassword} returns it.
 * @param password The password it was encrypted with: a string (used as its UTF-8 bytes) or bytes.
 * @returns The decrypted bytes (call `.toString('utf8')` for a string).
 * @throws {DecryptionFailedException} When the password is wrong, or the data was changed, truncated or not produced
 * by {@link encryptByPassword} (data encrypted by {@link encryptByKey} included).
 * @example
 * ```typescript
 * import {decryptByPassword, DecryptionFailedException} from 'lakutata/security'
 *
 * declare const encrypted: string
 * declare const passphrase: string
 *
 * try {
 *     console.log((await decryptByPassword(encrypted, passphrase)).toString('utf8'))
 * } catch (error) {
 *     if (error instanceof DecryptionFailedException) console.log('Wrong passphrase, or changed data')
 * }
 * ```
 */
export async function decryptByPassword(encrypted: string, password: string | Uint8Array): Promise<Buffer> {
    const part: ReturnType<typeof parts> = parts(encrypted, PASSWORD_VERSION)
    const decrypted: Buffer | undefined = part ? open(part, await derivePasswordKey(password, part.salt)) : undefined
    if (decrypted) return decrypted
    throw new DecryptionFailedException('The data cannot be decrypted')
}

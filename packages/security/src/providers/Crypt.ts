import {DTO, Provider} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {DecryptByKey, EncryptByKey} from '../functions/Encryption.js'

/**
 * The encryption provider: encrypts data with AES-256-GCM (authenticated encryption), with key rotation (the first key
 * encrypts, every key decrypts). Use it to keep secrets confidential at rest or through a client: tokens stored in a
 * database, data put in a cookie. The encrypted data is also tamper-proof: changing a byte makes it fail to decrypt.
 * It is not a password hash: a value that only needs to be checked, never read back, belongs to
 * {@link PasswordHash}.
 *
 * Declare it in the `providers` of the application (`{class: Crypt, keys: [...]}`) and get it with `@Inject` or
 * `getObject()`; it is scoped, like every provider. Each encryption derives a fresh key from the configured key and a
 * random salt (HKDF-SHA256) and uses a random IV, so encrypting the same data twice gives different outputs. The output
 * is a base64url string (no padding) of 1 version byte, a 16-byte salt, a 12-byte IV, a 16-byte authentication tag and
 * the ciphertext (45 bytes more than the data, before base64url), the same format as {@link EncryptByKey}.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {Crypt, DecryptionFailedException, GenerateSecret} from 'lakutata/security'
 *
 * Application
 *     .run(() => ({
 *         id: 'vault.app',
 *         name: 'Vault',
 *         providers: {
 *             //The keys come from the environment: the new key first, the previous one kept to decrypt
 *             crypt: {class: Crypt, keys: [process.env.CRYPT_KEY ?? GenerateSecret(), process.env.CRYPT_PREVIOUS_KEY ?? GenerateSecret()]}
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const crypt: Crypt = await app.getObject('crypt')
 *         const encrypted: string = crypt.encrypt('api-token-123')
 *         try {
 *             console.log(crypt.decryptString(encrypted))
 *             console.log(crypt.decrypt(encrypted).length)
 *         } catch (error) {
 *             if (error instanceof DecryptionFailedException) console.log('Changed, or encrypted with an unknown key')
 *         }
 *     })
 * ```
 */
export class Crypt extends Provider {

    /**
     * The secret keys, at least one, each a string of at least 16 characters used as its UTF-8 bytes (it is not decoded
     * from base64). The first key encrypts, every key decrypts: to rotate, put the new key first and keep the previous
     * ones while data encrypted with them is still read. Use random keys, such as the output of {@link GenerateSecret}: the
     * key derivation is fast, so a low-entropy key (a password) is open to brute force; to encrypt with a password, use
     * {@link EncryptByPassword}. Required.
     */
    @Configurable(DTO.Array().items(DTO.String().min(16)).min(1).required())
    public readonly keys: string[]

    /**
     * Encrypt data with the first key.
     * @param data The data to encrypt: a string (encrypted as its UTF-8 bytes) or bytes.
     * @returns The encrypted data, base64url encoded without padding.
     */
    public encrypt(data: string | Uint8Array): string {
        return EncryptByKey(data, this.keys[0])
    }

    /**
     * Decrypt data encrypted by {@link Crypt.encrypt} (or {@link EncryptByKey}) with any of the keys, tried in order.
     * @param encrypted The encrypted data, base64url as {@link Crypt.encrypt} returns it.
     * @returns The decrypted bytes.
     * @throws {DecryptionFailedException} When no key decrypts the data, or it was changed, truncated or not produced by
     * {@link Crypt.encrypt}.
     */
    public decrypt(encrypted: string): Buffer {
        return DecryptByKey(encrypted, this.keys)
    }

    /**
     * Decrypt data encrypted by {@link Crypt.encrypt} with any of the keys, and decode it as a UTF-8 string.
     * @param encrypted The encrypted data, base64url as {@link Crypt.encrypt} returns it.
     * @returns The decrypted string.
     * @throws {DecryptionFailedException} When no key decrypts the data, or it was changed, truncated or not produced by
     * {@link Crypt.encrypt}.
     */
    public decryptString(encrypted: string): string {
        return this.decrypt(encrypted).toString('utf8')
    }
}

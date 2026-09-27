import {DTO, Provider} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {DecryptByKey, EncryptByKey} from '../functions/Encryption.js'

/**
 * The encryption of data (AES-256-GCM, authenticated), with key rotation: the first key encrypts, every key decrypts
 */
export class Crypt extends Provider {

    /**
     * The keys: the first encrypts, all decrypt (put a new key first, and keep the previous ones while data encrypted
     * with them is read)
     */
    @Configurable(DTO.Array().items(DTO.String().min(16)).min(1).required())
    public readonly keys: string[]

    /**
     * Encrypt data (base64url)
     * @param data
     */
    public encrypt(data: string | Uint8Array): string {
        return EncryptByKey(data, this.keys[0])
    }

    /**
     * Decrypt data encrypted with one of the keys
     * @param encrypted
     * @throws DecryptionFailedException when no key decrypts the data, or the data was changed
     */
    public decrypt(encrypted: string): Buffer {
        return DecryptByKey(encrypted, this.keys)
    }

    /**
     * Decrypt a string encrypted with one of the keys (UTF-8)
     * @param encrypted
     * @throws DecryptionFailedException when no key decrypts the data, or the data was changed
     */
    public decryptString(encrypted: string): string {
        return this.decrypt(encrypted).toString('utf8')
    }
}

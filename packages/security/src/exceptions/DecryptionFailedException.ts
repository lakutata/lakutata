import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Crypt.decrypt}, {@link Crypt.decryptString}, {@link DecryptByKey} and {@link DecryptByPassword}
 * when the data cannot be decrypted: a wrong key or password, data changed or truncated, or data not produced by the
 * matching encryption function. The message does not tell these cases apart, on purpose. Its `errno` is
 * `'E_DECRYPTION_FAILED'`; its HTTP status is 500 unless the application handles it.
 */
export class DecryptionFailedException extends Exception {
    /**
     * `'E_DECRYPTION_FAILED'`.
     */
    public errno: string | number = 'E_DECRYPTION_FAILED'
}

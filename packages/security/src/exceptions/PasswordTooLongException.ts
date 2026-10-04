import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link PasswordHash.hash} when the password is longer than 72 bytes once encoded in UTF-8, the most bcrypt
 * reads: hashing only its prefix would let any password sharing those 72 bytes match. Ask the user for a shorter
 * password. Its `errno` is `'E_PASSWORD_TOO_LONG'`; its HTTP status is 500 unless the application handles it.
 */
export class PasswordTooLongException extends Exception {
    /**
     * `'E_PASSWORD_TOO_LONG'`.
     */
    public errno: string | number = 'E_PASSWORD_TOO_LONG'
}

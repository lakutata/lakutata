import {Exception} from '@lakutata/core'

export class DecryptionFailedException extends Exception {
    public errno: string | number = 'E_DECRYPTION_FAILED'
}

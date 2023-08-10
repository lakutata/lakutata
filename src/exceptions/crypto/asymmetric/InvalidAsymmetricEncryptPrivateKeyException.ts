import {Exception} from '../../../lib/base/abstracts/Exception.js'

export class InvalidAsymmetricEncryptPrivateKeyException extends Exception {
    public errno: number | string = 'E_INVALID_ASYMMETRIC_ENCRYPT_PRIVATE_KEY'
}

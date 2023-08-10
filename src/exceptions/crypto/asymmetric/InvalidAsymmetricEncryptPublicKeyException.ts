import {Exception} from '../../../lib/base/abstracts/Exception.js'

export class InvalidAsymmetricEncryptPublicKeyException extends Exception {
    public errno: number | string = 'E_INVALID_ASYMMETRIC_ENCRYPT_PUBLIC_KEY'
}

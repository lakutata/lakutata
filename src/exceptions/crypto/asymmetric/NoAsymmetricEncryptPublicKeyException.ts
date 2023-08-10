import {Exception} from '../../../lib/base/abstracts/Exception.js'

export class NoAsymmetricEncryptPublicKeyException extends Exception {
    public errno: number | string = 'E_NO_ASYMMETRIC_ENCRYPT_PUBLIC_KEY'
}

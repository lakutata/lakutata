import {Exception} from '../../../lib/base/abstracts/Exception'

export class NoAsymmetricEncryptPrivateKeyException extends Exception {
    public errno: number | string = 'E_NO_ASYMMETRIC_ENCRYPT_PRIVATE_KEY'
}

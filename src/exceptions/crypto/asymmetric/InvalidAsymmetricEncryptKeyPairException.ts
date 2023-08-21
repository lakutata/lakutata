import {Exception} from '../../../lib/base/abstracts/Exception'

export class InvalidAsymmetricEncryptKeyPairException extends Exception {
    public errno: number | string = 'E_INVALID_ASYMMETRIC_ENCRYPT_KEY_PAIR'
}

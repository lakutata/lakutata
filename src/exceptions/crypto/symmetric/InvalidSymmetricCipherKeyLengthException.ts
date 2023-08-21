import {Exception} from '../../../lib/base/abstracts/Exception'

export class InvalidSymmetricCipherKeyLengthException extends Exception {
    public errno: number | string = 'E_INVALID_SYMMETRIC_CIPHER_KEY_LENGTH'
}

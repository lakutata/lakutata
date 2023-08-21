import {Exception} from '../../../lib/base/abstracts/Exception'

export class InvalidSymmetricCipherIVLengthException extends Exception {
    public errno: number | string = 'E_INVALID_SYMMETRIC_CIPHER_IV_LENGTH'
}

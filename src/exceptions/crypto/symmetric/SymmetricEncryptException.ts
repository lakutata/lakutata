import {Exception} from '../../../lib/base/abstracts/Exception'

export class SymmetricEncryptException extends Exception {
    public errno: number | string = 'E_SYMMETRIC_ENCRYPT'
}

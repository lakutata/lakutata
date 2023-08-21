import {Exception} from '../../../lib/base/abstracts/Exception'

export class SymmetricDecryptException extends Exception {
    public errno: number | string = 'E_SYMMETRIC_DECRYPT'
}

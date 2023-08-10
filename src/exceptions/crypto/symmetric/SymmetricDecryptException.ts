import {Exception} from '../../../lib/base/abstracts/Exception.js'

export class SymmetricDecryptException extends Exception {
    public errno: number | string = 'E_SYMMETRIC_DECRYPT'
}

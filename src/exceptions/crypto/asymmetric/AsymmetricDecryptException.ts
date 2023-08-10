import {Exception} from '../../../lib/base/abstracts/Exception.js'

export class AsymmetricDecryptException extends Exception {
    public errno: number | string = 'E_ASYMMETRIC_DECRYPT'
}

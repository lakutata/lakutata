import {Exception} from '../../../lib/base/abstracts/Exception.js'

export class AsymmetricSignException extends Exception {
    public errno: number | string = 'E_ASYMMETRIC_SIGN'
}

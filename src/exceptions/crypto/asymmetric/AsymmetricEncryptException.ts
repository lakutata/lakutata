import {Exception} from '../../../lib/base/abstracts/Exception.js'

export class AsymmetricEncryptException extends Exception {
    public errno: number | string = 'E_ASYMMETRIC_ENCRYPT'
}

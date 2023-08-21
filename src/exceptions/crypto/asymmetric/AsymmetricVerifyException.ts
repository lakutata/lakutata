import {Exception} from '../../../lib/base/abstracts/Exception'

export class AsymmetricVerifyException extends Exception {
    public errno: number | string = 'E_ASYMMETRIC_VERIFY'
}

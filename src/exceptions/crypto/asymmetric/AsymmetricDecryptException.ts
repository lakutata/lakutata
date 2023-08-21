import {Exception} from '../../../lib/base/abstracts/Exception'

export class AsymmetricDecryptException extends Exception {
    public errno: number | string = 'E_ASYMMETRIC_DECRYPT'
}

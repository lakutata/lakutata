import {Exception} from '../../../lib/base/abstracts/Exception'

export class NotSupportCipherException extends Exception {
    public errno: number | string = 'E_NOT_SUPPORT_CIPHER'
}

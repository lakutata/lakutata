import {Exception} from '../lib/base/abstracts/Exception.js'

export class NotSupportCipherException extends Exception {
    public errno: number | string = 'E_NOT_SUPPORT_CIPHER'
}

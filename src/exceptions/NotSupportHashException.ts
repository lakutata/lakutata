import {Exception} from '../lib/base/abstracts/Exception'

export class NotSupportHashException extends Exception {
    public errno: number | string = 'E_NOT_SUPPORT_HASH'
}

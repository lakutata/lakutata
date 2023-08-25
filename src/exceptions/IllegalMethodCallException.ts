import {Exception} from '../lib/base/abstracts/Exception'

export class IllegalMethodCallException extends Exception {
    public errno: number | string = 'E_ILLEGAL_METHOD_CALL'
}

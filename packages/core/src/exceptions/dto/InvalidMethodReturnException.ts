import {Exception} from '../../lib/foundation/Exception.js'

export class InvalidMethodReturnException extends Exception {
    public errno: number | string = 'E_INVALID_METHOD_RETURN'
}

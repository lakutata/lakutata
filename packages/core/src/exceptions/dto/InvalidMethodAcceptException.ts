import {Exception} from '../../lib/foundation/Exception.js'

export class InvalidMethodAcceptException extends Exception {
    public errno: number | string = 'E_INVALID_METHOD_ACCEPT'
}

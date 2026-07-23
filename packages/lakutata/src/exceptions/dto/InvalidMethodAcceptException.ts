import {Exception} from '../../lib/base/abstracts/Exception.js'

export class InvalidMethodAcceptException extends Exception {
    public errno: number | string = 'E_INVALID_METHOD_ACCEPT'
}

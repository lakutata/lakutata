import {Exception} from '../../lib/base/abstracts/Exception'

export class InvalidMethodAcceptException extends Exception {
    public errno: number | string = 'E_INVALID_METHOD_ACCEPT'
}

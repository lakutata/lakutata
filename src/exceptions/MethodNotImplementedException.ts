import {Exception} from '../lib/base/abstracts/Exception'

export class MethodNotImplementedException extends Exception {
    public errno: number | string = 'E_METHOD_NOT_IMPLEMENTED'
}

import {Exception} from '../lib/base/abstracts/Exception.js'

export class DynamicRegisterControllerNotAllowException extends Exception {
    public errno: number | string = 'E_DYNAMIC_REGISTER_CONTROLLER_NOT_ALLOW'
}

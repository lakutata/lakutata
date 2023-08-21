import {Exception} from '../../lib/base/abstracts/Exception'

export class DynamicRegisterControllerNotAllowException extends Exception {
    public errno: number | string = 'E_DYNAMIC_REGISTER_CONTROLLER_NOT_ALLOW'
}

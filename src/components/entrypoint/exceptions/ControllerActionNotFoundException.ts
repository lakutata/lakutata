import {Exception} from '../../../lib/base/abstracts/Exception.js'

export class ControllerActionNotFoundException extends Exception {
    public errno: string | number = 'E_CONTROLLER_ACTION_NOT_FOUND'
}

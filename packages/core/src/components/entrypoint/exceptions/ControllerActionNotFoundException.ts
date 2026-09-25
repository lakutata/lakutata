import {Exception} from '../../../lib/foundation/Exception.js'

export class ControllerActionNotFoundException extends Exception {
    public errno: string | number = 'E_CONTROLLER_ACTION_NOT_FOUND'
}

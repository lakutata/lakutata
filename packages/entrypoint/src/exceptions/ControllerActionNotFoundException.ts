import {Exception} from '@lakutata/core'

export class ControllerActionNotFoundException extends Exception {
    public errno: string | number = 'E_CONTROLLER_ACTION_NOT_FOUND'
}

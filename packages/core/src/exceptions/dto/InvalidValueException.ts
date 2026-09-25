import {Exception} from '../../lib/foundation/Exception.js'

export class InvalidValueException extends Exception {
    public errno: string | number = 'E_INVALID_VALUE'
}

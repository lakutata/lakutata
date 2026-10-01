import {Exception} from '../../lib/foundation/Exception.js'

export class InvalidObjectOptionsException extends Exception {
    public errno: string | number = 'E_INVALID_OBJECT_OPTIONS'
}

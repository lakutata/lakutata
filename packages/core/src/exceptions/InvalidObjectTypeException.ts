import {Exception} from '../lib/foundation/Exception.js'

export class InvalidObjectTypeException extends Exception {
    public errno: string | number = 'E_INVALID_OBJECT_TYPE'
}

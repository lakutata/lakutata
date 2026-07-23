import {Exception} from '../lib/base/abstracts/Exception.js'

export class InvalidObjectTypeException extends Exception {
    public errno: string | number = 'E_INVALID_OBJECT_TYPE'
}

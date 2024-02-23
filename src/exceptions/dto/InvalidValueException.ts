import {Exception} from '../../lib/base/abstracts/Exception.js'

export class InvalidValueException extends Exception {
    public errno: string | number = 'E_INVALID_VALUE'
}

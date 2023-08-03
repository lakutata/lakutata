import {Exception} from '../lib/base/abstracts/Exception.js'

export class InvalidValueException extends Exception {
    public errno: number | string = 'E_INVALID_VALUE'
}

import {Exception} from '../../lib/base/abstracts/Exception'

export class InvalidValueException extends Exception {
    public errno: number | string = 'E_INVALID_VALUE'
}

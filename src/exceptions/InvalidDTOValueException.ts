import {Exception} from '../lib/base/abstracts/Exception.js'

export class InvalidDTOValueException extends Exception {
    public errno: number | string = 'E_INVALID_DTO_VALUE'
}

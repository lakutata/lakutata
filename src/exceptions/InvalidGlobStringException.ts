import {Exception} from '../lib/base/abstracts/Exception'

export class InvalidGlobStringException extends Exception {
    public errno: number | string = 'E_INVALID_GLOB_STRING'
}

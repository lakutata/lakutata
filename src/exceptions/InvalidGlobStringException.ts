import {Exception} from '../lib/base/abstracts/Exception.js'

export class InvalidGlobStringException extends Exception {
    public errno: number | string = 'E_INVALID_GLOB_STRING'
}

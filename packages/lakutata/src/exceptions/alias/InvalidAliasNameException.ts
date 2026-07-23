import {Exception} from '../../lib/base/abstracts/Exception.js'

export class InvalidAliasNameException extends Exception {
    public errno: number | string = 'E_INVALID_ALIAS_NAME'
}

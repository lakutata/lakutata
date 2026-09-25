import {Exception} from '../../lib/foundation/Exception.js'

export class InvalidAliasNameException extends Exception {
    public errno: number | string = 'E_INVALID_ALIAS_NAME'
}

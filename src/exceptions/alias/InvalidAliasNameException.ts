import {Exception} from '../../lib/base/abstracts/Exception'

export class InvalidAliasNameException extends Exception {
    public errno: number | string = 'E_INVALID_ALIAS_NAME'
}

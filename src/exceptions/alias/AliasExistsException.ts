import {Exception} from '../../lib/base/abstracts/Exception'

export class AliasExistsException extends Exception {
    public errno: number | string = 'E_ALIAS_EXISTS'
}

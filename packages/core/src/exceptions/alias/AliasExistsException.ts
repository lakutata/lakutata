import {Exception} from '../../lib/foundation/Exception.js'

export class AliasExistsException extends Exception {
    public errno: number | string = 'E_ALIAS_EXISTS'
}

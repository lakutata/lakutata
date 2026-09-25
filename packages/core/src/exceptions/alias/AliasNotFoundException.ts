import {Exception} from '../../lib/foundation/Exception.js'

export class AliasNotFoundException extends Exception {
    public errno: number | string = 'E_ALIAS_NOT_FOUND'
}

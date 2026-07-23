import {Exception} from '../../lib/base/abstracts/Exception.js'

export class AliasNotFoundException extends Exception {
    public errno: number | string = 'E_ALIAS_NOT_FOUND'
}

import {Exception} from '../../lib/foundation/Exception.js'

/**
 * Thrown when a path alias is read (`app.alias.get()`) without being registered. Its errno is
 * `E_ALIAS_NOT_FOUND`.
 */
export class AliasNotFoundException extends Exception {
    public errno: number | string = 'E_ALIAS_NOT_FOUND'
}

import {Exception} from '../../lib/foundation/Exception.js'

/**
 * Thrown when a path alias is registered twice without override (`Application.alias()` declaring an alias
 * already registered, which fails the launch). Its errno is `E_ALIAS_EXISTS`.
 */
export class AliasExistsException extends Exception {
    public errno: number | string = 'E_ALIAS_EXISTS'
}

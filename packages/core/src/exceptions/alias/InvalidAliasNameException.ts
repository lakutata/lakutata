import {Exception} from '../../lib/foundation/Exception.js'

/**
 * Thrown when an alias name is not `@` followed by letters and digits only (`app.alias.set()`, `get()`,
 * `has()`; an alias of `Application.alias()` fails the launch). Its errno is `E_INVALID_ALIAS_NAME`.
 */
export class InvalidAliasNameException extends Exception {
    public errno: number | string = 'E_INVALID_ALIAS_NAME'
}

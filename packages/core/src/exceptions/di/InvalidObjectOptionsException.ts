import {Exception} from '../../lib/foundation/Exception.js'

/**
 * Thrown when a module initializes and an object it declares has an option whose value is invalid for its
 * `@Configurable` property (see the `checkOptions` module option); its message lists every invalid option. It fails
 * the module's initialization. Its errno is `E_INVALID_OBJECT_OPTIONS`.
 */
export class InvalidObjectOptionsException extends Exception {
    public errno: string | number = 'E_INVALID_OBJECT_OPTIONS'
}

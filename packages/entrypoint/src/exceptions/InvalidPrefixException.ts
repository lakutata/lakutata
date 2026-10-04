import {Exception} from '@lakutata/core'

/**
 * A pattern prefix of a controller (`@Prefix`) and the pattern of one of its service actions set the same key to
 * different values, when the entrypoint initializes. Its errno is `E_INVALID_PREFIX`.
 */
export class InvalidPrefixException extends Exception {
    public errno: string | number = 'E_INVALID_PREFIX'
}

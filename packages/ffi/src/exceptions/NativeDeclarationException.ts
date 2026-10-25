import {Exception} from '@lakutata/core'

/**
 * Thrown when C declarations or a function prototype cannot be read: its message gives the line and the column, what
 * was found and what was expected (a type not declared, a construct not supported such as a macro or `long double`).
 * Its `errno` is `'E_NATIVE_DECLARATION'`.
 */
export class NativeDeclarationException extends Exception {
    /**
     * `'E_NATIVE_DECLARATION'`.
     */
    public errno: string | number = 'E_NATIVE_DECLARATION'
}

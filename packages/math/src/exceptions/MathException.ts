import {Exception} from '@lakutata/core'

/**
 * The base of the exceptions of the package: catch it for any of them. Its `errno` is `'E_MATH_INTERNAL'` for an
 * internal error of the addon, the one of the subclass otherwise.
 */
export class MathException extends Exception {
    /**
     * `'E_MATH_INTERNAL'`, or the one of the subclass.
     */
    public errno: string | number = 'E_MATH_INTERNAL'

    /**
     * For the errors in a formula: the index of the character where the error is found.
     */
    public position?: number
}

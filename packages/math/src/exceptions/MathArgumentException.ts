import {MathException} from './MathException.js'

/**
 * An argument that is not valid: an expression with variables where a number is asked, a name that is not a variable, a
 * number of values that does not match. Its `errno` is `'E_MATH_ARGUMENT'`.
 */
export class MathArgumentException extends MathException {
    /**
     * `'E_MATH_ARGUMENT'`.
     */
    public errno: string | number = 'E_MATH_ARGUMENT'
}

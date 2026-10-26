import {MathException} from './MathException.js'

/**
 * A division by zero. Its `errno` is `'E_MATH_DIVISION_BY_ZERO'`.
 */
export class MathDivisionByZeroException extends MathException {
    /**
     * `'E_MATH_DIVISION_BY_ZERO'`.
     */
    public errno: string | number = 'E_MATH_DIVISION_BY_ZERO'
}

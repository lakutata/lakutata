import {MathException} from './MathException.js'

/**
 * Units that do not match: a length added to a time, a conversion between dimensions that differ. Its `errno` is
 * `'E_MATH_UNIT'`.
 */
export class MathUnitException extends MathException {
    /**
     * `'E_MATH_UNIT'`.
     */
    public errno: string | number = 'E_MATH_UNIT'
}

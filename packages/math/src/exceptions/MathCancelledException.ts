import {MathException} from './MathException.js'

/**
 * An asynchronous operation cancelled by its `signal`. Its `errno` is `'E_MATH_CANCELLED'`.
 */
export class MathCancelledException extends MathException {
    /**
     * `'E_MATH_CANCELLED'`.
     */
    public errno: string | number = 'E_MATH_CANCELLED'
}

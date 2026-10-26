import {MathException} from './MathException.js'

/**
 * An asynchronous operation that took longer than its `timeout`. Its `errno` is `'E_MATH_TIMEOUT'`.
 */
export class MathTimeoutException extends MathException {
    /**
     * `'E_MATH_TIMEOUT'`.
     */
    public errno: string | number = 'E_MATH_TIMEOUT'
}

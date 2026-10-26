import {MathException} from './MathException.js'

/**
 * An operation the package does not do, or not for this expression (an integral without elementary form, a function that cannot be compiled). Its `errno` is `'E_MATH_NOT_SUPPORTED'`.
 */
export class MathNotSupportedException extends MathException {
    /**
     * `'E_MATH_NOT_SUPPORTED'`.
     */
    public errno: string | number = 'E_MATH_NOT_SUPPORTED'
}

import {MathException} from './MathException.js'

/**
 * A value is out of the domain of an operation: a complex value where a real number is asked, the logarithm of a negative number in decimals. Its `errno` is `'E_MATH_DOMAIN'`.
 */
export class MathDomainException extends MathException {
    /**
     * `'E_MATH_DOMAIN'`.
     */
    public errno: string | number = 'E_MATH_DOMAIN'
}

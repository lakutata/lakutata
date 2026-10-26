import {MathException} from './MathException.js'

/**
 * A formula is not written correctly: its `position` is the index of the character where the error is found. Its `errno` is `'E_MATH_SYNTAX'`.
 */
export class MathSyntaxException extends MathException {
    /**
     * `'E_MATH_SYNTAX'`.
     */
    public errno: string | number = 'E_MATH_SYNTAX'
}

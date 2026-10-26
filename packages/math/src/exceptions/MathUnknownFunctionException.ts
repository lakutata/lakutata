import {MathException} from './MathException.js'

/**
 * A formula calls a function that is neither one of the formulas nor defined (`foo(x)`): to multiply, write `foo*(x)`. Its `position` is the index of the name. Its `errno` is `'E_MATH_UNKNOWN_FUNCTION'`.
 */
export class MathUnknownFunctionException extends MathException {
    /**
     * `'E_MATH_UNKNOWN_FUNCTION'`.
     */
    public errno: string | number = 'E_MATH_UNKNOWN_FUNCTION'
}

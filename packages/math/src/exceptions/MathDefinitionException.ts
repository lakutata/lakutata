import {MathException} from './MathException.js'

/**
 * A definition of the component (or of `with()`) is not valid: a name already used by the formulas, a parameter given twice, definitions referring to each other in a cycle. Its `errno` is `'E_MATH_DEFINITION'`.
 */
export class MathDefinitionException extends MathException {
    /**
     * `'E_MATH_DEFINITION'`.
     */
    public errno: string | number = 'E_MATH_DEFINITION'
}

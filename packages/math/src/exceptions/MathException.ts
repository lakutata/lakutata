/**
 * The base of the exceptions of the package: catch it for any of them. Its `errno` is `'E_MATH_INTERNAL'` for an
 * internal error of the addon, the one of the subclass otherwise; its `name` is the name of its class.
 */
export class MathException extends Error {
    /**
     * `'E_MATH_INTERNAL'`, or the one of the subclass.
     */
    public errno: string | number = 'E_MATH_INTERNAL'

    /**
     * For the errors in a formula: the index of the character where the error is found.
     */
    public position?: number

    /**
     * An exception of a message.
     * @param message The message.
     */
    constructor(message?: string) {
        super(message)
        this.name = new.target.name
    }
}

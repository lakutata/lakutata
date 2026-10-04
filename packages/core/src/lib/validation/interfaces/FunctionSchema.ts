import {AnySchema} from './AnySchema.js'

/**
 * A schema of functions, built by `DTO.Function()` (and `DTO.AsyncFunction()`, `DTO.Class()`): their number of
 * declared parameters (`length`), or whether they are classes.
 * @typeParam TSchema The type of the functions the schema validates.
 */
export interface FunctionSchema<TSchema = Function> extends AnySchema<TSchema> {
    /**
     * Require an exact number of declared parameters (the `length` of the function).
     * @param n The number of parameters, a non-negative integer.
     * @returns A new schema.
     */
    arity(n: number): this

    /**
     * Require the function to be a class (declared with `class`).
     * @returns A new schema.
     */
    class(): this

    /**
     * Require a minimum number of declared parameters (the `length` of the function).
     * @param n The minimum number of parameters (inclusive), an integer greater than 0.
     * @returns A new schema.
     */
    minArity(n: number): this

    /**
     * Require a maximum number of declared parameters (the `length` of the function).
     * @param n The maximum number of parameters (inclusive), a non-negative integer.
     * @returns A new schema.
     */
    maxArity(n: number): this
}

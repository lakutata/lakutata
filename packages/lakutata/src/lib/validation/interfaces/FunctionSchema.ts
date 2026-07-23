import {AnySchema} from './AnySchema.js'

export interface FunctionSchema<TSchema = Function> extends AnySchema<TSchema> {
    /**
     * Specifies the arity of the function where:
     * @param n - the arity expected.
     */
    arity(n: number): this;

    /**
     * Requires the function to be a class.
     */
    class(): this;

    /**
     * Specifies the minimal arity of the function where:
     * @param n - the minimal arity expected.
     */
    minArity(n: number): this;

    /**
     * Specifies the minimal arity of the function where:
     * @param n - the minimal arity expected.
     */
    maxArity(n: number): this;
}

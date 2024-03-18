import {type AnySchema} from './AnySchema.js'

export interface BooleanSchema<TSchema = boolean> extends AnySchema<TSchema> {
    /**
     * Allows for additional values to be considered valid booleans by converting them to false during validation.
     * String comparisons are by default case insensitive,
     * see `boolean.sensitive()` to change this behavior.
     * @param values - strings, numbers or arrays of them
     */
    falsy(...values: Array<string | number | null>): this;

    /**
     * Allows the values provided to truthy and falsy as well as the "true" and "false" default conversion
     * (when not in `strict()` mode) to be matched in a case insensitive manner.
     */
    sensitive(enabled?: boolean): this;

    /**
     * Allows for additional values to be considered valid booleans by converting them to true during validation.
     * String comparisons are by default case insensitive, see `boolean.sensitive()` to change this behavior.
     * @param values - strings, numbers or arrays of them
     */
    truthy(...values: Array<string | number | null>): this;
}

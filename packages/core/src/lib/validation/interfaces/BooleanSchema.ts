import {AnySchema} from './AnySchema.js'

/**
 * A schema of booleans, built by `DTO.Boolean()`. With conversion enabled (`strict(false)`), the strings `'true'` and
 * `'false'` (case-insensitively) and the values of `truthy()` and `falsy()` are accepted and converted to booleans.
 * @typeParam TSchema The type of the booleans the schema validates.
 */
export interface BooleanSchema<TSchema = boolean> extends AnySchema<TSchema> {
    /**
     * Accept other values as false, with conversion enabled (`strict(false)`). The strings are compared
     * case-insensitively unless `sensitive()` is called.
     * @param values The values converted to false: strings, numbers or null.
     * @returns A new schema.
     */
    falsy(...values: Array<string | number | null>): this

    /**
     * Compare the strings converted to booleans (`'true'`, `'false'`, and the ones of `truthy()` and `falsy()`)
     * case-sensitively.
     * @param enabled Whether the comparison is case-sensitive. Defaults to true.
     * @returns A new schema.
     */
    sensitive(enabled?: boolean): this

    /**
     * Accept other values as true, with conversion enabled (`strict(false)`). The strings are compared
     * case-insensitively unless `sensitive()` is called.
     * @param values The values converted to true: strings, numbers or null.
     * @returns A new schema.
     */
    truthy(...values: Array<string | number | null>): this
}

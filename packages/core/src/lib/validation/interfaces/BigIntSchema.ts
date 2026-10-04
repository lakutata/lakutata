import {AnySchema} from './AnySchema.js'
import {Reference} from './Reference.js'

/**
 * A schema of bigints, built by `DTO.BigInt()`, for the integers beyond the safe integers of the numbers. With
 * conversion enabled (`strict(false)`), the integer strings and the integer numbers are accepted and converted to
 * bigints. Its limits and its base may be references to other values (`DTO.Ref('min')`), resolved when validating: a
 * reference resolving to a value which is not a bigint fails the validation.
 * @typeParam T The type of the bigints the schema validates.
 */
export interface BigIntSchema<T = bigint> extends AnySchema<T> {
    /**
     * Require the bigint to be greater than a limit.
     * @param limit The limit (exclusive): a bigint, or a reference to one.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When it is neither a bigint nor a reference.
     */
    greater(limit: bigint | Reference): this

    /**
     * Require the bigint to be less than a limit.
     * @param limit The limit (exclusive): a bigint, or a reference to one.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When it is neither a bigint nor a reference.
     */
    less(limit: bigint | Reference): this

    /**
     * Require the bigint to be at most a limit.
     * @param limit The maximum (inclusive): a bigint, or a reference to one.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When it is neither a bigint nor a reference.
     */
    max(limit: bigint | Reference): this

    /**
     * Require the bigint to be at least a limit.
     * @param limit The minimum (inclusive): a bigint, or a reference to one.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When it is neither a bigint nor a reference.
     */
    min(limit: bigint | Reference): this

    /**
     * Require the bigint to be a multiple of a base: 0 and the negative multiples included.
     * @param base The base: a positive bigint, or a reference to one.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When it is neither a positive bigint nor a reference.
     */
    multiple(base: bigint | Reference): this

    /**
     * Require the bigint to be negative (less than 0n).
     * @returns A new schema.
     */
    negative(): this

    /**
     * Require the bigint to be a TCP port: from 0n to 65535n.
     * @returns A new schema.
     */
    port(): this

    /**
     * Require the bigint to be positive (greater than 0n).
     * @returns A new schema.
     */
    positive(): this

    /**
     * Require the bigint to be negative or positive (0n is neither).
     * @param sign The sign required.
     * @returns A new schema.
     */
    sign(sign: 'positive' | 'negative'): this
}
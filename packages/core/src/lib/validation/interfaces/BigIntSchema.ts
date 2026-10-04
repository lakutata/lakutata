import {AnySchema} from './AnySchema.js'
import {Reference} from './Reference.js'

/**
 * A schema of bigints, built by `DTO.BigInt()`, for the integers beyond the safe integers of the numbers. With
 * conversion enabled (`strict(false)`), the integer strings and the integer numbers are accepted and converted to
 * bigints. Unlike the other schemas, its limits cannot be references to other values.
 * @typeParam T The type of the bigints the schema validates.
 */
export interface BigIntSchema<T = bigint> extends AnySchema<T> {
    /**
     * Require the bigint to be greater than a limit.
     * @param limit The limit (exclusive), a bigint.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When it is not a bigint: the references are not supported yet.
     */
    greater(limit: bigint | Reference): this

    /**
     * Require the bigint to be less than a limit.
     * @param limit The limit (exclusive), a bigint.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When it is not a bigint: the references are not supported yet.
     */
    less(limit: bigint | Reference): this

    /**
     * Require the bigint to be at most a limit.
     * @param limit The maximum (inclusive), a bigint.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When it is not a bigint: the references are not supported yet.
     */
    max(limit: bigint | Reference): this

    /**
     * Require the bigint to be at least a limit.
     * @param limit The minimum (inclusive), a bigint.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When it is not a bigint: the references are not supported yet.
     */
    min(limit: bigint | Reference): this

    /**
     * Require the bigint to be a multiple of a base. A value lower than the base is rejected: 0 and the negative
     * multiples are not accepted as multiples.
     * @param base The base, a bigint.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When it is not a bigint: the references are not supported yet.
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
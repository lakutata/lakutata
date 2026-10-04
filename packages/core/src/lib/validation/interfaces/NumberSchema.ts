import {AnySchema} from './AnySchema.js'
import {Reference} from './Reference.js'

/**
 * A schema of numbers, built by `DTO.Number()`: limits, integers and their sizes, precision. `NaN`, the infinities and
 * the numbers beyond the safe integers (`Number.MAX_SAFE_INTEGER`) are rejected unless `unsafe()` is called. With
 * conversion enabled (`strict(false)`), numeric strings are accepted as numbers.
 * @typeParam TSchema The type of the numbers the schema validates.
 */
export interface NumberSchema<TSchema = number> extends AnySchema<TSchema> {
    /**
     * Require the number to be greater than a limit.
     * @param limit The limit (exclusive), or a reference to another value holding it.
     * @returns A new schema.
     */
    greater(limit: number | Reference): this

    /**
     * Require the number to be an integer.
     * @returns A new schema.
     */
    integer(): this

    /**
     * Require the number to be an 8-bit signed integer: from -128 to 127.
     * @returns A new schema.
     */
    int8(): this

    /**
     * Require the number to be an 8-bit unsigned integer: from 0 to 255.
     * @returns A new schema.
     */
    uint8(): this

    /**
     * Require the number to be a 16-bit signed integer: from -32768 to 32767.
     * @returns A new schema.
     */
    int16(): this

    /**
     * Require the number to be a 16-bit unsigned integer: from 0 to 65535.
     * @returns A new schema.
     */
    uint16(): this

    /**
     * Require the number to be a 32-bit signed integer: from -2147483648 to 2147483647.
     * @returns A new schema.
     */
    int32(): this

    /**
     * Require the number to be a 32-bit unsigned integer: from 0 to 4294967295.
     * @returns A new schema.
     */
    uint32(): this

    /**
     * Require the number to be a 64-bit signed integer, limited to the safe integers of JavaScript
     * (`Number.MIN_SAFE_INTEGER` to `Number.MAX_SAFE_INTEGER`): the larger ones are imprecise as numbers (use
     * `DTO.BigInt()` for them).
     * @returns A new schema.
     */
    int64(): this

    /**
     * Require the number to be a 64-bit unsigned integer, limited to the safe integers of JavaScript (0 to
     * `Number.MAX_SAFE_INTEGER`): the larger ones are imprecise as numbers (use `DTO.BigInt()` for them).
     * @returns A new schema.
     */
    uint64(): this

    /**
     * Require the number to be in the range of the 32-bit floating point numbers (about ±3.4e38).
     * @returns A new schema.
     */
    float(): this

    /**
     * Declare the number as a 64-bit floating point number (the `double` format of the JSON Schemas): every finite
     * number, those beyond the safe integers included (it calls `unsafe()`).
     * @returns A new schema.
     */
    double(): this

    /**
     * Require the number to be less than a limit.
     * @param limit The limit (exclusive), or a reference to another value holding it.
     * @returns A new schema.
     */
    less(limit: number | Reference): this

    /**
     * Require the number to be at most a limit.
     * @param limit The maximum (inclusive), or a reference to another value holding it.
     * @returns A new schema.
     */
    max(limit: number | Reference): this

    /**
     * Require the number to be at least a limit.
     * @param limit The minimum (inclusive), or a reference to another value holding it.
     * @returns A new schema.
     */
    min(limit: number | Reference): this

    /**
     * Require the number to be a multiple of a base.
     * @param base The base, a positive number, or a reference to another value holding it.
     * @returns A new schema.
     */
    multiple(base: number | Reference): this

    /**
     * Require the number to be negative (less than 0).
     * @returns A new schema.
     */
    negative(): this

    /**
     * Require the number to be a TCP port: an integer from 0 to 65535.
     * @returns A new schema.
     */
    port(): this

    /**
     * Require the number to be positive (greater than 0).
     * @returns A new schema.
     */
    positive(): this

    /**
     * Require at most a number of decimal places; with conversion enabled (`strict(false)`), the number is rounded to
     * them instead.
     * @param limit The maximum number of decimal places.
     * @returns A new schema.
     */
    precision(limit: number): this

    /**
     * Require the number to be negative or positive (0 is neither).
     * @param sign The sign required.
     * @returns A new schema.
     */
    sign(sign: 'positive' | 'negative'): this

    /**
     * Allow the numbers beyond the safe integers (`Number.MIN_SAFE_INTEGER` to `Number.MAX_SAFE_INTEGER`), which lose
     * precision; rejected by default.
     * @param enabled Whether they are allowed: a falsy value restores the default. Defaults to true.
     * @returns A new schema.
     */
    unsafe(enabled?: any): this
}

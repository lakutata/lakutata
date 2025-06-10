import {AnySchema} from './AnySchema.js'
import {Reference} from './Reference.js'

export interface NumberSchema<TSchema = number> extends AnySchema<TSchema> {
    /**
     * Specifies that the value must be greater than limit.
     * It can also be a reference to another field.
     */
    greater(limit: number | Reference): this;

    /**
     * Requires the number to be an integer (no floating point).
     */
    integer(): this;

    /**
     * Requires the number to be an 8-bit integer (no floating point).
     */
    int8(): this;

    /**
     * Requires the number to be an 8-bit unsigned integer (no floating point).
     */
    uint8(): this;

    /**
     * Requires the number to be an 16-bit integer (no floating point).
     */
    int16(): this;

    /**
     * Requires the number to be an 16-bit unsigned integer (no floating point).
     */
    uint16(): this;

    /**
     * Requires the number to be an 32-bit integer (no floating point).
     */
    int32(): this;

    /**
     * Requires the number to be an 32-bit unsigned integer (no floating point).
     */
    uint32(): this;

    /**
     * Specifies that the value must be less than limit.
     * It can also be a reference to another field.
     */
    less(limit: number | Reference): this;

    /**
     * Specifies the maximum value.
     * It can also be a reference to another field.
     */
    max(limit: number | Reference): this;

    /**
     * Specifies the minimum value.
     * It can also be a reference to another field.
     */
    min(limit: number | Reference): this;

    /**
     * Specifies that the value must be a multiple of base.
     */
    multiple(base: number | Reference): this;

    /**
     * Requires the number to be negative.
     */
    negative(): this;

    /**
     * Requires the number to be a TCP port, so between 0 and 65535.
     */
    port(): this;

    /**
     * Requires the number to be positive.
     */
    positive(): this;

    /**
     * Specifies the maximum number of decimal places where:
     * @param limit - the maximum number of decimal places allowed.
     */
    precision(limit: number): this;

    /**
     * Requires the number to be negative or positive.
     */
    sign(sign: 'positive' | 'negative'): this;

    /**
     * Allows the number to be outside of JavaScript's safety range (Number.MIN_SAFE_INTEGER & Number.MAX_SAFE_INTEGER).
     */
    unsafe(enabled?: any): this;
}

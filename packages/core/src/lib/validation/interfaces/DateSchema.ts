import {AnySchema} from './AnySchema.js'
import {Reference} from './Reference.js'

/**
 * A schema of dates, built by `DTO.Date()`: `Date` objects, between limits. With conversion enabled
 * (`strict(false)`), date strings and timestamps (milliseconds) are accepted and converted to `Date` objects.
 * @typeParam TSchema The type of the dates the schema validates.
 */
export interface DateSchema<TSchema = Date> extends AnySchema<TSchema> {
    /**
     * Require the date to be after a date (exclusive).
     * @param date The date: a `Date`, a timestamp in milliseconds, a date string, `'now'` (the time of the
     * validation, to require a date in the past or the future), or a reference to another value holding it.
     * @returns A new schema.
     */
    greater(date: 'now' | Date | number | string | Reference): this

    /**
     * Require the date strings converted (with conversion enabled, `strict(false)`) to be in the ISO 8601 format.
     * @returns A new schema.
     */
    iso(): this

    /**
     * Require the date to be before a date (exclusive).
     * @param date The date: a `Date`, a timestamp in milliseconds, a date string, `'now'` (the time of the
     * validation, to require a date in the past or the future), or a reference to another value holding it.
     * @returns A new schema.
     */
    less(date: 'now' | Date | number | string | Reference): this

    /**
     * Require the date to be a date or later (inclusive).
     * @param date The date: a `Date`, a timestamp in milliseconds, a date string, `'now'` (the time of the
     * validation, to require a date in the past or the future), or a reference to another value holding it.
     * @returns A new schema.
     */
    min(date: 'now' | Date | number | string | Reference): this

    /**
     * Require the date to be a date or earlier (inclusive).
     * @param date The date: a `Date`, a timestamp in milliseconds, a date string, `'now'` (the time of the
     * validation, to require a date in the past or the future), or a reference to another value holding it.
     * @returns A new schema.
     */
    max(date: 'now' | Date | number | string | Reference): this

    /**
     * Require the dates converted (with conversion enabled, `strict(false)`) to be given as timestamps.
     * @param type The unit of the timestamps: `javascript` (milliseconds, the default) or `unix` (seconds).
     * @returns A new schema.
     */
    timestamp(type?: 'javascript' | 'unix'): this
}

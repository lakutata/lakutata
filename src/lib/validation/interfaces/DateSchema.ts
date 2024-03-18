import {AnySchema} from './AnySchema.js'
import {Reference} from 'joi'

export interface DateSchema<TSchema = Date> extends AnySchema<TSchema> {
    /**
     * Specifies that the value must be greater than date.
     * Notes: 'now' can be passed in lieu of date so as to always compare relatively to the current date,
     * allowing to explicitly ensure a date is either in the past or in the future.
     * It can also be a reference to another field.
     */
    greater(date: 'now' | Date | number | string | Reference): this;

    /**
     * Requires the string value to be in valid ISO 8601 date format.
     */
    iso(): this;

    /**
     * Specifies that the value must be less than date.
     * Notes: 'now' can be passed in lieu of date so as to always compare relatively to the current date,
     * allowing to explicitly ensure a date is either in the past or in the future.
     * It can also be a reference to another field.
     */
    less(date: 'now' | Date | number | string | Reference): this;

    /**
     * Specifies the oldest date allowed.
     * Notes: 'now' can be passed in lieu of date so as to always compare relatively to the current date,
     * allowing to explicitly ensure a date is either in the past or in the future.
     * It can also be a reference to another field.
     */
    min(date: 'now' | Date | number | string | Reference): this;

    /**
     * Specifies the latest date allowed.
     * Notes: 'now' can be passed in lieu of date so as to always compare relatively to the current date,
     * allowing to explicitly ensure a date is either in the past or in the future.
     * It can also be a reference to another field.
     */
    max(date: 'now' | Date | number | string | Reference): this;

    /**
     * Requires the value to be a timestamp interval from Unix Time.
     * @param type - the type of timestamp (allowed values are unix or javascript [default])
     */
    timestamp(type?: 'javascript' | 'unix'): this;
}

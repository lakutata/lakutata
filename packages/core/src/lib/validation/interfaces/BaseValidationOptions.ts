import Joi from 'joi'
import {ErrorFormattingOptions} from './ErrorFormattingOptions.js'
import {PresenceMode} from '../types/PresenceMode.js'

export interface BaseValidationOptions {
    /**
     * when true, stops validation on the first error, otherwise returns all the errors found.
     *
     * @default true
     */
    abortEarly?: boolean;
    /**
     * when true, allows object to contain unknown keys which are ignored.
     *
     * @default false
     */
    allowUnknown?: boolean;
    /**
     * when true, return artifacts alongside the value.
     *
     * @default false
     */
    artifacts?: boolean;
    /**
     * when true, schema caching is enabled (for schemas with explicit caching rules).
     *
     * @default false
     */
    cache?: boolean;
    /**
     * provides an external data set to be used in references
     */
    context?: Joi.Context;
    /**
     * when true, attempts to cast values to the required types (e.g. a string to a number).
     *
     * @default true
     */
    convert?: boolean;
    /**
     * sets the string format used when converting dates to strings in error messages and casting.
     *
     * @default 'iso'
     */
    dateFormat?: 'date' | 'iso' | 'string' | 'time' | 'utc';
    /**
     * when true, valid results and throw errors are decorated with a debug property which includes an array of the validation steps used to generate the returned result.
     *
     * @default false
     */
    debug?: boolean;
    /**
     * error formatting settings.
     */
    errors?: ErrorFormattingOptions;
    /**
     * if false, the external rules set with `any.external()` are ignored, which is required to ignore any external validations in synchronous mode (or an exception is thrown).
     *
     * @default true
     */
    externals?: boolean;
    /**
     * when true, do not apply default values.
     *
     * @default false
     */
    noDefaults?: boolean;
    /**
     * when true, inputs are shallow cloned to include non-enumerable properties.
     *
     * @default false
     */
    nonEnumerables?: boolean;
    /**
     * sets the default presence requirements. Supported modes: 'optional', 'required', and 'forbidden'.
     *
     * @default 'optional'
     */
    presence?: PresenceMode;
    /**
     * when true, ignores unknown keys with a function value.
     *
     * @default false
     */
    skipFunctions?: boolean;
    /**
     * remove unknown elements from objects and arrays.
     * - when true, all unknown elements will be removed
     * - when an object:
     *      - objects - set to true to remove unknown keys from objects
     *
     * @default false
     */
    stripUnknown?: boolean | { arrays?: boolean; objects?: boolean };
}

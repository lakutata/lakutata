import {
    type BasicType,
    type Cache,
    type Context,
    type Description,
    type LanguageMessages,
    type PresenceMode,
    type Reference,
    type RuleOptions,
    type ValidationErrorFunction,
    type ValidationOptions
} from 'joi'
import {type Types} from '../types/Types.js'
import {type Schema} from '../types/Schema.js'
import {type SchemaFunction} from '../types/SchemaFunction.js'
import {type CustomHelpers} from './CustomHelpers.js'
import {type SchemaLike} from '../types/SchemaLike.js'
import {type WhenOptions} from './WhenOptions.js'
import {type WhenSchemaOptions} from './WhenSchemaOptions.js'
import {type CustomValidator} from '../types/CustomValidator.js'
import {type ExternalValidationFunction} from '../types/ExternalValidationFunction.js'

export interface AnySchema<TSchema = any> {
    type?: Types | undefined;

    /**
     * Whitelists a value
     */
    allow(...values: any[]): this;

    /**
     * Assign target alteration options to a schema that are applied when `any.tailor()` is called.
     * @param targets - an object where each key is a target name, and each value is a function that takes an schema and returns an schema.
     */
    alter(targets: Record<string, (schema: this) => Schema>): this;

    /**
     * Assigns the schema an artifact id which is included in the validation result if the rule passed validation.
     * @param id - any value other than undefined which will be returned as-is in the result artifacts map.
     */
    artifact(id: any): this;

    /**
     * By default, some Joi methods to function properly need to rely on the Joi instance they are attached to because
     * they use `this` internally.
     * So `Joi.string()` works but if you extract the function from it and call `string()` it won't.
     * `bind()` creates a new Joi instance where all the functions relying on `this` are bound to the Joi instance.
     */
    bind(): this;

    /**
     * Adds caching to the schema which will attempt to cache the validation results (success and failures) of incoming inputs.
     * If no cache is passed, a default cache is provisioned by using `cache.provision()` internally.
     */
    cache(cache?: Cache): this;

    /**
     * Casts the validated value to the specified type.
     */
    cast(to: 'map' | 'number' | 'set' | 'string'): this;

    /**
     * Returns a new type that is the result of adding the rules of one type to another.
     */
    concat(schema: this): this;

    /**
     * Adds a custom validation function.
     */
    custom(fn: CustomValidator, description?: string): this;

    /**
     * Sets a default value if the original value is `undefined` where:
     * @param value - the default value. One of:
     *    - a literal value (string, number, object, etc.)
     *    - a [references](#refkey-options)
     *    - a function which returns the default value using the signature `function(parent, helpers)` where:
     *        - `parent` - a clone of the object containing the value being validated. Note that since specifying a
     *          `parent` argument performs cloning, do not declare format arguments if you are not using them.
     *        - `helpers` - same as those described in [`any.custom()`](anycustomermethod_description)
     *
     * When called without any `value` on an object schema type, a default value will be automatically generated
     * based on the default values of the object keys.
     *
     * Note that if value is an object, any changes to the object after `default()` is called will change the
     *  reference and any future assignment.
     */
    default(value?: BasicType | Reference | ((parent: any, helpers: CustomHelpers) => BasicType | Reference)): this;

    /**
     * Returns a plain object representing the schema's rules and properties
     */
    describe(): Description;

    /**
     * Annotates the key
     */
    description(desc: string): this;

    /**
     * Disallows values.
     */
    disallow(...values: any[]): this;

    /**
     * Considers anything that matches the schema to be empty (undefined).
     * @param schema - any object or joi schema to match. An undefined schema unsets that rule.
     */
    empty(schema?: SchemaLike): this;

    /**
     * Adds the provided values into the allowed whitelist and marks them as the only valid values allowed.
     */
    equal(...values: any[]): this;

    /**
     * Overrides the default joi error with a custom error if the rule fails where:
     * @param err - can be:
     *   an instance of `Error` - the override error.
     *   a `function(errors)`, taking an array of errors as argument, where it must either:
     *    return a `string` - substitutes the error message with this text
     *    return a single ` object` or an `Array` of it, where:
     *     `type` - optional parameter providing the type of the error (eg. `number.min`).
     *     `message` - optional parameter if `template` is provided, containing the text of the error.
     *     `template` - optional parameter if `message` is provided, containing a template string, using the same format as usual joi language errors.
     *     `context` - optional parameter, to provide context to your error if you are using the `template`.
     *    return an `Error` - same as when you directly provide an `Error`, but you can customize the error message based on the errors.
     *
     * Note that if you provide an `Error`, it will be returned as-is, unmodified and undecorated with any of the
     * normal joi error properties. If validation fails and another error is found before the error
     * override, that error will be returned and the override will be ignored (unless the `abortEarly`
     * option has been set to `false`).
     */
    error(err: Error | ValidationErrorFunction): this;

    /**
     * Annotates the key with an example value, must be valid.
     */
    example(value: any, options?: { override: boolean }): this;

    /**
     * Marks a key as required which will not allow undefined as value. All keys are optional by default.
     */
    exist(): this;

    /**
     * Adds an external validation rule.
     *
     * Note that external validation rules are only called after the all other validation rules for the entire schema (from the value root) are checked.
     * This means that any changes made to the value by the external rules are not available to any other validation rules during the non-external validation phase.
     * If schema validation failed, no external validation rules are called.
     */
    external(method: ExternalValidationFunction, description?: string): this;

    /**
     * Returns a sub-schema based on a path of object keys or schema ids.
     *
     * @param path - a dot `.` separated path string or a pre-split array of path keys. The keys must match the sub-schema id or object key (if no id was explicitly set).
     */
    extract(path: string | string[]): Schema;

    /**
     * Sets a failover value if the original value fails passing validation.
     *
     * @param value - the failover value. value supports references. value may be assigned a function which returns the default value.
     *
     * If value is specified as a function that accepts a single parameter, that parameter will be a context object that can be used to derive the resulting value.
     * Note that if value is an object, any changes to the object after `failover()` is called will change the reference and any future assignment.
     * Use a function when setting a dynamic value (e.g. the current time).
     * Using a function with a single argument performs some internal cloning which has a performance impact.
     * If you do not need access to the context, define the function without any arguments.
     */
    failover(value: any): this;

    /**
     * Marks a key as forbidden which will not allow any value except undefined. Used to explicitly forbid keys.
     */
    forbidden(): this;

    /**
     * Returns a new schema where each of the path keys listed have been modified.
     *
     * @param key - an array of key strings, a single key string, or an array of arrays of pre-split key strings.
     * @param adjuster - a function which must return a modified schema.
     */
    fork(key: string | string[] | string[][], adjuster: SchemaFunction): this;

    /**
     * Sets a schema id for reaching into the schema via `any.extract()`.
     * If no id is set, the schema id defaults to the object key it is associated with.
     * If the schema is used in an array or alternatives type and no id is set, the schema in unreachable.
     */
    id(name?: string): this;

    /**
     * Disallows values.
     */
    invalid(...values: any[]): this;

    /**
     * Same as `rule({ keep: true })`.
     *
     * Note that `keep()` will terminate the current ruleset and cannot be followed by another rule option.
     * Use `rule()` to apply multiple rule options.
     */
    keep(): this;

    /**
     * Overrides the key name in error messages.
     */
    label(name: string): this;

    /**
     * Same as `rule({ message })`.
     *
     * Note that `message()` will terminate the current ruleset and cannot be followed by another rule option.
     * Use `rule()` to apply multiple rule options.
     */
    message(message: string): this;

    /**
     * Same as `any.prefs({ messages })`.
     * Note that while `any.message()` applies only to the last rule or ruleset, `any.messages()` applies to the entire schema.
     */
    messages(messages: LanguageMessages): this;

    /**
     * Attaches metadata to the key.
     */
    meta(meta: object): this;

    /**
     * Disallows values.
     */
    not(...values: any[]): this;

    /**
     * Annotates the key
     */
    note(...notes: string[]): this;

    /**
     * Requires the validated value to match of the provided `any.allow()` values.
     * It has not effect when called together with `any.valid()` since it already sets the requirements.
     * When used with `any.allow()` it converts it to an `any.valid()`.
     */
    only(): this;

    /**
     * Marks a key as optional which will allow undefined as values. Used to annotate the schema for readability as all keys are optional by default.
     */
    optional(): this;

    /**
     * Overrides the global validate() options for the current key and any sub-key.
     */
    options(options: ValidationOptions): this;

    /**
     * Overrides the global validate() options for the current key and any sub-key.
     */
    prefs(options: ValidationOptions): this;

    /**
     * Overrides the global validate() options for the current key and any sub-key.
     */
    preferences(options: ValidationOptions): this;

    /**
     * Sets the presence mode for the schema.
     */
    presence(mode: PresenceMode): this;

    /**
     * Outputs the original untouched value instead of the casted value.
     */
    raw(enabled?: boolean): this;

    /**
     * Marks a key as required which will not allow undefined as value. All keys are optional by default.
     */
    required(): this;

    /**
     * Applies a set of rule options to the current ruleset or last rule added.
     *
     * When applying rule options, the last rule (e.g. `min()`) is used unless there is an active ruleset defined (e.g. `$.min().max()`)
     * in which case the options are applied to all the provided rules.
     * Once `rule()` is called, the previous rules can no longer be modified and any active ruleset is terminated.
     *
     * Rule modifications can only be applied to supported rules.
     * Most of the `any` methods do not support rule modifications because they are implemented using schema flags (e.g. `required()`) or special
     * internal implementation (e.g. `valid()`).
     * In those cases, use the `any.messages()` method to override the error codes for the errors you want to customize.
     */
    rule(options: RuleOptions): this;

    /**
     * Registers a schema to be used by descendants of the current schema in named link references.
     */
    shared(ref: Schema): this;

    /**
     * Sets the options.convert options to false which prevent type casting for the current key and any child keys.
     */
    strict(isStrict?: boolean): this;

    /**
     * Marks a key to be removed from a resulting object or array after validation. Used to sanitize output.
     * @param [enabled=true] - if true, the value is stripped, otherwise the validated value is retained. Defaults to true.
     */
    strip(enabled?: boolean): this;

    /**
     * Annotates the key
     */
    tag(...tags: string[]): this;

    /**
     * Applies any assigned target alterations to a copy of the schema that were applied via `any.alter()`.
     */
    tailor(targets: string | string[]): Schema;

    /**
     * Annotates the key with an unit name.
     */
    unit(name: string): this;

    /**
     * Adds the provided values into the allowed whitelist and marks them as the only valid values allowed.
     */
    valid(...values: any[]): this;

    /**
     * Same as `rule({ warn: true })`.
     * Note that `warn()` will terminate the current ruleset and cannot be followed by another rule option.
     * Use `rule()` to apply multiple rule options.
     */
    warn(): this;

    /**
     * Generates a warning.
     * When calling `any.validateAsync()`, set the `warning` option to true to enable warnings.
     * Warnings are reported separately from errors alongside the result value via the warning key (i.e. `{ value, warning }`).
     * Warning are always included when calling `any.validate()`.
     */
    warning(code: string, context: Context): this;

    /**
     * Converts the type into an alternatives type where the conditions are merged into the type definition where:
     */
    when(ref: string | Reference, options: WhenOptions | WhenOptions[]): this;

    /**
     * Converts the type into an alternatives type where the conditions are merged into the type definition where:
     */
    when(ref: Schema, options: WhenSchemaOptions): this;
}


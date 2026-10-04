import {Types} from '../types/Types.js'
import {Schema} from '../types/Schema.js'
import {SchemaFunction} from '../types/SchemaFunction.js'
import {CustomHelpers} from './CustomHelpers.js'
import {SchemaLike} from '../types/SchemaLike.js'
import {WhenOptions} from './WhenOptions.js'
import {WhenSchemaOptions} from './WhenSchemaOptions.js'
import {CustomValidator} from '../types/CustomValidator.js'
import {ExternalValidationFunction} from '../types/ExternalValidationFunction.js'
import {Reference} from './Reference.js'
import {LanguageMessages} from '../types/LanguageMessages.js'
import {PresenceMode} from '../types/PresenceMode.js'
import {ValidationOptions} from './ValidationOptions.js'
import {BasicType} from '../types/BasicType.js'
import {Cache} from './Cache.js'
import {Context} from './Context.js'
import {Description} from './Description.js'
import {RuleOptions} from './RuleOptions.js'
import {ValidationErrorFunction} from '../types/ValidationErrorFunction.js'

/**
 * A schema accepting any value, and the methods shared by all the schemas: presence (`required()`, `optional()`),
 * allowed and forbidden values, defaults, labels, messages, conditions, annotations. Built by `DTO.Any()`; the other
 * builders (`DTO.String()`, `DTO.Object()`, …) return schemas extending it.
 *
 * The schemas are immutable: every method returns a new schema and leaves the original unchanged. The schemas built
 * by `DTO` are strict: they do not convert the values (the string `'5'` is not accepted as a number) unless
 * `strict(false)` is called. A method given invalid arguments throws a `SchemaDefinitionException` when the schema is
 * built, not when it validates.
 * @typeParam TSchema The type of the values the schema validates.
 */
//The type parameter of the public API (DTO.Any<T>()), kept for the code giving it
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface AnySchema<TSchema = any> {
    /**
     * The type name of the schema (`string`, `object`, `bigint`…).
     */
    type?: Types | undefined

    /**
     * Allow values, even when they fail the other rules of the schema (`DTO.String().allow(null, '')`). Also see
     * `valid()`, which makes them the only values allowed.
     * @param values The values allowed, compared by deep equality; references are resolved during the validation.
     * @returns A new schema.
     */
    allow(...values: any[]): this

    /**
     * Require the value to also match every schema; their errors are reported, while the value they return (their
     * conversions) is not kept.
     * @param schemas The schemas the value must match.
     * @returns A new schema.
     */
    allOf(...schemas: SchemaLike[]): this

    /**
     * Assign named alterations to the schema, applied to a copy of it when `tailor()` is called with their names.
     * @param targets The adjusters by target name: each function takes the schema and returns the altered one.
     * @returns A new schema.
     */
    alter(targets: Record<string, (schema: this) => Schema>): this

    /**
     * Assign the schema an artifact id, collected when the rule passes and the `artifacts` validation option is on.
     * @param id Any value other than undefined, returned as-is in the result artifacts map.
     * @returns A new schema.
     */
    artifact(id: any): this

    /**
     * Cache the validation results (successes and failures) of the inputs, for the primitive inputs only. The cache is
     * only used when the `cache` validation option is true, which it is not by default.
     * @param cache The cache to use. Defaults to a new cache of at most 1000 entries, dropping the least recently used.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the schema already has a cache, or an artifact.
     */
    cache(cache?: Cache): this

    /**
     * Cast the validated value to another type: `map` for an object schema, `set` for an array schema, `number` or
     * `string` for a boolean, date or number schema.
     * @param to The type of the value returned.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the type of the schema cannot cast to it.
     */
    cast(to: 'map' | 'number' | 'set' | 'string'): this

    /**
     * Merge another schema into this one: its rules, flags and allowed values are added to the ones of this schema.
     * @param schema A schema of the same type, or an any schema (`DTO.Any()`).
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the types differ (an any schema excepted).
     */
    concat(schema: this): this

    /**
     * Add a custom validation rule.
     * @param fn The rule: it returns the value to keep (undefined keeps it unchanged) or an error from `helpers.error()`;
     * an error it throws fails the validation with the code `any.custom` and the error message.
     * @param description A description of the rule, shown by `describe()`.
     * @returns A new schema.
     */
    custom(fn: CustomValidator, description?: string): this

    /**
     * Set a default value, used when the value is undefined. Unless the `noDefaults` validation option is on, the
     * default is returned as the validated value (it is not validated itself).
     * @param value The default value: a literal, a reference (`DTO.Ref('other')`), or a function returning it,
     * called with a clone of the parent object and the validation helpers (declare no parameters when you do not use
     * them: the clone has a cost). An object is used by reference: changing it afterwards changes the default. Without a
     * value, an object schema defaults to an object built from the defaults of its keys.
     * @returns A new schema.
     */
    default(value?: BasicType | Reference | ((parent: any, helpers: CustomHelpers) => BasicType | Reference)): this

    /**
     * Describe the schema as a plain object: its type, flags, rules, allowed values and annotations.
     * @returns The description.
     */
    describe(): Description

    /**
     * Set the description of the value, an annotation shown by `describe()` and written to the JSON Schemas.
     * @param desc The description, a non-empty string.
     * @returns A new schema.
     */
    description(desc: string): this

    /**
     * Forbid values (an alias of `invalid()`).
     * @param values The values forbidden, compared by deep equality.
     * @returns A new schema.
     */
    disallow(...values: any[]): this

    /**
     * Treat the values matching a schema as empty (undefined), like the empty string for an optional string:
     * `DTO.String().empty('')`.
     * @param schema The schema, or the literal value, of the empty values. Without it, the rule is removed.
     * @returns A new schema.
     */
    empty(schema?: SchemaLike): this

    /**
     * Allow only the given values (an alias of `valid()`).
     * @param values The only values allowed, compared by deep equality.
     * @returns A new schema.
     */
    equal(...values: any[]): this

    /**
     * Replace the validation error of the schema when a rule fails.
     * @param err An `Error`, thrown as is without the details of the validation; or a function receiving the error
     * reports and returning the new message (a string), error items (`type`, `message` or `template`, `context`) or an
     * `Error`. When another error is found before this schema is validated, that error is the one reported (unless the
     * `abortEarly` validation option is false).
     * @returns A new schema.
     */
    error(err: Error | ValidationErrorFunction): this

    /**
     * Add an example value, an annotation shown by `describe()` and written to the JSON Schemas.
     * @param value The example, which should be valid; not undefined.
     * @param options With `override: true`, the example replaces the ones added before.
     * @returns A new schema.
     */
    example(value: any, options?: { override: boolean }): this

    /**
     * Require the value: undefined is not allowed (an alias of `required()`).
     * @returns A new schema.
     */
    exist(): this

    /**
     * Add an external validation rule, which may be asynchronous (a database lookup). The external rules run after all
     * the other rules of the whole value passed, and only then; their changes to the value are not seen by the other
     * rules.
     * @param method The rule: it returns the value to keep (undefined keeps it unchanged) or an error from
     * `helpers.error()`.
     * @param description A description of the rule, shown by `describe()`.
     * @returns A new schema.
     * @remarks A schema with external rules must be validated by `DTO.validateAsync()`: the synchronous validation
     * throws a `SchemaDefinitionException`, unless the `externals` validation option is false.
     */
    external(method: ExternalValidationFunction, description?: string): this

    /**
     * Get a sub-schema by its path of object keys or schema ids.
     * @param path A path separated by `.` (`'address.city'`), or its keys as an array. A key is the id set by `id()` or,
     * without one, the object key.
     * @returns The sub-schema.
     * @throws {SchemaDefinitionException} When no sub-schema has the path.
     */
    extract(path: string | string[]): Schema

    /**
     * Set a failover value, returned instead of an error when the value fails the validation.
     * @param value The failover value: a literal, a reference, or a function returning it (called with a clone of the
     * parent object and the validation helpers: declare no parameters when you do not use them). An object is used by
     * reference: changing it afterwards changes the failover.
     * @returns A new schema.
     */
    failover(value: any): this

    /**
     * Forbid the value: only undefined is allowed. Used to reject a key of an object.
     * @returns A new schema.
     */
    forbidden(): this

    /**
     * Return a copy of the schema with the sub-schemas at the given paths replaced by an adjusted version.
     * @param key The path of a sub-schema (`'a.b'`), several paths, or paths as arrays of keys.
     * @param adjuster The function returning the new sub-schema from the current one, like `(schema) => schema.required()`.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When a path reaches no sub-schema.
     */
    fork(key: string | string[] | string[][], adjuster: SchemaFunction): this

    /**
     * Set the id of the schema, which `extract()`, `fork()` and the links (`DTO.Link('#id')`) reach it by. Without an
     * id, a key of an object schema is reached by its key; a schema in an array or alternatives cannot be reached.
     * The JSON Schemas write a schema with an id as a shared definition.
     * @param name The id, without `.`. Without it, the id is removed.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the id contains a `.`.
     */
    id(name?: string): this

    /**
     * Forbid values, even when they match the other rules.
     * @param values The values forbidden, compared by deep equality; references are resolved during the validation.
     * @returns A new schema.
     */
    invalid(...values: any[]): this

    /**
     * Keep the errors of the last rule (or ruleset) reported when it fails, even with the `abortEarly` option: same as
     * `rule({keep: true})`. It ends the current ruleset: use `rule()` to set several rule options.
     * @returns A new schema.
     */
    keep(): this

    /**
     * Set the name of the value in the error messages (`{{#label}}`), in place of its key.
     * @param name The label, a non-empty string.
     * @returns A new schema.
     */
    label(name: string): this

    /**
     * Set the error message of the last rule (or ruleset): same as `rule({message})`. It ends the current ruleset: use
     * `rule()` to set several rule options.
     * @param message The message template, like `'{{#label}} is too short'`.
     * @returns A new schema.
     */
    message(message: string): this

    /**
     * Set the error messages of the whole schema, by error code: same as `prefs({messages})`. Unlike `message()`, which
     * applies to the last rule, it applies to every rule of the schema.
     * @param messages The message templates by error code (`{'string.min': '…'}`), or by language then error code.
     * @returns A new schema.
     */
    messages(messages: LanguageMessages): this

    /**
     * Attach metadata to the schema, an annotation shown by `describe()`.
     * @param meta Any value other than undefined.
     * @returns A new schema.
     */
    meta(meta: object): this

    /**
     * Forbid values (an alias of `invalid()`).
     * @param values The values forbidden, compared by deep equality.
     * @returns A new schema.
     */
    not(...values: any[]): this

    /**
     * Add notes to the schema, annotations shown by `describe()`.
     * @param notes The notes, non-empty strings.
     * @returns A new schema.
     */
    note(...notes: string[]): this

    /**
     * Allow only the values given to `allow()`, turning them into `valid()` values. It has no effect after `valid()`,
     * which already does.
     * @returns A new schema.
     */
    only(): this

    /**
     * Allow the value to be undefined. The values are optional by default: this undoes `required()`, or the
     * `presence` validation option.
     * @returns A new schema.
     */
    optional(): this

    /**
     * Set validation options for this schema and its children, overriding the options given to the validation (an
     * alias of `prefs()`).
     * @param options The validation options.
     * @returns A new schema.
     */
    options(options: ValidationOptions): this

    /**
     * Set validation options for this schema and its children, overriding the options given to the validation.
     * @param options The validation options.
     * @returns A new schema.
     */
    prefs(options: ValidationOptions): this

    /**
     * Set validation options for this schema and its children, overriding the options given to the validation (an
     * alias of `prefs()`).
     * @param options The validation options.
     * @returns A new schema.
     */
    preferences(options: ValidationOptions): this

    /**
     * Set the presence of the value: `optional` (the default), `required` or `forbidden`.
     * @param mode The presence mode.
     * @returns A new schema.
     */
    presence(mode: PresenceMode): this

    /**
     * Return the original value, as given, instead of the converted one once the validation passes.
     * @param enabled Whether to return the original value. Defaults to true.
     * @returns A new schema.
     */
    raw(enabled?: boolean): this

    /**
     * Require the value: undefined is not allowed. The values are optional by default.
     * @returns A new schema.
     */
    required(): this

    /**
     * Apply options to the last rule added (like `min()`), or to every rule of the current ruleset
     * (`$.min(1).max(9)`). Once called, the previous rules can no longer be changed and the ruleset ends.
     * @param options The rule options: its error message, `keep`, `warn`.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the last rule does not support options: the flags (`required()`,
     * `valid()`, …) do not; change their messages with `messages()`.
     */
    rule(options: RuleOptions): this

    /**
     * Register a schema with an id, which the links (`DTO.Link('#id')`) of the descendants of this schema can reach.
     * @param ref The schema, which must have an id (`id()`).
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the schema has no id.
     */
    shared(ref: Schema): this

    /**
     * Set whether the values are converted to the type of the schema (the string `'5'` to a number, `'true'` to a
     * boolean), for this schema and its children. The schemas built by `DTO` start strict.
     * @param isStrict True (the default) to disable the conversions, false to enable them.
     * @returns A new schema.
     */
    strict(isStrict?: boolean): this

    /**
     * Remove the value from the validated object or array, after its validation. Used to sanitize an output.
     * @param enabled Whether to remove the value. Defaults to true.
     * @returns A new schema.
     */
    strip(enabled?: boolean): this

    /**
     * Add tags to the schema, annotations shown by `describe()`.
     * @param tags The tags, non-empty strings.
     * @returns A new schema.
     */
    tag(...tags: string[]): this

    /**
     * Apply the alterations assigned by `alter()` to a copy of the schema, its children included.
     * @param targets The name of the alteration, or several names applied in order.
     * @returns The altered copy.
     */
    tailor(targets: string | string[]): Schema

    /**
     * Set the unit of the value (`'ms'`, `'bytes'`), an annotation shown by `describe()`.
     * @param name The unit, a non-empty string.
     * @returns A new schema.
     */
    unit(name: string): this

    /**
     * Allow only the given values (`DTO.String().valid('asc', 'desc')`), in addition to the ones of `allow()`.
     * @param values The only values allowed, compared by deep equality; references are resolved during the validation.
     * @returns A new schema.
     */
    valid(...values: any[]): this

    /**
     * Make the last rule (or ruleset) a warning, which does not fail the validation: same as `rule({warn: true})`.
     * `DTO.validate()` does not report the warnings. It ends the current ruleset: use `rule()` to set several rule
     * options.
     * @returns A new schema.
     */
    warn(): this

    /**
     * Add a rule which always reports a warning, which does not fail the validation. `DTO.validate()` does not report
     * the warnings.
     * @param code The error code of the warning, whose message is looked up like the error ones.
     * @param context The variables of the message.
     * @returns A new schema.
     */
    warning(code: string, context: Context): this

    /**
     * Apply another schema depending on the value of another key (or of the global context): the schema of a
     * condition met is concatenated to this one.
     * @param ref The key the condition reads (`'type'`, `'..parent.key'`, `'/root'`, `'$context'`), or a reference.
     * @param options The condition: `is` (a schema or a value the referenced value must match), then the schema
     * concatenated to this one when it does (`then`) or does not (`otherwise`); or a list of conditions, or a `switch`.
     * @returns A new schema.
     * @example
     * ```typescript
     * import {DTO} from 'lakutata'
     *
     * //The card number is required when the payment is by card
     * const schema = DTO.Object({
     *     method: DTO.String().valid('card', 'cash').required(),
     *     card: DTO.String().when('method', {is: 'card', then: DTO.Any().required(), otherwise: DTO.Any().forbidden()})
     * })
     * ```
     */
    when(ref: string | Reference, options: WhenOptions | WhenOptions[]): this

    /**
     * Apply another schema depending on whether the value itself matches a schema.
     * @param ref The schema the value is tested against.
     * @param options The schema concatenated to this one when the value matches (`then`) or does not (`otherwise`).
     * @returns A new schema.
     */
    when(ref: Schema, options: WhenSchemaOptions): this
}


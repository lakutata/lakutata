import {AnySchema} from './AnySchema.js'
import {SchemaMap} from '../types/SchemaMap.js'
import {SchemaLike} from '../types/SchemaLike.js'
import {ObjectPatternOptions} from './ObjectPatternOptions.js'
import {DependencyOptions} from './DependencyOptions.js'
import {Reference} from './Reference.js'
import {RenameOptions} from './RenameOptions.js'

/**
 * A schema of objects, built by `DTO.Object(keys)` (and returned by `DTO.Schema()` for a DTO class): the schemas of
 * its keys, the unknown keys, and the dependencies between keys.
 *
 * The validations of lakutata allow the unknown keys and remove them from the validated object (the `allowUnknown` and
 * `stripUnknown` options); `unknown(false)` rejects them instead.
 * @typeParam TSchema The type of the objects the schema validates.
 */
export interface ObjectSchema<TSchema = any> extends AnySchema<TSchema> {
    /**
     * Require all the keys together: when one of them is present, all of them must be.
     * @param peers The key names (dotted paths reach nested keys), optionally followed by the options: `separator`
     * of the paths (default `.`), `isPresent` (what counts as present, by default not undefined).
     * @returns A new schema.
     */
    and(...peers: Array<string | DependencyOptions>): this

    /**
     * Add keys to the schema, replacing the schemas of the keys already present. Unlike `keys()`, an empty or missing
     * argument changes nothing.
     * @param schema The schemas of the keys to add, by key.
     * @returns A new schema.
     */
    append(schema?: SchemaMap<TSchema>): this

    append<TSchemaExtended = any, T = TSchemaExtended>(schema?: SchemaMap<T>): ObjectSchema<T>

    /**
     * Require a value of the object to match a schema (the object itself fails, with the message).
     * @param ref The value tested: a key path relative to the object, which starts with `.` (`'.a.b'`), or a
     * reference.
     * @param schema The schema the value must match, like `DTO.Ref('b')` to require it to equal another key.
     * @param message The reason shown in the error message (`… failed to <message>`).
     * @returns A new schema.
     */
    assert(ref: string | Reference, schema: SchemaLike, message?: string): this

    /**
     * Require the object to be an instance of a class.
     *
     * @param constructor The class the object must be an instance of.
     * @param name The name of the class in the error messages, for a class without a name. Defaults to its name.
     * @returns A new schema.
     */
    // tslint:disable-next-line:ban-types
    instance(constructor: Function, name?: string): this

    /**
     * Require every key name of the object to match a schema.
     * @param schema The schema of the key names, like `DTO.String().pattern(/^[a-z]+$/)`.
     * @returns A new schema.
     */
    keyNames(schema: SchemaLike): this

    /**
     * Set the keys of the schema, adding to the keys already set (a key given again replaces its schema). Without an
     * argument, any key is allowed; with `{}`, no key is.
     * @param schema The schemas of the keys, by key.
     * @returns A new schema.
     */
    keys(schema?: SchemaMap<TSchema>): this

    /**
     * Require an exact number of keys.
     * @param limit The number of keys.
     * @returns A new schema.
     */
    length(limit: number): this

    /**
     * Require at most a number of keys.
     * @param limit The maximum number of keys (inclusive), or a reference to another value holding it.
     * @returns A new schema.
     */
    max(limit: number | Reference): this

    /**
     * Require at least a number of keys.
     * @param limit The minimum number of keys (inclusive), or a reference to another value holding it.
     * @returns A new schema.
     */
    min(limit: number | Reference): this

    /**
     * Forbid all the keys together: some of them may be present, not all of them.
     * @param peers The key names (dotted paths reach nested keys), optionally followed by the options: `separator`
     * of the paths (default `.`), `isPresent` (what counts as present, by default not undefined).
     * @returns A new schema.
     */
    nand(...peers: Array<string | DependencyOptions>): this

    /**
     * Require at least one of the keys (several are allowed).
     * @param peers The key names (dotted paths reach nested keys), optionally followed by the options: `separator`
     * of the paths (default `.`), `isPresent` (what counts as present, by default not undefined).
     * @returns A new schema.
     */
    or(...peers: Array<string | DependencyOptions>): this

    /**
     * Allow at most one of the keys: none or one of them.
     * @param peers The key names (dotted paths reach nested keys), optionally followed by the options: `separator`
     * of the paths (default `.`), `isPresent` (what counts as present, by default not undefined).
     * @returns A new schema.
     */
    oxor(...peers: Array<string | DependencyOptions>): this

    /**
     * Specify validation rules for unknown keys matching a pattern.
     *
     * @param pattern A regular expression, or a schema, the unknown key names are tested against.
     * @param schema The schema of the values of the matching keys.
     * @param options `fallthrough`: whether a key matching this pattern is also tested against the following patterns
     * (default false); `matches`: a schema the array of the matching key names must match (like
     * `DTO.Array().max(3)`).
     * @returns A new schema.
     */
    pattern(pattern: RegExp | SchemaLike, schema: SchemaLike, options?: ObjectPatternOptions): this

    /**
     * Require the value to be a reference (created by `DTO.Ref()`).
     * @returns A new schema.
     */
    ref(): this

    /**
     * Require the value to be a `RegExp` object.
     * @returns A new schema.
     */
    regex(): this

    /**
     * Rename a key of the validated object, before its keys are validated: the old key is removed unless the `alias`
     * option is set.
     * @param from The key to rename, or a regular expression matching the keys to rename.
     * @param to The new key name.
     * @param options `alias` (keep the old key too), `multiple` (allow several keys renamed to the same one, the last
     * wins), `override` (allow replacing an existing key), `ignoreUndefined` (skip an undefined value); all false by
     * default.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the key is already renamed by the schema, or renamed to itself.
     */
    rename(from: string | RegExp, to: string, options?: RenameOptions): this

    /**
     * Require the value to be a schema (built by `DTO`).
     * @param type The type the schema must have (`'number'`). Defaults to `any`, which accepts every schema.
     * @returns A new schema.
     */
    schema(type?: SchemaLike): this

    /**
     * Set whether the unknown keys are allowed, for this object only (not its children), overriding the `allowUnknown`
     * validation option. Allowed unknown keys are kept in the validated object.
     * @param allow True (the default) to allow and keep them, false to reject them, or a schema their values must
     * match.
     * @returns A new schema.
     */
    unknown(allow?: boolean | SchemaLike): this

    /**
     * Require other keys whenever a key is present.
     * @param key The key (a dotted path reaches a nested key).
     * @param peers The keys required with it.
     * @param options `separator` of the paths (default `.`), `isPresent` (what counts as present, by default not
     * undefined).
     * @returns A new schema.
     */
    with(key: string, peers: string | string[], options?: DependencyOptions): this

    /**
     * Forbid other keys whenever a key is present.
     * @param key The key (a dotted path reaches a nested key).
     * @param peers The keys forbidden with it.
     * @param options `separator` of the paths (default `.`), `isPresent` (what counts as present, by default not
     * undefined).
     * @returns A new schema.
     */
    without(key: string, peers: string | string[], options?: DependencyOptions): this

    /**
     * Require exactly one of the keys.
     * @param peers The key names (dotted paths reach nested keys), optionally followed by the options: `separator`
     * of the paths (default `.`), `isPresent` (what counts as present, by default not undefined).
     * @returns A new schema.
     */
    xor(...peers: Array<string | DependencyOptions>): this
}

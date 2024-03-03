import {AnySchema} from './AnySchema.js'
import {DependencyOptions, ObjectPatternOptions, Reference, RenameOptions, SchemaLike, SchemaMap} from 'joi'

export interface ObjectSchema<TSchema = any> extends AnySchema<TSchema> {
    /**
     * Defines an all-or-nothing relationship between keys where if one of the peers is present, all of them are required as well.
     *
     * Optional settings must be the last argument.
     */
    and(...peers: Array<string | DependencyOptions>): this;

    /**
     * Appends the allowed object keys. If schema is null, undefined, or {}, no changes will be applied.
     */
    append(schema?: SchemaMap<TSchema>): this;

    append<TSchemaExtended = any, T = TSchemaExtended>(schema?: SchemaMap<T>): ObjectSchema<T>

    /**
     * Verifies an assertion where.
     */
    assert(ref: string | Reference, schema: SchemaLike, message?: string): this;

    /**
     * Requires the object to be an instance of a given constructor.
     *
     * @param constructor - the constructor function that the object must be an instance of.
     * @param name - an alternate name to use in validation errors. This is useful when the constructor function does not have a name.
     */
    // tslint:disable-next-line:ban-types
    instance(constructor: Function, name?: string): this;

    /**
     * Sets or extends the allowed object keys.
     */
    keys(schema?: SchemaMap<TSchema>): this;

    /**
     * Specifies the exact number of keys in the object.
     */
    length(limit: number): this;

    /**
     * Specifies the maximum number of keys in the object.
     */
    max(limit: number | Reference): this;

    /**
     * Specifies the minimum number of keys in the object.
     */
    min(limit: number | Reference): this;

    /**
     * Defines a relationship between keys where not all peers can be present at the same time.
     *
     * Optional settings must be the last argument.
     */
    nand(...peers: Array<string | DependencyOptions>): this;

    /**
     * Defines a relationship between keys where one of the peers is required (and more than one is allowed).
     *
     * Optional settings must be the last argument.
     */
    or(...peers: Array<string | DependencyOptions>): this;

    /**
     * Defines an exclusive relationship between a set of keys where only one is allowed but none are required.
     *
     * Optional settings must be the last argument.
     */
    oxor(...peers: Array<string | DependencyOptions>): this;

    /**
     * Specify validation rules for unknown keys matching a pattern.
     *
     * @param pattern - a pattern that can be either a regular expression or a joi schema that will be tested against the unknown key names
     * @param schema - the schema object matching keys must validate against
     */
    pattern(pattern: RegExp | SchemaLike, schema: SchemaLike, options?: ObjectPatternOptions): this;

    /**
     * Requires the object to be a Joi reference.
     */
    ref(): this;

    /**
     * Requires the object to be a `RegExp` object.
     */
    regex(): this;

    /**
     * Renames a key to another name (deletes the renamed key).
     */
    rename(from: string | RegExp, to: string, options?: RenameOptions): this;

    /**
     * Requires the object to be a Joi schema instance.
     */
    schema(type?: SchemaLike): this;

    /**
     * Overrides the handling of unknown keys for the scope of the current object only (does not apply to children).
     */
    unknown(allow?: boolean): this;

    /**
     * Requires the presence of other keys whenever the specified key is present.
     */
    with(key: string, peers: string | string[], options?: DependencyOptions): this;

    /**
     * Forbids the presence of other keys whenever the specified is present.
     */
    without(key: string, peers: string | string[], options?: DependencyOptions): this;

    /**
     * Defines an exclusive relationship between a set of keys. one of them is required but not at the same time.
     *
     * Optional settings must be the last argument.
     */
    xor(...peers: Array<string | DependencyOptions>): this;
}

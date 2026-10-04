import {AnySchema} from './AnySchema.js'
import {WhenOptions} from './WhenOptions.js'
import {WhenSchemaOptions} from './WhenSchemaOptions.js'
import {SchemaLikeWithoutArray} from '../types/SchemaLikeWithoutArray.js'
import {Schema} from '../types/Schema.js'
import {Reference} from './Reference.js'

/**
 * A schema matching one of several schemas (a union), built by `DTO.Alternatives(...schemas)`: by default, the value
 * is validated against the schemas in order and the first one it matches validates it.
 * @typeParam TSchema The type of the values the schema validates.
 */
export interface AlternativesSchema<TSchema = any> extends AnySchema<TSchema> {
    /**
     * Add a conditional alternative: the schema chosen depends on the value of another key, or on whether the value
     * matches a schema. The alternatives are tried in the order they are added.
     * @param ref The key the condition reads (`'type'`, `'/root.key'`, `'$context'`), or a reference.
     * @param options The condition: `is` (a schema or a value the referenced value must match), and the schema of the
     * value when it does (`then`) or does not (`otherwise`); or a list of conditions, or a `switch`.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the schema has a `match()` mode other than `any`.
     */
    conditional(ref: string | Reference, options: WhenOptions | WhenOptions[]): this

    /**
     * Add a conditional alternative depending on whether the value itself matches a schema.
     * @param ref The schema the value is tested against.
     * @param options The schema of the value when it matches (`then`) or does not (`otherwise`).
     * @returns A new schema.
     */
    conditional(ref: Schema, options: WhenSchemaOptions): this

    /**
     * Set how many of the `try()` schemas the value must match. A mode other than `any` cannot be combined with
     * `conditional()`.
     * @param mode `any` (the default): at least one, the first matching one validates the value; `one`: exactly one;
     * `all`: every one; `none`: none of them (the value is returned as is).
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the mode is not one of these, or combined with conditions.
     */
    match(mode: 'any' | 'all' | 'one' | 'none'): this

    /**
     * Add alternatives, tried in order after the ones already added.
     * @param types The schemas the value may match.
     * @returns A new schema.
     */
    try(...types: SchemaLikeWithoutArray[]): this
}

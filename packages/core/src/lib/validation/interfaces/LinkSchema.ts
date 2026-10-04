import {AnySchema} from './AnySchema.js'
import {Schema} from '../types/Schema.js'

/**
 * A schema validating with another schema of the same schema tree, reached by its id or its path: built by
 * `DTO.Link(ref)`, for recursive schemas (a tree of categories).
 * @typeParam TSchema The type of the values the schema validates.
 */
export interface LinkSchema<TSchema = any> extends AnySchema<TSchema> {
    /**
     * Merge a schema into the linked schema, once the link is resolved during the validation (unlike `concat()` on the
     * link itself, it may add the rules of the linked type).
     * @param schema The schema to merge, of the type of the linked schema.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the link has no linked schema yet or the schema is a link; during the
     * validation, when the types cannot be merged.
     */
    concat(schema: Schema): this

    /**
     * Set the schema linked to, when the link is built without it; a link must have one before it validates.
     * @param ref The linked schema: an id (`'#node'`, set by `id()`), a path from the root of the schema (`'/a'`), or
     * a relative path (`'...'`); not the link itself, its children or another link.
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the link already has a schema.
     */
    ref(ref: string): this
}

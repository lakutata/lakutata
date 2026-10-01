import {AnySchema} from './AnySchema.js'
import {WhenOptions} from './WhenOptions.js'
import {WhenSchemaOptions} from './WhenSchemaOptions.js'
import {SchemaLikeWithoutArray} from '../types/SchemaLikeWithoutArray.js'
import {Schema} from '../types/Schema.js'
import {Reference} from './Reference.js'

export interface AlternativesSchema<TSchema = any> extends AnySchema<TSchema> {
    /**
     * Adds a conditional alternative schema type, either based on another key value, or a schema peeking into the current value.
     */
    conditional(ref: string | Reference, options: WhenOptions | WhenOptions[]): this

    conditional(ref: Schema, options: WhenSchemaOptions): this

    /**
     * Requires the validated value to match a specific set of the provided alternative.try() schemas:
     * `'any'` (the default), `'one'`, `'all'`, or `'none'` (the value must not match any of them).
     * Cannot be combined with `alternatives.conditional()`.
     */
    match(mode: 'any' | 'all' | 'one' | 'none'): this

    /**
     * Adds an alternative schema type for attempting to match against the validated value.
     */
    try(...types: SchemaLikeWithoutArray[]): this
}

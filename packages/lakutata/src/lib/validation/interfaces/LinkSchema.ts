import {AnySchema} from './AnySchema.js'
import {Schema} from '../types/Schema.js'

export interface LinkSchema<TSchema = any> extends AnySchema<TSchema> {
    /**
     * Same as `any.concat()` but the schema is merged after the link is resolved which allows merging with schemas of the same type as the resolved link.
     * Will throw an exception during validation if the merged types are not compatible.
     */
    concat(schema: Schema): this;

    /**
     * Initializes the schema after constructions for cases where the schema has to be constructed first and then initialized.
     * If `ref` was not passed to the constructor, `link.ref()` must be called prior to usage.
     */
    ref(ref: string): this;
}

import {AnySchema} from './AnySchema.js'
import {Reference} from './Reference.js'

export interface BinarySchema<TSchema = Buffer> extends AnySchema<TSchema> {
    /**
     * Sets the string encoding format if a string input is converted to a buffer.
     */
    encoding(encoding: string): this;

    /**
     * Specifies the minimum length of the buffer.
     */
    min(limit: number | Reference): this;

    /**
     * Specifies the maximum length of the buffer.
     */
    max(limit: number | Reference): this;

    /**
     * Specifies the exact length of the buffer:
     */
    length(limit: number | Reference): this;
}

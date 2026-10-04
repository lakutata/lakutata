import {AnySchema} from './AnySchema.js'
import {Reference} from './Reference.js'

/**
 * A schema of `Buffer`s, built by `DTO.Binary()`: their length in bytes. With conversion enabled (`strict(false)`),
 * strings are accepted and converted to buffers (see `encoding()`).
 * @typeParam TSchema The type of the buffers the schema validates.
 */
export interface BinarySchema<TSchema = Buffer> extends AnySchema<TSchema> {
    /**
     * Set the encoding of the strings converted to buffers, with conversion enabled (`strict(false)`).
     * @param encoding A Node.js buffer encoding: `'base64'`, `'hex'`, `'utf8'`… Defaults to `utf8`.
     * @returns A new schema.
     */
    encoding(encoding: string): this

    /**
     * Require a minimum length.
     * @param limit The minimum length (inclusive) in bytes, or a reference to another value holding it.
     * @returns A new schema.
     */
    min(limit: number | Reference): this

    /**
     * Require a maximum length.
     * @param limit The maximum length (inclusive) in bytes, or a reference to another value holding it.
     * @returns A new schema.
     */
    max(limit: number | Reference): this

    /**
     * Require an exact length.
     * @param limit The length in bytes, or a reference to another value holding it.
     * @returns A new schema.
     */
    length(limit: number | Reference): this
}

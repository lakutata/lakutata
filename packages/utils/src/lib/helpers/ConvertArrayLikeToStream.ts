import {ConvertArrayLikeToIterable} from './ConvertArrayLikeToIterable.js'
import {ReadableOptions, Stream, Readable as ReadableStream} from 'node:stream'

/**
 * Create a readable stream of the bytes of a buffer, one byte per chunk as a number (see
 * {@link ConvertArrayLikeToIterable}). The stream is in object mode by default: a byte stream cannot be piped into a
 * byte sink (a file, a socket), and `objectMode: false` makes it fail with an `ERR_INVALID_ARG_TYPE` error, emitted by
 * the stream, as its chunks are numbers. To stream the buffer as bytes, use `Readable.from([buffer])` instead.
 * @param inp The buffer to stream; an empty buffer gives a stream ending at once.
 * @param options The options of the stream (`Readable.from`): `objectMode` defaults to `true`, `highWaterMark` counts
 * chunks (16 by default).
 * @returns A readable stream of the bytes, as numbers.
 * @example
 * ```typescript
 * import {ConvertArrayLikeToStream} from 'lakutata/utils'
 *
 * const bytes: number[] = []
 * for await (const byte of ConvertArrayLikeToStream(Buffer.from('hi'))) bytes.push(byte)
 * console.log(bytes)
 * //[104, 105]
 * ```
 */
export function ConvertArrayLikeToStream(inp: Buffer, options?: ReadableOptions): ReadableStream
/**
 * Create a readable stream of the elements of a typed array, one element per chunk as a number (a bigint for the
 * `BigInt64Array`), in object mode by default (see {@link ConvertArrayLikeToIterable}): `objectMode: false` makes the
 * stream fail with an `ERR_INVALID_ARG_TYPE` error, emitted by the stream, as its chunks are not bytes.
 * @param inp The typed array to stream; an empty one gives a stream ending at once.
 * @param options The options of the stream (`Readable.from`): `objectMode` defaults to `true`, `highWaterMark` counts
 * chunks (16 by default).
 * @returns A readable stream of the elements.
 * @example
 * ```typescript
 * import {ConvertArrayLikeToStream} from 'lakutata/utils'
 *
 * const values: number[] = []
 * for await (const value of ConvertArrayLikeToStream(new Uint16Array([1, 500]))) values.push(value)
 * console.log(values)
 * //[1, 500]
 * ```
 */
export function ConvertArrayLikeToStream(inp: NodeJS.TypedArray, options?: ReadableOptions): ReadableStream
/**
 * Create a readable stream of the characters of a string, one UTF-16 code unit per chunk (an emoji gives its two
 * surrogate halves in two chunks, see {@link ConvertArrayLikeToIterable}), in object mode by default. With
 * `objectMode: false` each chunk is converted into its UTF-8 bytes, and a lone surrogate half into the replacement
 * character `U+FFFD`.
 * @param inp The string to stream; an empty string gives a stream ending at once.
 * @param options The options of the stream (`Readable.from`): `objectMode` defaults to `true`, `highWaterMark` counts
 * chunks (16 by default) in object mode.
 * @returns A readable stream of the characters.
 * @example
 * ```typescript
 * import {ConvertArrayLikeToStream} from 'lakutata/utils'
 *
 * const chunks: string[] = []
 * for await (const chunk of ConvertArrayLikeToStream('abc')) chunks.push(chunk)
 * console.log(chunks)
 * //['a', 'b', 'c']
 * ```
 */
export function ConvertArrayLikeToStream(inp: string, options?: ReadableOptions): ReadableStream
export function ConvertArrayLikeToStream(inp: any, options?: ReadableOptions): ReadableStream {
    options = options ? options : {}
    return Stream.Readable.from(ConvertArrayLikeToIterable(inp), options)
}

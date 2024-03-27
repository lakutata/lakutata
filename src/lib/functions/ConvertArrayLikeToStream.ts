import {ConvertArrayLikeToIterable} from './ConvertArrayLikeToIterable.js'
import {ReadableOptions, Stream, Readable as ReadableStream} from 'node:stream'

/**
 * Convert buffer to readable stream
 * @param inp
 * @param options
 * @constructor
 */
export function ConvertArrayLikeToStream(inp: Buffer, options?: ReadableOptions): ReadableStream
/**
 * Convert typed-array to readable stream
 * @param inp
 * @param options
 * @constructor
 */
export function ConvertArrayLikeToStream(inp: NodeJS.TypedArray, options?: ReadableOptions): ReadableStream
/**
 * Convert string to readable stream
 * @param inp
 * @param options
 * @constructor
 */
export function ConvertArrayLikeToStream(inp: string, options?: ReadableOptions): ReadableStream
export function ConvertArrayLikeToStream(inp: any, options?: ReadableOptions): ReadableStream {
    options = options ? options : {}
    return Stream.Readable.from(ConvertArrayLikeToIterable(inp), options)
}

/**
 * Iterate over the items of a string, a buffer or a typed array, one by one by index: the UTF-16 code units of a string
 * (as strings of one character, so an emoji gives its two surrogate halves), the bytes of a buffer and the elements of
 * a typed array (as numbers, bigints for the `BigInt64Array`). The items are read lazily, so a change made to a buffer
 * during the iteration is seen by it.
 * @param input The string, buffer or typed array to iterate over; an empty one yields nothing.
 * @returns A generator of the items.
 * @example
 * ```typescript
 * import {convertArrayLikeToIterable} from 'lakutata/utils'
 *
 * console.log([...convertArrayLikeToIterable('abc')], [...convertArrayLikeToIterable(Buffer.from('hi'))])
 * //['a', 'b', 'c'] [104, 105]
 * ```
 */
export function* convertArrayLikeToIterable(input: string | Buffer | NodeJS.TypedArray): Generator {
    for (let i: number = 0; i < input.length; i++) yield input[i]
}

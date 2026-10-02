/**
 * Convert array-like input to iterable
 * @param input
 * @constructor
 */
export function* ConvertArrayLikeToIterable(input: string | Buffer | NodeJS.TypedArray): Generator {
    for (let i: number = 0; i < input.length; i++) yield input[i]
}

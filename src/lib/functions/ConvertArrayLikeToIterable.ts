/**
 * Convert array-like input to iterable
 * @param inp
 * @constructor
 */
export function* ConvertArrayLikeToIterable(inp: string | Buffer | NodeJS.TypedArray): Generator {
    for (let i = 0; i < inp.length; i++) yield inp[i]
}

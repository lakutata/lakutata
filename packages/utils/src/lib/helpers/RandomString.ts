import {getRandomValues} from 'node:crypto'

//Self-implemented on node:crypto (replaces the `randomstring` package dependency).

const CHARSETS: Record<string, string> = {
    alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    alphabetic: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    numeric: '0123456789',
    hex: '0123456789abcdef',
    binary: '01',
    octal: '01234567'
}

/**
 * Generate a random string of 32 letters and digits (`[A-Za-z0-9]`), drawn from the cryptographic random generator.
 * @returns A new random string.
 * @remarks Each character is picked uniformly from the character set (the random values which would bias the pick are
 * drawn again), so the strings are fit for tokens and secrets.
 * @example
 * ```typescript
 * import {randomString} from 'lakutata/utils'
 *
 * console.log(randomString().length, randomString(6, 'numeric').length)
 * //32 6
 * console.log(/^[0-9a-f]{16}$/.test(randomString(16, 'hex')))
 * //true
 * console.log(/^[0-9XYZ]{10}$/.test(randomString(10, ['numeric', 'XYZ'])))
 * //true
 * ```
 */
export function randomString(): string
/**
 * Generate a random string of letters and digits (`[A-Za-z0-9]`) of a given length.
 * @param length The number of characters: a non-negative integer (`0` gives `''`).
 * @returns A new random string.
 * @throws {RangeError} When `length` is negative or not an integer.
 */
export function randomString(length: number): string
/**
 * Generate a random string of a given length from a character set: one of the named sets (`'alphanumeric'`,
 * `'alphabetic'`, `'numeric'`, `'hex'`, `'binary'`, `'octal'`), or any other string, taken as the list of its
 * characters (`'ABC123'`; a character repeated in it is picked more often).
 * @param length The number of characters: a non-negative integer (`0` gives `''`).
 * @param charset A named set, or the characters to pick from, not empty. The characters are the code points of the
 * string: a character outside the Basic Multilingual Plane (an emoji) is picked whole.
 * @returns A new random string.
 * @throws {RangeError} When `length` is negative or not an integer, or when `charset` is empty.
 */
export function randomString(length: number, charset: string): string
/**
 * Generate a random string of letters and digits (`[A-Za-z0-9]`) of a given length.
 * @param length The number of characters: a non-negative integer.
 * @param charset `'alphanumeric'`.
 * @returns A new random string.
 * @throws {RangeError} When `length` is negative or not an integer.
 */
export function randomString(length: number, charset: 'alphanumeric'): string
/**
 * Generate a random string of letters (`[A-Za-z]`) of a given length.
 * @param length The number of characters: a non-negative integer.
 * @param charset `'alphabetic'`.
 * @returns A new random string.
 * @throws {RangeError} When `length` is negative or not an integer.
 */
export function randomString(length: number, charset: 'alphabetic'): string
/**
 * Generate a random string of decimal digits (`[0-9]`) of a given length; it may start with `0`.
 * @param length The number of characters: a non-negative integer.
 * @param charset `'numeric'`.
 * @returns A new random string.
 * @throws {RangeError} When `length` is negative or not an integer.
 */
export function randomString(length: number, charset: 'numeric'): string
/**
 * Generate a random string of lower case hexadecimal digits (`[0-9a-f]`) of a given length.
 * @param length The number of characters: a non-negative integer.
 * @param charset `'hex'`.
 * @returns A new random string.
 * @throws {RangeError} When `length` is negative or not an integer.
 */
export function randomString(length: number, charset: 'hex'): string
/**
 * Generate a random string of binary digits (`[01]`) of a given length.
 * @param length The number of characters: a non-negative integer.
 * @param charset `'binary'`.
 * @returns A new random string.
 * @throws {RangeError} When `length` is negative or not an integer.
 */
export function randomString(length: number, charset: 'binary'): string
/**
 * Generate a random string of octal digits (`[0-7]`) of a given length.
 * @param length The number of characters: a non-negative integer.
 * @param charset `'octal'`.
 * @returns A new random string.
 * @throws {RangeError} When `length` is negative or not an integer.
 */
export function randomString(length: number, charset: 'octal'): string
/**
 * Generate a random string of a given length from several character sets joined: each item is a named set
 * (`'numeric'`…) or a string of characters (`['numeric', 'XYZ']` picks from `0-9XYZ`). The bigger sets are picked from
 * more often; no set is guaranteed to appear.
 * @param length The number of characters: a non-negative integer.
 * @param charset The named sets and the strings of characters (their code points); their union must not be empty.
 * @returns A new random string.
 * @throws {RangeError} When `length` is negative or not an integer, or when the union of the sets is empty.
 */
export function randomString(length: number, charset: ('alphanumeric' | 'alphabetic' | 'numeric' | 'hex' | 'binary' | 'octal' | string)[]): string
export function randomString(length: number = 32, charset: string | string[] = 'alphanumeric'): string {
    if (!Number.isInteger(length) || length < 0) throw new RangeError(`Invalid length: ${length}, a non-negative integer is expected`)
    //The named sets by an own property only: 'toString' is a string of characters, not a method of Object.prototype
    const charsetOf = (name: string): string => Object.hasOwn(CHARSETS, name) ? CHARSETS[name] : name
    const chars: string[] = [...(Array.isArray(charset) ? charset.map(charsetOf).join('') : charsetOf(charset))]
    if (!chars.length) throw new RangeError('The character set is empty')
    //The random values from the largest multiple of the set's size below 2^32: the ones above it are drawn again,
    //otherwise the first characters would come up more often
    const limit: number = 2 ** 32 - (2 ** 32 % chars.length)
    const picked: string[] = []
    while (picked.length < length) {
        const values: Uint32Array = getRandomValues(new Uint32Array(Math.min(length - picked.length, 16384)))
        for (const value of values) if (value < limit) picked.push(chars[value % chars.length])
    }
    return picked.join('')
}

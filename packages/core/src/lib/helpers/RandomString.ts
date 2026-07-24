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
 * Generate a random string
 * @constructor
 */
export function RandomString(): string
/**
 * Generate a random string of specified length
 * @param length
 * @constructor
 */
export function RandomString(length: number): string
/**
 * Generates a string of specified length containing only characters within the character set
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: string): string
/**
 * Generate a random string of specified length containing only [0-9 a-z A-Z]
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: 'alphanumeric'): string
/**
 * Generate a random string of specified length containing only [a-z A-Z]
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: 'alphabetic'): string
/**
 * Generate a random string of specified length containing only [0-9]
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: 'numeric'): string
/**
 * Generate a random string of specified length containing only [0-9 a-f]
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: 'hex'): string
/**
 * Generate a random string of specified length containing only [01]
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: 'binary'): string
/**
 * Generate a random string of specified length containing only [0-7]
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: 'octal'): string
/**
 * Generates a string of specified length containing only character rules within the character set array
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: ('alphanumeric' | 'alphabetic' | 'numeric' | 'hex' | 'binary' | 'octal' | string)[]): string
export function RandomString(length: number = 32, charset: string | string[] = 'alphanumeric'): string {
    const chars: string = Array.isArray(charset)
        ? charset.map((c: string): string => CHARSETS[c] ?? c).join('')
        : (CHARSETS[charset] ?? charset)
    const bytes: Uint8Array = new Uint8Array(length)
    getRandomValues(bytes)
    let result: string = ''
    for (let i = 0; i < length; i++) result += chars[bytes[i] % chars.length]
    return result
}

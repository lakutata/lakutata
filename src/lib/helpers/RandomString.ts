import randomString from 'randomstring'
import {As} from './As.js'

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
 * Generate a string of specified length containing only [0-9 a-z A-Z]
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: 'alphanumeric'): string
/**
 * Generate a string of specified length containing only [a-z A-Z]
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: 'alphabetic'): string
/**
 * Generate a string of specified length containing only [0-9]
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: 'numeric'): string
/**
 * Generate a string of specified length containing only [0-9 a-f]
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: 'hex'): string
/**
 * Generate a string of specified length containing only [01]
 * @param length
 * @param charset
 * @constructor
 */
export function RandomString(length: number, charset: 'binary'): string
/**
 * Generate a string of specified length containing only [0-7]
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
export function RandomString(length?: number, charset?: string | string[]): string {
    return randomString.generate({
        length: length !== undefined ? length : 32,
        charset: As<string>(charset !== undefined ? charset : 'alphanumeric')
    })
}

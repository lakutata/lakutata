import {RandomString} from './RandomString.js'

/**
 * Generate a random string of length 32
 * @constructor
 */
export function NonceString(): string {
    return RandomString(32, 'alphanumeric')
}

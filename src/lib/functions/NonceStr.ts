import {RandomString} from './RandomString.js'

/**
 * Generate a random string of length 32
 * @constructor
 */
export function NonceStr(): string {
    return RandomString(32, 'alphanumeric')
}

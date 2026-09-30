import {Buffer} from 'node:buffer'

/**
 * The stored form of a cache entry
 * The strings starting with a colon get one more colon, the buffers are written as ":base64:" strings (the format of 2.x)
 */
export type CacheEntry<T = unknown> = {
    value: T
    expires?: number
}

const COLON: number = 58

const BASE64_PREFIX: string = ':base64:'

//A string value starting with a colon follows an unquoted ":", "[" or ","
const ESCAPED_STRING: RegExp = /[:[,]\s*":/

/**
 * Encode the values the JSON form cannot keep
 * @param this
 * @param key
 * @param value
 */
function replacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
    if (typeof value === 'string') return value.charCodeAt(0) === COLON ? `:${value}` : value
    if (value !== null && typeof value === 'object' && Buffer.isBuffer(this[key])) return `${BASE64_PREFIX}${(this[key] as Buffer).toString('base64')}`
    return value
}

/**
 * Decode the values encoded by the replacer
 * @param key
 * @param value
 */
function reviver(key: string, value: unknown): unknown {
    if (typeof value !== 'string' || value.charCodeAt(0) !== COLON) return value
    return value.startsWith(BASE64_PREFIX) ? Buffer.from(value.slice(BASE64_PREFIX.length), 'base64') : value.slice(1)
}

/**
 * Serialize data
 * @param data
 */
export function Serialize(data: unknown): string {
    return JSON.stringify(data, replacer) ?? 'null'
}

/**
 * Deserialize data
 * @param text
 */
export function Deserialize<T = unknown>(text: string): T {
    return ESCAPED_STRING.test(text) ? JSON.parse(text, reviver) : JSON.parse(text)
}

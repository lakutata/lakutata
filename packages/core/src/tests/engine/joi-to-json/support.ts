/**
 * Test support for the joi-to-json tests ported from joi-to-json 5.0.0 (MIT, see THIRD_PARTY_NOTICES.md): the upstream
 * data files (read from the source tree, as the compiler does not copy them) and jest's toEqual() semantics
 */
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {expect} from '../support/Expect.js'

//The compiled tests run from dist/esm/tests/engine/joi-to-json, the data stays in src/tests/engine/joi-to-json/data
const dataDir: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../src/tests/engine/joi-to-json/data')

/**
 * The parsed content of a JSON data file (a new object on each call)
 * @param file path relative to the data directory
 */
export function readJson(file: string): unknown {
    return JSON.parse(readFileSync(path.join(dataDir, file), 'utf8'))
}

/**
 * The entries of a data directory
 * @param dir path relative to the data directory
 */
export function listData(dir: string): string[] {
    return readdirSync(path.join(dataDir, dir))
}

/**
 * Whether a data file exists
 * @param file path relative to the data directory
 */
export function hasData(file: string): boolean {
    return existsSync(path.join(dataDir, file))
}

/**
 * A copy of a value without the object properties which are undefined (recursively), which jest's toEqual() ignores
 * @param value
 */
function withoutUndefined(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(withoutUndefined)
    if (value === null || typeof value !== 'object' || value instanceof Date || value instanceof RegExp) return value
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
        if (item !== undefined) result[key] = withoutUndefined(item)
    }
    return result
}

/**
 * Assert deep equality like jest's toEqual(): undefined properties and object types are ignored
 * @param actual
 * @param expected
 */
export function toEqual(actual: unknown, expected: unknown): void {
    expect(withoutUndefined(actual)).to.equal(withoutUndefined(expected))
}

/**
 * A shallow copy of an object without some keys (replaces lodash's omit() in the tests)
 * @param object
 * @param keys
 */
export function omit(object: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(object)) {
        if (!keys.includes(key)) result[key] = object[key]
    }
    return result
}

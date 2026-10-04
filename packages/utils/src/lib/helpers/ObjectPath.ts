/**
 * The keys of a path which would reach a prototype
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Read, write and test the nested properties of an object by a path: the keys separated by dots, the array indexes as
 * keys or in brackets (`'user.addresses[0].city'` is `'user.addresses.0.city'`). Only the bracketed word characters are
 * recognized: `a["b"]` and the keys holding a dot cannot be addressed. Its methods are static. `set`, its only writing method,
 * refuses the paths through `__proto__`, `constructor` or `prototype`, which would modify the prototypes of the objects.
 * @example
 * ```typescript
 * import {ObjectPath} from 'lakutata/utils'
 *
 * const config: Record<string, any> = {db: {hosts: [{name: 'primary', port: 5432}]}}
 * console.log(ObjectPath.get<number>(config, 'db.hosts[0].port'), ObjectPath.has(config, 'db.user'))
 * //5432 false
 * ObjectPath.set(config, 'db.user.name', 'admin')
 * console.log(config.db.user)
 * //{name: 'admin'}
 * ```
 */
export class ObjectPath {

    /**
     * Split a path into its keys: the bracketed indexes become keys (`'a[0].b'` gives `['a', '0', 'b']`).
     * @param path The path. An empty path gives the single key `''`.
     * @returns The keys, in order.
     */
    protected static getPathKeys(path: string): string[] {
        return path.replace(/\[(\w+)\]/g, '.$1').split('.')
    }

    /**
     * Get the value at a path.
     * @param obj The object to read.
     * @param path The path of the value (`'a.b[0].c'`).
     * @returns The value, or `undefined` when a key along the path is missing or its value is `null` or `undefined`.
     * The value is returned as is, not checked against `T`.
     */
    public static get<T>(obj: Record<string, any>, path: string): T | undefined {
        const keys: string[] = this.getPathKeys(path)
        let result: any = obj
        for (const key of keys) {
            if (result == null) return undefined
            result = result[key]
        }
        return result as T
    }

    /**
     * Set the value at a path, modifying the object: the missing intermediate keys are created as plain objects (also
     * for numeric keys: `'list[0]'` creates `{0: ...}`, not an array), and an intermediate primitive value is replaced
     * by an object.
     * @param obj The object to modify.
     * @param path The path of the value (`'a.b[0].c'`). A key `__proto__`, `constructor` or `prototype` anywhere in it
     * is refused, so that a path coming from user input cannot modify the prototype of every object.
     * @param value The value to set. `undefined` is ignored: the object is left unchanged (the existing value is kept).
     * @throws {TypeError} When an intermediate value is `null`, or when the path has a key `__proto__`, `constructor` or
     * `prototype` (the object is left unchanged).
     */
    public static set(obj: Record<string, any>, path: string, value: any): void {
        const keys: string[] = this.getPathKeys(path)
        //Refused before anything is written, whatever the value
        const forbidden: string | undefined = keys.find((key: string): boolean => FORBIDDEN_KEYS.has(key))
        if (forbidden !== undefined) throw new TypeError(`The key "${forbidden}" is not allowed in the path "${path}"`)
        if (value === undefined) return
        let current: Record<string, any> = obj
        for (let i: number = 0; i < keys.length - 1; i++) {
            const key: string = keys[i]
            if (typeof current[key] !== 'object') current[key] = {}
            current = current[key]
        }
        current[keys[keys.length - 1]] = value
    }

    /**
     * Tell whether a path exists: each of its keys is in the value before it (as an own or inherited property, the `in`
     * operator), even when the final value is `undefined`.
     * @param obj The object to test.
     * @param path The path to test (`'a.b[0].c'`).
     * @returns `true` when the whole path exists, `false` when a key is missing or a value along it is `null` or
     * `undefined`.
     * @throws {TypeError} When a value along the path is a primitive (a string, a number) which is not the last one.
     */
    public static has(obj: Record<string, any>, path: string): boolean {
        const keys: string[] = this.getPathKeys(path)
        let current: Record<string, any> = obj
        for (const key of keys) {
            if (current == null || !(key in current)) return false
            current = current[key]
        }
        return true
    }
}
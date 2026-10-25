import type {NativeFunctionOptions} from '../lib/library/NativeLibraryHandle.js'

/**
 * A member of a library class: a function, or a variable
 */
export type NativeMember =
    | { readonly kind: 'function', readonly declaration?: string, readonly options: NativeFunctionOptions }
    | { readonly kind: 'variable', readonly declaration?: string }

const members: WeakMap<object, Map<string, NativeMember>> = new WeakMap()

/**
 * Record a member on the prototype of a class
 * @param target
 * @param key
 * @param member
 */
function record(target: object, key: string | symbol, member: NativeMember): void {
    if (typeof key !== 'string') throw new TypeError('A native function or variable is declared on a property with a string name')
    let own: Map<string, NativeMember> | undefined = members.get(target)
    if (!own) members.set(target, own = new Map())
    own.set(key, member)
}

/**
 * Declare a function of the library on a property of a `NativeLibrary` subclass: the property gets the function once
 * the component is created (the function of koffi itself when nothing is converted), and a function throwing once it
 * is destroyed. The TypeScript type of the property is the one of the function.
 * @param declaration Its C prototype (`int sqlite3_open(const char *filename, _Out_ sqlite3 **db)`), or the name of a
 * function of the declarations of the library; by default the function of the declarations named as the property.
 * @param options Whether it runs in a thread of the pool (returning a promise), the function freeing the strings it
 * gives, its 64-bit integers as numbers.
 * @returns The property decorator.
 * @example
 * ```typescript
 * import {Library, Native, NativeLibrary, type Out, type Pointer} from '@lakutata/ffi'
 *
 * @Library({
 *     names: {darwin: 'libsqlite3.dylib', linux: 'libsqlite3.so.0', win32: 'winsqlite3.dll'},
 *     declarations: `
 *         typedef struct sqlite3 sqlite3;
 *         int sqlite3_close(sqlite3 *db);
 *     `
 * })
 * export class SQLite extends NativeLibrary {
 *     @Native('int sqlite3_open(const char *filename, _Out_ sqlite3 **db)')
 *     public readonly open: (filename: string, db: Out<Pointer>) => number
 *
 *     //The function of the declarations named as the property
 *     @Native()
 *     public readonly sqlite3_close: (db: Pointer) => number
 *
 *     @Native('int sqlite3_exec(sqlite3 *db, const char *sql, void *callback, void *context, _Out_ char **error)', {async: true, free: 'sqlite3_free'})
 *     public readonly exec: (db: Pointer, sql: string, callback: null, context: null, error: Out<string>) => Promise<number>
 * }
 * ```
 */
export function Native(declaration?: string, options: NativeFunctionOptions = {}): (target: object, key: string | symbol) => void {
    return (target: object, key: string | symbol): void => record(target, key, {kind: 'function', declaration: declaration, options: options})
}

/**
 * Declare a variable the library exports on a property of a `NativeLibrary` subclass: reading the property reads the
 * variable, writing it writes the variable (refused for a const one).
 * @param declaration Its declaration (`extern const char sqlite3_version[]`), or the name of a variable of the
 * declarations of the library; by default the variable of the declarations named as the property.
 * @returns The property decorator.
 * @example
 * ```typescript
 * import {Library, NativeLibrary, NativeVariable} from '@lakutata/ffi'
 *
 * @Library({names: {darwin: 'libsqlite3.dylib', linux: 'libsqlite3.so.0', win32: 'winsqlite3.dll'}})
 * export class SQLiteVersion extends NativeLibrary {
 *     @NativeVariable('extern const char sqlite3_version[]')
 *     public readonly version: string
 * }
 * ```
 */
export function NativeVariable(declaration?: string): (target: object, key: string | symbol) => void {
    return (target: object, key: string | symbol): void => record(target, key, {kind: 'variable', declaration: declaration})
}

/**
 * The native members of a class and of its parent classes (a subclass replacing a member of its parent)
 * @param prototype
 */
export function nativeMembersOf(prototype: object): Map<string, NativeMember> {
    const chain: object[] = []
    for (let current: object | null = prototype; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) chain.unshift(current)
    const all: Map<string, NativeMember> = new Map()
    for (const current of chain) for (const [key, member] of members.get(current) ?? []) all.set(key, member)
    return all
}

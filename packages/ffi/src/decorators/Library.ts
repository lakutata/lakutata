import type {LibraryNames} from '../lib/library/Resolve.js'

/**
 * What a library is: its file names, where it is looked for, its C declarations
 */
export interface LibraryOptions {
    /**
     * Its file names: one (`sqlite3`, completed as each platform names libraries: `libsqlite3.dylib`, `libsqlite3.so`,
     * `sqlite3.dll`), or one by platform (`{darwin: 'libsqlite3.dylib', linux: 'libsqlite3.so.0', win32:
     * 'winsqlite3.dll'}`, `default` for the others); `c` for the C library, `m` for its mathematical functions.
     */
    names: LibraryNames
    /**
     * The directories it is looked for in before the ones of the system, in their order (aliases of the application
     * allowed). The ones of the configuration come first.
     */
    search?: string[]
    /**
     * Its C declarations, as its headers write them: the types its functions use, its functions, its variables, its
     * constants (enumerations, #define of integers).
     */
    declarations?: string
    /**
     * On Windows, the C library its functions use, whose errno `errno()` reads.
     * @default 'ucrtbase.dll'
     */
    crt?: string
}

const libraries: WeakMap<Function, LibraryOptions> = new WeakMap()

/**
 * Declare a native library on a `NativeLibrary` subclass: its file names, the directories it is looked for in, its C
 * declarations. Its functions are declared on its properties by `@Native`, its variables by `@NativeVariable`.
 * @param options Its names, its search directories, its declarations.
 * @returns The class decorator.
 * @example
 * ```typescript
 * import {Library, Native, NativeLibrary} from '@lakutata/ffi'
 *
 * @Library({
 *     names: {darwin: 'libz.dylib', linux: 'libz.so.1', win32: 'zlib1.dll'},
 *     declarations: 'typedef unsigned long uLong;'
 * })
 * export class Zlib extends NativeLibrary {
 *     @Native('const char *zlibVersion(void)')
 *     public readonly zlibVersion: () => string
 *
 *     @Native('uLong crc32(uLong crc, const unsigned char *buffer, unsigned int length)')
 *     public readonly crc32: (crc: bigint | number, buffer: Buffer, length: number) => bigint
 * }
 * ```
 */
export function Library(options: LibraryOptions): (target: Function) => void {
    return (target: Function): void => {
        libraries.set(target, options)
    }
}

/**
 * The library declared on a class or on the nearest of its parent classes
 * @param target
 */
export function libraryOptionsOf(target: Function): LibraryOptions | undefined {
    for (let current: Function | null = target; current && current !== Function.prototype; current = Object.getPrototypeOf(current)) {
        const options: LibraryOptions | undefined = libraries.get(current)
        if (options) return options
    }
    return undefined
}

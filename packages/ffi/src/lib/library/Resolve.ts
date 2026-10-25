import {existsSync, readdirSync} from 'node:fs'
import path from 'node:path'
import koffi, {type LibraryHandle} from 'koffi'
import {NativeLibraryNotFoundException} from '../../exceptions/NativeLibraryNotFoundException.js'

/**
 * The file of a library: one name for every platform, or one by platform (the names of process.platform, `default`
 * for the others). A name without a directory and without an extension is completed as the platform names its
 * libraries (`sqlite3`: `libsqlite3.dylib`, `libsqlite3.so`, `sqlite3.dll`); `c` and `m` are the C library and its
 * mathematical functions, found where each system has them
 */
export type LibraryNames = string | Partial<Record<NodeJS.Platform | 'default', string | readonly string[]>>

/**
 * Where a library is looked for
 */
export interface ResolveOptions {
    /**
     * The file itself: the only one tried when given (an alias of the application can start it)
     */
    readonly path?: string
    /**
     * The directories tried first, in their order
     */
    readonly search?: readonly string[]
    /**
     * The directory of the libraries of a packaged application, tried after the search directories
     */
    readonly packaged?: string
}

/**
 * The file of the dynamic loader of musl, which holds its C library (Alpine has no libc.so.6)
 */
function muslLoader(): string | undefined {
    try {
        const loader: string | undefined = readdirSync('/lib').find((name: string): boolean => /^ld-musl-.*\.so\.1$/.test(name))
        return loader ? `/lib/${loader}` : undefined
    } catch {
        return undefined
    }
}

/**
 * The file of the C library (c) or of its mathematical functions (m) on a system
 * @param name
 * @param os
 */
function systemLibrary(name: 'c' | 'm', os: NodeJS.Platform): string {
    switch (os) {
        case 'darwin':
            return '/usr/lib/libSystem.B.dylib'
        case 'win32':
            return 'ucrtbase.dll'
        case 'linux':
            return muslLoader() ?? (name === 'c' ? 'libc.so.6' : 'libm.so.6')
        case 'freebsd':
            return name === 'c' ? 'libc.so.7' : 'libm.so.5'
        default:
            return name === 'c' ? 'libc.so' : 'libm.so'
    }
}

/**
 * The file names a name gives on a system: the name itself when it has a directory or an extension, else the names the
 * system gives libraries
 * @param name
 * @param os
 */
export function fileNames(name: string, os: NodeJS.Platform = process.platform): string[] {
    if (name === 'c' || name === 'm') return [systemLibrary(name, os)]
    if (/[/\\]/.test(name) || /\.(dylib|dll|so)(\.\d+)*$/i.test(name)) return [name]
    switch (os) {
        case 'darwin':
            return [`lib${name}.dylib`, `${name}.dylib`]
        case 'win32':
            return [`${name}.dll`, `lib${name}.dll`]
        default:
            return [`lib${name}.so`, `${name}.so`]
    }
}

/**
 * The names of a library on a system
 * @param names
 * @param os
 */
export function libraryNames(names: LibraryNames, os: NodeJS.Platform = process.platform): string[] {
    if (typeof names === 'string') return fileNames(names, os)
    const given: string | readonly string[] | undefined = names[os] ?? names.default
    if (given === undefined) throw new NativeLibraryNotFoundException(`The library has no name for ${os} (give one for ${os}, or a default)`)
    return (typeof given === 'string' ? [given] : given).flatMap((name: string): string[] => fileNames(name, os))
}

/**
 * Load a library: the file given; else each name in the search directories, in the directory of a packaged
 * application, then where the system looks for libraries (dlopen, LoadLibrary)
 * @param names
 * @param options
 * @returns The library and the file it was loaded from.
 */
export function loadLibrary(names: LibraryNames, options: ResolveOptions = {}): { library: LibraryHandle, file: string } {
    const attempts: string[] = []
    const attempt = (file: string): LibraryHandle | undefined => {
        try {
            return koffi.load(file)
        } catch (error) {
            attempts.push(`${file}: ${(error as Error).message}`)
            return undefined
        }
    }
    if (options.path) {
        const file: string = path.resolve(options.path)
        const library: LibraryHandle | undefined = attempt(file)
        if (library) return {library: library, file: file}
        throw new NativeLibraryNotFoundException(`The library cannot be loaded:\n${attempts.join('\n')}`)
    }
    const directories: string[] = [...options.search ?? [], ...options.packaged ? [options.packaged] : []].map((directory: string): string => path.resolve(directory))
    const candidates: string[] = libraryNames(names)
    for (const candidate of candidates) {
        //A name with a directory: that file only
        if (/[/\\]/.test(candidate)) {
            const library: LibraryHandle | undefined = attempt(candidate)
            if (library) return {library: library, file: candidate}
            continue
        }
        for (const directory of directories) {
            const file: string = path.join(directory, candidate)
            if (!existsSync(file)) {
                attempts.push(`${file}: not found`)
                continue
            }
            const library: LibraryHandle | undefined = attempt(file)
            if (library) return {library: library, file: file}
        }
    }
    for (const candidate of candidates.filter((name: string): boolean => !/[/\\]/.test(name))) {
        const library: LibraryHandle | undefined = attempt(candidate)
        if (library) return {library: library, file: candidate}
    }
    const versioned: string = process.platform === 'linux' && candidates.some((name: string): boolean => name.endsWith('.so')) ? '\nOn Linux, the libraries of the system are often installed with their version only (libsqlite3.so.0): give that name.' : ''
    throw new NativeLibraryNotFoundException(`The library ${candidates.join(' or ')} cannot be loaded:\n${attempts.join('\n')}${versioned}`)
}

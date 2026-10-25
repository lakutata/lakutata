import path from 'node:path'
import {Component, type ComponentOptions, DTO, isPackaged, resourcesPath} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {libraryOptionsOf, type LibraryOptions} from '../decorators/Library.js'
import {type NativeMember, nativeMembersOf} from '../decorators/Native.js'
import {NativeDeclarationException} from '../exceptions/NativeDeclarationException.js'
import {NativeLibraryClosedException} from '../exceptions/NativeLibraryClosedException.js'
import type {NativeCallback} from '../lib/library/NativeCallback.js'
import {type NativeFunctionOptions, NativeLibraryHandle, type NativeVariableAccessor} from '../lib/library/NativeLibraryHandle.js'
import type {Pointer} from '../lib/Runtime.js'

/**
 * The options of a library in the configuration (see {@link buildNativeLibraryOptions}): where it is found, how it is
 * closed
 */
export interface NativeLibraryConfig {
    /**
     * The file of the library: the only one tried when given (an alias of the application can start it).
     */
    path?: string
    /**
     * Directories tried before the ones of `@Library`, in their order.
     */
    search?: string[]
    /**
     * Whether the library stays loaded once the component is destroyed.
     * @default false
     */
    keepLoaded?: boolean
    /**
     * How long the destruction waits for the asynchronous calls running, in milliseconds.
     * @default 10000
     */
    drainTimeout?: number
}

/**
 * A native library: a component holding a library loaded with its C declarations (`@Library`), its functions on its
 * properties (`@Native`), its variables (`@NativeVariable`). Write one subclass for each library and register it in the
 * components of the application; it is loaded when it is created, and destroyed with the application: the asynchronous
 * calls running are awaited, its callbacks released, the library unloaded.
 *
 * In a packaged application, the library is also looked for in the directory `native` of the resources (put it there
 * with `lakutata.resources` of the package.json). The exceptions thrown by its persistent callbacks are its `error`
 * events (written to the log of the application when nothing listens to them).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildNativeLibraryOptions, Library, Native, NativeLibrary, type Out, type Pointer} from '@lakutata/ffi'
 *
 * @Library({
 *     names: {darwin: 'libsqlite3.dylib', linux: 'libsqlite3.so.0', win32: 'winsqlite3.dll'},
 *     declarations: `
 *         typedef struct sqlite3 sqlite3;
 *         #define SQLITE_OK 0
 *     `
 * })
 * export class SQLite extends NativeLibrary {
 *     @Native('const char *sqlite3_libversion(void)')
 *     public readonly libversion: () => string
 *
 *     @Native('int sqlite3_open(const char *filename, _Out_ sqlite3 **db)')
 *     public readonly open: (filename: string, db: Out<Pointer>) => number
 *
 *     @Native('int sqlite3_close(sqlite3 *db)')
 *     public readonly close: (db: Pointer) => number
 * }
 *
 * Application
 *     .run(() => ({
 *         id: 'store.app',
 *         name: 'Store',
 *         components: {
 *             sqlite: buildNativeLibraryOptions(SQLite)
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const sqlite: SQLite = await app.getObject('sqlite')
 *         console.log(sqlite.libversion())
 *     })
 * ```
 */
export class NativeLibrary extends Component {

    /**
     * The file of the library: the only one tried when given.
     */
    @Configurable(DTO.String().optional())
    protected readonly path?: string

    /**
     * Directories tried before the ones of `@Library`.
     */
    @Configurable(DTO.Array().items(DTO.String()).optional())
    protected readonly search?: string[]

    /**
     * Whether the library stays loaded once the component is destroyed.
     */
    @Configurable(DTO.Boolean().optional())
    protected readonly keepLoaded?: boolean

    /**
     * How long the destruction waits for the asynchronous calls running, in milliseconds.
     */
    @Configurable(DTO.Number().min(0).optional())
    protected readonly drainTimeout?: number

    #handle?: NativeLibraryHandle

    /**
     * Load the library and bind its functions and variables to their properties.
     * @protected
     */
    protected async init(): Promise<void> {
        const library: LibraryOptions | undefined = libraryOptionsOf(this.constructor)
        if (!library) throw new NativeDeclarationException(`${this.constructor.name} has no @Library: give the names of its library and its declarations`)
        const resources: string | undefined = isPackaged() ? resourcesPath() : undefined
        this.#handle = new NativeLibraryHandle(library.names, library.declarations ?? '', {
            path: this.path,
            search: [...this.search ?? [], ...library.search ?? []],
            packaged: resources ? path.join(resources, 'native') : undefined,
            keepLoaded: this.keepLoaded,
            crt: library.crt,
            onCallbackError: (error: unknown): void => this.#callbackError(error)
        })
        for (const [key, member] of nativeMembersOf(Object.getPrototypeOf(this))) this.#bindMember(key, member)
    }

    /**
     * Close the library: the asynchronous calls running awaited, the callbacks released, the library unloaded; its
     * properties throw from then on.
     * @protected
     */
    protected async destroy(): Promise<void> {
        const handle: NativeLibraryHandle | undefined = this.#handle
        if (!handle) return
        for (const [key, member] of nativeMembersOf(Object.getPrototypeOf(this))) this.#closeMember(key, member, handle.file)
        await handle.close(this.drainTimeout ?? 10000)
    }

    /**
     * The file the library was loaded from.
     */
    public get file(): string {
        return this.#library().file
    }

    /**
     * The asynchronous calls running.
     */
    public get pending(): number {
        return this.#library().pending
    }

    /**
     * The constants of the declarations: the values of the enumerations, of the static constants and of the macros
     * whose value is an integer.
     */
    public get constants(): Readonly<Record<string, bigint>> {
        return this.#library().constants
    }

    /**
     * A function of the library bound from its prototype, besides the ones of the properties.
     * @param prototype Its C prototype, with the types of the declarations.
     * @param options Whether it is asynchronous, how its strings are freed, how its 64-bit integers are given.
     * @returns The function.
     */
    public func<T extends (...args: any[]) => any = (...args: any[]) => any>(prototype: string, options: NativeFunctionOptions = {}): T {
        return this.#library().func<T>(prototype, options)
    }

    /**
     * A variable the library exports, besides the ones of the properties.
     * @param declaration Its name in the declarations, or its declaration.
     * @returns Its address, and the functions reading and writing its value.
     */
    public variable<T = unknown>(declaration: string): NativeVariableAccessor<T> {
        return this.#library().variable<T>(declaration)
    }

    /**
     * A persistent callback: a JS function the library can call at any time, released by `release()` or when the
     * component is destroyed. Its exceptions are `error` events of the component.
     * @param type The name of a pointer-to-function type of the declarations, or its prototype.
     * @param callback The JS function.
     * @returns The callback, whose `pointer` is given to the library.
     */
    public callback(type: string, callback: (...args: any[]) => any): NativeCallback {
        return this.#library().callback(type, callback)
    }

    /**
     * Read native memory as a type of the declarations: a value, or an array of values.
     * @param pointer The address.
     * @param type The type: `int`, `struct timeval`, `char *` (a string).
     * @param count The number of values, for an array.
     * @returns The value, or the array.
     */
    public read<T = unknown>(pointer: Pointer, type: string, count?: number): T {
        return this.#library().read<T>(pointer, type, count)
    }

    /**
     * Write a value to native memory as a type of the declarations.
     * @param pointer The address.
     * @param type The type.
     * @param value The value.
     */
    public write(pointer: Pointer, type: string, value: unknown): void {
        this.#library().write(pointer, type, value)
    }

    /**
     * The size of a type of the declarations, in bytes.
     * @param type The type.
     */
    public sizeOf(type: string): number {
        return this.#library().sizeOf(type)
    }

    /**
     * The offset of a member of a struct of the declarations, in bytes.
     * @param type The struct.
     * @param member The member.
     */
    public offsetOf(type: string, member: string): number {
        return this.#library().offsetOf(type, member)
    }

    /**
     * Allocate native memory for values of a type of the declarations, which the library can keep; freed by `free()`,
     * or when the component is destroyed.
     * @param type The type.
     * @param count The number of values.
     * @returns Its address.
     */
    public alloc(type: string, count: number = 1): Pointer {
        return this.#library().alloc(type, count)
    }

    /**
     * Free memory allocated by `alloc()`.
     * @param pointer Its address.
     */
    public free(pointer: Pointer): void {
        this.#library().free(pointer)
    }

    /**
     * The errno of the last call of the thread (on Windows, the one of the C library of `@Library`, ucrtbase.dll by
     * default).
     */
    public errno(): number {
        return this.#library().errno()
    }

    /**
     * The library, once loaded
     */
    #library(): NativeLibraryHandle {
        if (!this.#handle) throw new NativeLibraryClosedException(`The library of ${this.constructor.name} is not loaded`)
        return this.#handle
    }

    /**
     * A function or a variable bound to its property
     * @param key
     * @param member
     */
    #bindMember(key: string, member: NativeMember): void {
        const handle: NativeLibraryHandle = this.#handle!
        const declaration: string = member.declaration ?? key
        const named: boolean = /^[A-Za-z_]\w*$/.test(declaration)
        if (member.kind === 'function') {
            const bound: (...args: any[]) => any = named ? handle.function(declaration, member.options) : handle.func(declaration, member.options)
            Object.defineProperty(this, key, {value: bound, writable: false, enumerable: true, configurable: true})
            return
        }
        const variable: NativeVariableAccessor = handle.variable(declaration)
        Object.defineProperty(this, key, {
            get: (): unknown => variable.get(),
            set: (value: unknown): void => variable.set(value),
            enumerable: true,
            configurable: true
        })
    }

    /**
     * A property of a closed library: throwing (an asynchronous function rejecting)
     * @param key
     * @param member
     * @param file
     */
    #closeMember(key: string, member: NativeMember, file: string): void {
        const closed = (): NativeLibraryClosedException => new NativeLibraryClosedException(`The library ${file} is closed: ${this.constructor.name}.${key} cannot be used`)
        if (member.kind === 'function') {
            const value: (...args: any[]) => any = member.options.async ? (): Promise<never> => Promise.reject(closed()) : (): never => {
                throw closed()
            }
            Object.defineProperty(this, key, {value: value, writable: false, enumerable: true, configurable: true})
            return
        }
        const fail = (): never => {
            throw closed()
        }
        Object.defineProperty(this, key, {get: fail, set: fail, enumerable: true, configurable: true})
    }

    /**
     * An exception of a persistent callback: an error event, or the log of the application when nothing listens
     * @param error
     */
    #callbackError(error: unknown): void {
        if (this.listenerCount('error')) {
            this.emit('error', error)
            return
        }
        const message: string = `A callback of the native library ${this.#handle?.file ?? this.constructor.name} threw`
        this.getModule().getObject('log').then(
            (log: unknown): void => (log as { error: (error: unknown, message: string) => void }).error(error, message),
            (): void => console.error(`${message}:`, error)
        )
    }
}

/**
 * Build the declaration of a library component, for the `components` of an application.
 * @param library The `NativeLibrary` subclass of the library.
 * @param options Where it is found (a file, directories searched first), whether it stays loaded, how long its
 * destruction waits for its asynchronous calls.
 * @returns The component declaration.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildNativeLibraryOptions, Library, Native, NativeLibrary} from '@lakutata/ffi'
 *
 * @Library({names: 'vendor'})
 * class Vendor extends NativeLibrary {
 *     @Native('int vendor_version(void)')
 *     public readonly version: () => number
 * }
 *
 * Application.run(() => ({
 *     id: 'devices.app',
 *     name: 'Devices',
 *     components: {
 *         //The library shipped with the application: an alias, or a path relative to the working directory
 *         vendor: buildNativeLibraryOptions(Vendor, {search: ['@data/native']})
 *     }
 * }))
 * ```
 */
export function buildNativeLibraryOptions(library: typeof NativeLibrary, options: NativeLibraryConfig = {}): ComponentOptions<NativeLibraryConfig> {
    return {class: library, ...options}
}

import koffi, {type LibraryHandle} from 'koffi'
import {NativeDeclarationException} from '../../exceptions/NativeDeclarationException.js'
import {NativeLibraryClosedException} from '../../exceptions/NativeLibraryClosedException.js'
import {bindFunction, type CallTracker, convertedCallback} from '../backend/Functions.js'
import type {KoffiType} from '../backend/KoffiTypes.js'
import {layoutOf} from '../declarations/Layout.js'
import {DeclarationParser} from '../declarations/Parser.js'
import {CURRENT_PLATFORM} from '../declarations/Platform.js'
import {type CType, type FunctionDeclaration, type FunctionType, typeText, type VariableDeclaration} from '../declarations/Types.js'
import {allocateNative, checkedPointer, freeNative, nativeErrno, type Pointer, readNative, TypeNames, TYPES, typeSize, writeNative} from '../Runtime.js'
import {NativeCallback} from './NativeCallback.js'
import {type LibraryNames, loadLibrary} from './Resolve.js'

/**
 * Where a library is found, and how it is closed
 */
export interface NativeLibraryOptions {
    /**
     * The file of the library: the only one tried when given.
     */
    path?: string
    /**
     * The directories tried before the ones of the system, in their order (aliases of the application allowed).
     */
    search?: string[]
    /**
     * The directory of the libraries of a packaged application, tried after the search directories.
     */
    packaged?: string
    /**
     * Whether the library stays loaded once closed (its callbacks are released all the same).
     * @default false
     */
    keepLoaded?: boolean
    /**
     * On Windows, the C library the functions of the library use, whose errno `errno()` reads.
     * @default 'ucrtbase.dll'
     */
    crt?: string
    /**
     * Handles the exceptions thrown by the persistent callbacks (the library gets zero as their result).
     * @default writes them to the console
     */
    onCallbackError?: (error: unknown) => void
}

/**
 * How a function is bound
 */
export interface NativeFunctionOptions {
    /**
     * Whether it runs in a thread of the pool, returning a promise: for the functions that block (Node.js runs them in
     * the pool of libuv, 4 threads by default, shared with the file system: raise UV_THREADPOOL_SIZE for many of them).
     * A variadic function cannot be asynchronous.
     * @default false
     */
    async?: boolean
    /**
     * Frees the strings the function gives (its result, its output strings) once read: the name of the function of the
     * library that frees them (`sqlite3_free`), or true for free() of the C library. On Windows, a library built with
     * another C library must be given its own function.
     */
    free?: string | boolean
    /**
     * Its 64-bit integers (its result, its output integers) as numbers rather than bigints: a RangeError when one is not
     * a safe integer.
     * @default 'bigint'
     */
    int64?: 'bigint' | 'number'
}

/**
 * A variable a library exports
 */
export interface NativeVariableAccessor<T = unknown> {
    /**
     * Its address.
     */
    readonly address: Pointer
    /**
     * Its value (an array of char of unknown length is read as a string).
     */
    get(): T
    /**
     * Change its value.
     * @param value The value.
     * @throws {NativeDeclarationException} When it is const.
     */
    set(value: T): void
}

/**
 * The declarations of a library, shared by the libraries loaded with the same declarations: read once, their C types and
 * their prototypes made once (koffi never frees a type)
 */
class LibraryModel {

    readonly parser: DeclarationParser = new DeclarationParser(CURRENT_PLATFORM)

    readonly names: TypeNames = new TypeNames(this.parser)

    readonly #prototypes: Map<string, FunctionDeclaration> = new Map()

    /**
     * Read the declarations.
     * @param declarations The C declarations.
     */
    constructor(declarations: string) {
        if (declarations) this.parser.parse(declarations)
    }

    /**
     * A prototype, read once.
     * @param text The prototype.
     */
    public prototype(text: string): FunctionDeclaration {
        let declaration: FunctionDeclaration | undefined = this.#prototypes.get(text)
        if (!declaration) {
            declaration = this.parser.prototype(text)
            this.#prototypes.set(text, declaration)
        }
        return declaration
    }
}

const models: Map<string, LibraryModel> = new Map()

/**
 * The model of declarations, the same for the same text
 * @param declarations
 */
function modelOf(declarations: string): LibraryModel {
    let model: LibraryModel | undefined = models.get(declarations)
    if (!model) {
        model = new LibraryModel(declarations)
        models.set(declarations, model)
    }
    return model
}

/**
 * The value a callback returns to the library when it throws: zero, false, a null pointer
 * @param type
 */
function zeroOf(type: CType): unknown {
    switch (type.kind) {
        case 'primitive':
            if (type.name === 'void') return undefined
            if (type.name === 'bool') return false
            return 0
        case 'enum':
            return 0
        case 'pointer':
            return null
        default:
            return {}
    }
}

/**
 * A native library loaded with its declarations, without the container (scripts, tests): its functions, variables and
 * callbacks, and the native memory read and written with its types. Made by {@link loadNativeLibrary}; a
 * `NativeLibrary` component holds one.
 * @example
 * ```typescript
 * import {loadNativeLibrary, type NativeLibraryHandle} from '@lakutata/ffi'
 *
 * const libc: NativeLibraryHandle = loadNativeLibrary('c', 'typedef struct { int quot; int rem; } div_t;')
 * const div = libc.func<(numerator: number, denominator: number) => {quot: number, rem: number}>('div_t div(int numerator, int denominator)')
 * console.log(div(17, 5))
 * await libc.close()
 * ```
 */
export class NativeLibraryHandle {

    readonly #library: LibraryHandle

    readonly #file: string

    readonly #model: LibraryModel

    readonly #parser: DeclarationParser

    readonly #names: TypeNames

    readonly #options: NativeLibraryOptions

    readonly #functions: Map<string, (...args: any[]) => any> = new Map()

    readonly #callbacks: Set<NativeCallback> = new Set()

    readonly #allocations: Set<Pointer> = new Set()

    readonly #frees: Map<string, (pointer: unknown) => void> = new Map()

    readonly #calls: CallTracker

    #pending: number = 0

    #drained: (() => void)[] = []

    #closed: boolean = false

    /**
     * Load a library (see {@link loadNativeLibrary}).
     * @param names Its file names: one, or one by platform; `c` for the C library.
     * @param declarations Its C declarations: the types, functions and variables its functions use.
     * @param options Where it is found, how it is closed.
     */
    constructor(names: LibraryNames, declarations: string = '', options: NativeLibraryOptions = {}) {
        this.#options = options
        this.#model = modelOf(declarations)
        this.#parser = this.#model.parser
        this.#names = this.#model.names
        const {library, file} = loadLibrary(names, options)
        this.#library = library
        this.#file = file
        this.#calls = {
            start: (): void => {
                if (this.#closed) throw new NativeLibraryClosedException(`The library ${this.#file} is closed`)
                this.#pending++
            },
            end: (): void => {
                if (--this.#pending > 0) return
                const drained: (() => void)[] = this.#drained
                this.#drained = []
                for (const resolve of drained) resolve()
            }
        }
    }

    /**
     * The file the library was loaded from.
     */
    public get file(): string {
        return this.#file
    }

    /**
     * Whether it is closed.
     */
    public get closed(): boolean {
        return this.#closed
    }

    /**
     * The asynchronous calls running.
     */
    public get pending(): number {
        return this.#pending
    }

    /**
     * The constants of its declarations: the values of the enumerations, of the static constants and of the macros whose
     * value is an integer.
     */
    public get constants(): Readonly<Record<string, bigint>> {
        return Object.fromEntries(this.#parser.declarations.constants)
    }

    /**
     * Add C declarations to the ones of the library (and of the libraries loaded with the same declarations, which share
     * them).
     * @param text The declarations.
     */
    public declare(text: string): void {
        this.#parser.parse(text)
    }

    /**
     * A function of the library, from its prototype: the function of koffi itself when nothing has to be converted.
     * @param prototype Its C prototype, with the types of the declarations: `int sqlite3_open(const char *filename,
     * _Out_ sqlite3 **db)`.
     * @param options Whether it is asynchronous, how its strings are freed, how its 64-bit integers are given.
     * @returns The function.
     */
    public func<T extends (...args: any[]) => any = (...args: any[]) => any>(prototype: string, options: NativeFunctionOptions = {}): T {
        this.#open()
        const key: string = `${prototype}\u0000${JSON.stringify(options)}`
        let bound: ((...args: any[]) => any) | undefined = this.#functions.get(key)
        if (!bound) {
            bound = this.#bind(this.#model.prototype(prototype), options)
            this.#functions.set(key, bound)
        }
        return bound as T
    }

    /**
     * A function of the declarations, by its name.
     * @param name Its name.
     * @param options Whether it is asynchronous, how its strings are freed, how its 64-bit integers are given.
     * @returns The function.
     */
    public function<T extends (...args: any[]) => any = (...args: any[]) => any>(name: string, options: NativeFunctionOptions = {}): T {
        this.#open()
        const declaration: FunctionDeclaration | undefined = this.#parser.declarations.functions.get(name)
        if (!declaration) throw new NativeDeclarationException(`The function ${name} is not declared`)
        const key: string = `\u0001${name}\u0000${JSON.stringify(options)}`
        let bound: ((...args: any[]) => any) | undefined = this.#functions.get(key)
        if (!bound) {
            bound = this.#bind(declaration, options)
            this.#functions.set(key, bound)
        }
        return bound as T
    }

    /**
     * A variable the library exports: declared in the declarations (`extern const char sqlite3_version[];`), or by the
     * declaration given.
     * @param declaration Its name, or its declaration.
     * @returns Its address, and the functions reading and writing its value.
     */
    public variable<T = unknown>(declaration: string): NativeVariableAccessor<T> {
        this.#open()
        let name: string = declaration.trim()
        if (!/^[A-Za-z_]\w*$/.test(name)) {
            const before: Set<string> = new Set(this.#parser.declarations.variables.keys())
            this.#parser.parse(/;\s*$/.test(name) ? name : `${name};`)
            name = [...this.#parser.declarations.variables.keys()].find((variable: string): boolean => !before.has(variable)) ?? name.match(/(\w+)\s*(\[[^\]]*\])?\s*;?\s*$/)?.[1] ?? name
        }
        const variable: VariableDeclaration | undefined = this.#parser.declarations.variables.get(name)
        if (!variable) throw new NativeDeclarationException(`The variable ${name} is not declared`)
        let address: Pointer
        try {
            address = this.#library.symbol(variable.symbol)
        } catch (error) {
            throw new NativeDeclarationException(`The variable ${name} is not in the library (${variable.symbol}): ${(error as Error).message}`)
        }
        const type: CType = variable.type
        const unknownLength: boolean = type.kind === 'array' && type.length === 0
        const converter = TYPES.converter(type)
        return {
            address: address,
            get: (): T => {
                this.#open()
                if (unknownLength) {
                    const element: CType = (type as { of: CType }).of
                    return (element.kind === 'primitive' && element.name === 'char' ? koffi.decode.string(address) : address) as T
                }
                const value: unknown = koffi.decode(address, TYPES.type(type) as any)
                return (converter?.fromNative ? converter.fromNative(value) : value) as T
            },
            set: (value: T): void => {
                this.#open()
                if (variable.constant) throw new NativeDeclarationException(`The variable ${name} is const`)
                if (unknownLength) throw new NativeDeclarationException(`The array ${name} has no length: write its elements through its address`)
                koffi.encode(address, TYPES.type(type) as any, converter?.toNative ? converter.toNative(value) : value)
            }
        }
    }

    /**
     * A persistent callback: a JS function the library can call at any time, released by `release()` or when the
     * library is closed.
     * @param type Its type: the name of a pointer-to-function type of the declarations (`vendor_log`), or its prototype
     * (`void vendor_log(int level, const char *message)`).
     * @param callback The JS function.
     * @returns The callback, whose `pointer` is given to the library.
     */
    public callback(type: string, callback: (...args: any[]) => any): NativeCallback {
        this.#open()
        let prototype: FunctionType
        if (type.includes('(')) {
            prototype = this.#parser.prototype(type).type
        } else {
            const named: CType = this.#names.type(type)
            const target: CType = named.kind === 'pointer' ? named.to : named
            if (target.kind !== 'function') throw new NativeDeclarationException(`The type ${type} is not a function type (${typeText(named)})`)
            prototype = target
        }
        const onError: (error: unknown) => void = this.#options.onCallbackError ?? ((error: unknown): void => console.error('A callback of a native library threw:', error))
        const zero: unknown = zeroOf(prototype.result)
        const safe = (...args: any[]): any => {
            try {
                return callback(...args)
            } catch (error) {
                onError(error)
                return zero
            }
        }
        const pointer: Pointer = koffi.register(convertedCallback(prototype, TYPES, safe), koffi.pointer(TYPES.prototype(prototype)))
        const registered: NativeCallback = new NativeCallback(pointer, (released: NativeCallback): unknown => this.#callbacks.delete(released))
        this.#callbacks.add(registered)
        return registered
    }

    /**
     * Read native memory, as a type of the declarations: a value, or an array of values.
     * @param pointer The address.
     * @param type The type: `int`, `struct timeval`, `char *` (a string).
     * @param count The number of values, for an array.
     * @returns The value, or the array.
     */
    public read<T = unknown>(pointer: Pointer, type: string, count?: number): T {
        this.#open()
        return readNative(this.#names, pointer, type, count) as T
    }

    /**
     * Write a value to native memory, as a type of the declarations.
     * @param pointer The address.
     * @param type The type.
     * @param value The value.
     */
    public write(pointer: Pointer, type: string, value: unknown): void {
        this.#open()
        writeNative(this.#names, pointer, type, value)
    }

    /**
     * The size of a type of the declarations, in bytes.
     * @param type The type.
     */
    public sizeOf(type: string): number {
        return typeSize(this.#names, type)
    }

    /**
     * The offset of a member of a struct of the declarations, in bytes.
     * @param type The struct.
     * @param member The member.
     */
    public offsetOf(type: string, member: string): number {
        const record: CType = this.#names.type(type)
        if (record.kind !== 'struct' && record.kind !== 'union') throw new NativeDeclarationException(`${type} is not a struct or a union`)
        const placed = layoutOf(record, CURRENT_PLATFORM).members.find((candidate): boolean => candidate.member.name === member)
        if (!placed) throw new NativeDeclarationException(`${type} has no member ${member}`)
        return placed.offset
    }

    /**
     * Allocate native memory for values of a type of the declarations: memory that does not move, which the library can
     * keep; freed by `free()`, or when the library is closed.
     * @param type The type.
     * @param count The number of values.
     * @returns Its address.
     */
    public alloc(type: string, count: number = 1): Pointer {
        this.#open()
        const pointer: Pointer = allocateNative(this.#names, type, count)
        this.#allocations.add(pointer)
        return pointer
    }

    /**
     * Free memory allocated by `alloc()`.
     * @param pointer Its address.
     */
    public free(pointer: Pointer): void {
        const address: Pointer = checkedPointer(pointer, 'free')
        this.#allocations.delete(address)
        freeNative(address)
    }

    /**
     * The errno of the last call of the thread (on Windows, the one of the C library given by the `crt` option).
     */
    public errno(): number {
        return nativeErrno(this.#options.crt)
    }

    /**
     * The asynchronous calls running, once they have all returned.
     * @param timeout How long to wait at most, in milliseconds.
     * @returns Whether they have all returned.
     */
    public drain(timeout: number = Infinity): Promise<boolean> {
        if (!this.#pending) return Promise.resolve(true)
        return new Promise((resolve: (drained: boolean) => void): void => {
            const timer: NodeJS.Timeout | undefined = Number.isFinite(timeout) ? setTimeout((): void => resolve(false), timeout) : undefined
            this.#drained.push((): void => {
                if (timer) clearTimeout(timer)
                resolve(true)
            })
        })
    }

    /**
     * Close the library: new asynchronous calls are refused, the running ones awaited (a worker thread stopped during
     * one crashes Bun), the callbacks released, the memory of `alloc()` freed, the library unloaded (unless kept
     * loaded; musl never unloads). Its functions must not be called any more: a function of an unloaded library ends
     * the process.
     * @param timeout How long to wait for the asynchronous calls, in milliseconds.
     */
    public async close(timeout: number = 10000): Promise<void> {
        if (this.#closed) return
        this.#closed = true
        await this.drain(timeout)
        for (const callback of [...this.#callbacks]) callback.release()
        for (const pointer of this.#allocations) freeNative(pointer)
        this.#allocations.clear()
        this.#functions.clear()
        if (!this.#options.keepLoaded) this.#library.unload()
    }

    /**
     * Throws once the library is closed
     */
    #open(): void {
        if (this.#closed) throw new NativeLibraryClosedException(`The library ${this.#file} is closed`)
    }

    /**
     * A function bound, with its options
     * @param declaration
     * @param options
     */
    #bind(declaration: FunctionDeclaration, options: NativeFunctionOptions): (...args: any[]) => any {
        return bindFunction(this.#library, declaration, TYPES, (text: string): KoffiType => this.#names.koffi(text), {
            async: options.async,
            int64: options.int64,
            calls: this.#calls,
            ...options.free ? {free: this.#freeFunction(options.free)} : {}
        })
    }

    /**
     * The function freeing the strings of a function: one of the library, or free() of the C library
     * @param free
     */
    #freeFunction(free: string | true): (pointer: unknown) => void {
        if (free === true) return (pointer: unknown): void => koffi.free(pointer as bigint)
        let found: ((pointer: unknown) => void) | undefined = this.#frees.get(free)
        if (!found) {
            try {
                found = this.#library.func(free, 'void', ['void *']) as (pointer: unknown) => void
            } catch (error) {
                throw new NativeDeclarationException(`The function ${free} freeing the strings is not in the library: ${(error as Error).message}`)
            }
            this.#frees.set(free, found)
        }
        return found
    }
}

/**
 * Load a native library with its C declarations, without the container (scripts, tests); in an application, declare a
 * `NativeLibrary` component instead. The library is looked for in the directories of `search`, then where the system
 * looks for libraries.
 * @param names Its file names: one (`sqlite3`, completed as the platform names libraries), one by platform
 * (`{darwin: 'libsqlite3.dylib', linux: 'libsqlite3.so.0', win32: 'winsqlite3.dll'}`), or `c` for the C library.
 * @param declarations Its C declarations: the types its functions use, its functions, its variables, its constants.
 * @param options Where it is found, how it is closed.
 * @returns The library.
 * @throws {NativeLibraryNotFoundException} When it cannot be loaded (the message lists what was tried).
 * @throws {NativeDeclarationException} When the declarations cannot be read.
 * @example
 * ```typescript
 * import {loadNativeLibrary, type Out, type Pointer} from '@lakutata/ffi'
 *
 * const sqlite = loadNativeLibrary({darwin: 'libsqlite3.dylib', linux: 'libsqlite3.so.0', win32: 'winsqlite3.dll'}, `
 *     typedef struct sqlite3 sqlite3;
 *     #define SQLITE_OK 0
 * `)
 * const open = sqlite.func<(filename: string, db: Out<Pointer>) => number>('int sqlite3_open(const char *filename, _Out_ sqlite3 **db)')
 * const close = sqlite.func<(db: Pointer) => number>('int sqlite3_close(sqlite3 *db)')
 * const db: Out<Pointer> = [null]
 * if (open(':memory:', db) === Number(sqlite.constants.SQLITE_OK)) close(db[0]!)
 * await sqlite.close()
 * ```
 */
export function loadNativeLibrary(names: LibraryNames, declarations: string = '', options: NativeLibraryOptions = {}): NativeLibraryHandle {
    return new NativeLibraryHandle(names, declarations, options)
}

import koffi, {type LibraryHandle} from 'koffi'
import {NativeDeclarationException} from '../exceptions/NativeDeclarationException.js'
import {NativeMemoryException} from '../exceptions/NativeMemoryException.js'
import {type KoffiType, KoffiTypes} from './backend/KoffiTypes.js'
import {DeclarationParser} from './declarations/Parser.js'
import {CURRENT_PLATFORM} from './declarations/Platform.js'
import type {CType} from './declarations/Types.js'
import {loadLibrary} from './library/Resolve.js'

/**
 * The koffi types of the process: one per C type, whatever library declares it
 */
export const TYPES: KoffiTypes = new KoffiTypes(CURRENT_PLATFORM)

/**
 * A pointer to native memory: a bigint (its address), null for NULL
 */
export type Pointer = bigint

/**
 * The C types read from their names, with the declarations of a library or the built-in types only
 */
export class TypeNames {

    readonly #parser: DeclarationParser

    readonly #types: Map<string, CType> = new Map()

    /**
     * The type names of a library.
     * @param parser Its declarations.
     */
    constructor(parser: DeclarationParser) {
        this.#parser = parser
    }

    /**
     * A type, from its name.
     * @param text Its name: `int`, `struct timeval`, `const char *`.
     */
    public type(text: string): CType {
        let type: CType | undefined = this.#types.get(text)
        if (!type) {
            type = this.#parser.typeName(text)
            this.#types.set(text, type)
        }
        return type
    }

    /**
     * The koffi type of a type name.
     * @param text Its name.
     */
    public koffi(text: string): KoffiType {
        return TYPES.type(this.type(text))
    }
}

/**
 * The type names of the built-in types (of no library)
 */
export const BUILTIN_TYPES: TypeNames = new TypeNames(new DeclarationParser(CURRENT_PLATFORM))

let copier: ((dest: Buffer, src: Pointer, length: number | bigint) => unknown) | undefined

/**
 * memcpy of the C library, copying native memory into buffers
 */
function memcpy(): (dest: Buffer, src: Pointer, length: number | bigint) => unknown {
    if (!copier) {
        const library: LibraryHandle = process.platform === 'win32' ? koffi.load('msvcrt.dll') : loadLibrary('c').library
        copier = library.func('memcpy', 'void *', ['void *', 'void *', 'size_t'])
    }
    return copier
}

/**
 * A pointer checked: not null, a bigint or a number
 * @param pointer
 * @param what
 */
export function checkedPointer(pointer: unknown, what: string): Pointer {
    if (pointer === null || pointer === undefined || pointer === 0n || pointer === 0) throw new NativeMemoryException(`${what}: the pointer is null`)
    if (typeof pointer === 'number') return BigInt(pointer)
    if (typeof pointer !== 'bigint') throw new NativeMemoryException(`${what}: a pointer (a bigint) is expected, not ${typeof pointer}`)
    return pointer
}

/**
 * A length checked: a non-negative integer
 * @param length
 * @param what
 */
function checkedLength(length: number, what: string): number {
    if (!Number.isInteger(length) || length < 0) throw new NativeMemoryException(`${what}: the length must be a non-negative integer (${length})`)
    return length
}

/**
 * A copy of native memory, in a buffer of its own.
 * @param pointer The address of the memory.
 * @param length Its length in bytes.
 */
export function copyBuffer(pointer: Pointer, length: number): Buffer {
    const buffer: Buffer = Buffer.allocUnsafe(checkedLength(length, 'readBuffer'))
    if (length) memcpy()(buffer, checkedPointer(pointer, 'readBuffer'), length)
    return buffer
}

/**
 * A view of native memory, without copy: refused in Electron, which forbids them (koffi would end the process).
 * @param pointer The address of the memory.
 * @param length Its length in bytes.
 */
export function nativeView(pointer: Pointer, length: number): ArrayBuffer {
    if (process.versions.electron) throw new NativeMemoryException('Electron does not allow views of native memory: use readBuffer, which copies it')
    return koffi.view(checkedPointer(pointer, 'viewBuffer'), checkedLength(length, 'viewBuffer'))
}

/**
 * A value read from native memory, converted as the package gives values (64-bit integers as bigints).
 * @param names The type names to read the type with.
 * @param pointer The address.
 * @param type The type name.
 * @param count The number of values, for an array.
 */
export function readNative(names: TypeNames, pointer: Pointer, type: string, count?: number): unknown {
    const cType: CType = names.type(type)
    const address: Pointer = checkedPointer(pointer, 'read')
    const converter = TYPES.converter(cType)
    if (count === undefined) {
        const value: unknown = koffi.decode(address, TYPES.type(cType) as any)
        return converter?.fromNative ? converter.fromNative(value) : value
    }
    const values: unknown[] = Array.from(koffi.decode(address, TYPES.type(cType) as any, checkedLength(count, 'readArray')) as ArrayLike<unknown>)
    return converter?.fromNative ? values.map(converter.fromNative) : values
}

/**
 * A value written to native memory.
 * @param names The type names to read the type with.
 * @param pointer The address.
 * @param type The type name.
 * @param value The value.
 */
export function writeNative(names: TypeNames, pointer: Pointer, type: string, value: unknown): void {
    const cType: CType = names.type(type)
    const converter = TYPES.converter(cType)
    koffi.encode(checkedPointer(pointer, 'write'), TYPES.type(cType) as any, converter?.toNative ? converter.toNative(value) : value)
}

/**
 * Native memory allocated for values of a type (C's malloc: freed by freeNative).
 * @param names The type names to read the type with.
 * @param type The type name.
 * @param count The number of values.
 */
export function allocateNative(names: TypeNames, type: string, count: number = 1): Pointer {
    if (!Number.isInteger(count) || count < 1) throw new NativeMemoryException(`allocMemory: the count must be a positive integer (${count})`)
    const pointer: unknown = koffi.alloc(names.koffi(type) as any, count)
    return typeof pointer === 'bigint' ? pointer : koffi.address(pointer)
}

/**
 * Free native memory allocated by allocateNative (or by the malloc of the C library the package is built with).
 * @param pointer The address.
 */
export function freeNative(pointer: Pointer): void {
    koffi.free(checkedPointer(pointer, 'freeMemory'))
}

//The _errno() of each C library of Windows
const windowsErrno: Map<string, () => unknown> = new Map()

let windowsLastError: (() => number) | undefined

/**
 * The errno of the last call made by the thread: on Windows, the one of the C library of Microsoft (ucrtbase.dll), each
 * C library having its own; elsewhere the one koffi keeps after each call.
 * @param crt On Windows, the C library the function called uses.
 */
export function nativeErrno(crt: string = 'ucrtbase.dll'): number {
    if (process.platform !== 'win32') return koffi.errno()
    const name: string = crt.toLowerCase()
    let errno: (() => unknown) | undefined = windowsErrno.get(name)
    if (!errno) {
        errno = koffi.load(crt).func('_errno', 'int *', [])
        windowsErrno.set(name, errno)
    }
    return koffi.decode(errno(), 'int')
}

/**
 * The last error of the Windows API of the thread (GetLastError), kept by koffi after each call; undefined elsewhere.
 */
export function nativeWindowsError(): number | undefined {
    if (process.platform !== 'win32') return undefined
    windowsLastError ??= koffi.load('kernel32.dll').func('__stdcall', 'GetLastError', 'uint32_t', [])
    return windowsLastError()
}

/**
 * The size of a type on the platform, by its name.
 * @param names The type names.
 * @param type The type name.
 */
export function typeSize(names: TypeNames, type: string): number {
    const cType: CType = names.type(type)
    if (cType.kind === 'function') throw new NativeDeclarationException(`A function has no size: ${type}`)
    return koffi.sizeof(TYPES.type(cType) as any)
}

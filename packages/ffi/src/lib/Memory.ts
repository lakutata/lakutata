import koffi from 'koffi'
import {BUILTIN_TYPES, checkedPointer, copyBuffer, allocateNative, freeNative, nativeErrno, nativeView, nativeWindowsError, type Pointer, readNative, typeSize, writeNative} from './Runtime.js'

/**
 * An output parameter of a pointer or an integer: an array of one element, null before the call, set by the function
 * (`[null]` given to `_Out_ sqlite3 **db`, then `db[0]`)
 */
export type Out<T> = [T | null]

/**
 * Read a C string (UTF-8, ended by a NUL byte) from native memory: a `char *` given as a pointer (a `void *` result, an
 * argument of a callback, a member of a struct).
 * @param pointer Its address.
 * @param length Its length in bytes, when it is not ended by a NUL byte.
 * @returns The string.
 * @example
 * ```typescript
 * import {readCString, type Pointer} from '@lakutata/ffi'
 *
 * export function messageOf(pointer: Pointer): string {
 *     return readCString(pointer)
 * }
 * ```
 */
export function readCString(pointer: Pointer, length?: number): string {
    const address: Pointer = checkedPointer(pointer, 'readCString')
    return length === undefined ? koffi.decode.string(address) : koffi.decode.string(address, length)
}

/**
 * Read a wide string from native memory: a `wchar_t *` (UTF-16 on Windows, UTF-32 elsewhere), ended by a NUL character.
 * @param pointer Its address.
 * @param length Its length in characters, when it is not ended by a NUL character.
 * @returns The string.
 * @example
 * ```typescript
 * import {readWString, type Pointer} from '@lakutata/ffi'
 *
 * export function titleOf(pointer: Pointer): string {
 *     return readWString(pointer)
 * }
 * ```
 */
export function readWString(pointer: Pointer, length?: number): string {
    const address: Pointer = checkedPointer(pointer, 'readWString')
    return length === undefined ? koffi.decode.wstring(address) : koffi.decode.wstring(address, length)
}

/**
 * Copy native memory into a buffer of its own, which stays valid once the native memory is freed (about 10 GB/s).
 * @param pointer The address of the memory.
 * @param length Its length in bytes.
 * @returns The copy.
 * @example
 * ```typescript
 * import {readBuffer, type Pointer} from '@lakutata/ffi'
 *
 * export function frameOf(pixels: Pointer, width: number, height: number): Buffer {
 *     return readBuffer(pixels, width * height * 4)
 * }
 * ```
 */
export function readBuffer(pointer: Pointer, length: number): Buffer {
    return copyBuffer(pointer, length)
}

/**
 * A view of native memory, without copy: worth it for large blocks read often (8 MiB: about 0.13 ms rather than 1 ms
 * for a copy). The view must not be used once the native memory is freed: the process would crash. Electron forbids
 * these views: it throws there (use readBuffer).
 * @param pointer The address of the memory.
 * @param length Its length in bytes.
 * @returns The memory, as an ArrayBuffer.
 * @throws {NativeMemoryException} In Electron, or for a null pointer.
 * @example
 * ```typescript
 * import {viewBuffer, type Pointer} from '@lakutata/ffi'
 *
 * export function firstPixel(pixels: Pointer): number {
 *     return new Uint32Array(viewBuffer(pixels, 4))[0]
 * }
 * ```
 */
export function viewBuffer(pointer: Pointer, length: number): ArrayBuffer {
    return nativeView(pointer, length)
}

/**
 * Read a value of a built-in type from native memory (`int`, `double`, `uint64_t`, `char *`…): the 64-bit integers as
 * bigints. The types of a library are read by `read()` of the library.
 * @param pointer Its address.
 * @param type Its type.
 * @returns The value.
 * @example
 * ```typescript
 * import {readValue, type Pointer} from '@lakutata/ffi'
 *
 * export function countAt(pointer: Pointer): number {
 *     return readValue(pointer, 'int32_t') as number
 * }
 * ```
 */
export function readValue(pointer: Pointer, type: string): unknown {
    return readNative(BUILTIN_TYPES, pointer, type)
}

/**
 * Read an array of values of a built-in type from native memory.
 * @param pointer The address of its first element.
 * @param type The type of its elements (`char *` reads strings).
 * @param count Its length.
 * @returns The values.
 * @example
 * ```typescript
 * import {readArray, type Pointer} from '@lakutata/ffi'
 *
 * //The row of a callback of sqlite3_exec: char **values
 * export function rowOf(values: Pointer, count: number): string[] {
 *     return readArray(values, 'char *', count) as string[]
 * }
 * ```
 */
export function readArray(pointer: Pointer, type: string, count: number): unknown[] {
    return readNative(BUILTIN_TYPES, pointer, type, count) as unknown[]
}

/**
 * Write a value of a built-in type to native memory.
 * @param pointer Its address.
 * @param type Its type.
 * @param value The value.
 * @example
 * ```typescript
 * import {allocMemory, freeMemory, readValue, writeValue} from '@lakutata/ffi'
 *
 * const counter: bigint = allocMemory('int64_t')
 * writeValue(counter, 'int64_t', 42n)
 * console.log(readValue(counter, 'int64_t'))
 * freeMemory(counter)
 * ```
 */
export function writeValue(pointer: Pointer, type: string, value: unknown): void {
    writeNative(BUILTIN_TYPES, pointer, type, value)
}

/**
 * Allocate native memory for values of a built-in type: memory that does not move, which a library can keep (a buffer
 * given to a function is valid during the call only). Freed by freeMemory.
 * @param type The type of the values.
 * @param count Their number.
 * @returns Its address.
 * @example
 * ```typescript
 * import {allocMemory, freeMemory} from '@lakutata/ffi'
 *
 * const buffer: bigint = allocMemory('uint8_t', 4096)
 * freeMemory(buffer)
 * ```
 */
export function allocMemory(type: string, count: number = 1): Pointer {
    return allocateNative(BUILTIN_TYPES, type, count)
}

/**
 * Free native memory allocated by allocMemory.
 * @param pointer Its address.
 * @example
 * ```typescript
 * import {allocMemory, freeMemory} from '@lakutata/ffi'
 *
 * freeMemory(allocMemory('double', 16))
 * ```
 */
export function freeMemory(pointer: Pointer): void {
    freeNative(pointer)
}

/**
 * The size of a built-in type on the platform, in bytes (`long` is 8 on 64-bit Linux and macOS, 4 on Windows).
 * @param type The type.
 * @returns Its size.
 * @example
 * ```typescript
 * import {sizeOf} from '@lakutata/ffi'
 *
 * console.log(sizeOf('long'), sizeOf('wchar_t'), sizeOf('void *'))
 * ```
 */
export function sizeOf(type: string): number {
    return typeSize(BUILTIN_TYPES, type)
}

/**
 * The errno of the last native call of the thread. On Windows, each C library has its own errno: the one of the C
 * library of Microsoft (ucrtbase.dll) by default.
 * @param crt On Windows, the C library the function called uses (`msvcrt.dll` for the old libraries).
 * @returns The errno.
 * @example
 * ```typescript
 * import {lastErrno, loadNativeLibrary} from '@lakutata/ffi'
 *
 * const libc = loadNativeLibrary('c')
 * const open = libc.func<(path: string, flags: number) => number>('int open(const char *path, int flags, ...)')
 * if (open('/surely/missing', 0) < 0) console.log('errno', lastErrno())
 * ```
 */
export function lastErrno(crt?: string): number {
    return nativeErrno(crt)
}

/**
 * The last error of the Windows API of the thread (GetLastError), kept after each native call; undefined on the other
 * systems.
 * @returns The error.
 * @example
 * ```typescript
 * import {lastWindowsError, loadNativeLibrary} from '@lakutata/ffi'
 *
 * if (process.platform === 'win32') {
 *     const kernel32 = loadNativeLibrary('kernel32.dll')
 *     const attributes = kernel32.func<(path: string) => number>('DWORD WINAPI GetFileAttributesW(LPCWSTR path)')
 *     if (attributes('C:\\missing') === 0xFFFFFFFF) console.log('error', lastWindowsError())
 * }
 * ```
 */
export function lastWindowsError(): number | undefined {
    return nativeWindowsError()
}

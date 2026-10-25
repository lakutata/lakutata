import {Exception} from '@lakutata/core'

/**
 * Thrown when a function, a variable or a callback of a library is used once the library is closed (its component
 * destroyed, or `close()` called): calling a function of an unloaded library would end the process. Its `errno` is
 * `'E_NATIVE_LIBRARY_CLOSED'`.
 */
export class NativeLibraryClosedException extends Exception {
    /**
     * `'E_NATIVE_LIBRARY_CLOSED'`.
     */
    public errno: string | number = 'E_NATIVE_LIBRARY_CLOSED'
}

import {Exception} from '@lakutata/core'

/**
 * Thrown when a library cannot be loaded: its message lists each file tried and why it could not be loaded (not found,
 * built for another architecture, a library it needs missing). Its `errno` is `'E_NATIVE_LIBRARY_NOT_FOUND'`.
 */
export class NativeLibraryNotFoundException extends Exception {
    /**
     * `'E_NATIVE_LIBRARY_NOT_FOUND'`.
     */
    public errno: string | number = 'E_NATIVE_LIBRARY_NOT_FOUND'
}

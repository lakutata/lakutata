import {Exception} from '@lakutata/core'

/**
 * Thrown when native memory cannot be read or written as asked: a null pointer, a negative length, a view of native
 * memory where the runtime forbids it (Electron). Its `errno` is `'E_NATIVE_MEMORY'`.
 */
export class NativeMemoryException extends Exception {
    /**
     * `'E_NATIVE_MEMORY'`.
     */
    public errno: string | number = 'E_NATIVE_MEMORY'
}

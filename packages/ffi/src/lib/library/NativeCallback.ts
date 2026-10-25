import koffi from 'koffi'
import type {Pointer} from '../Runtime.js'

/**
 * A JS function a library can call at any time (a persistent callback), made by `callback()` of a library: give its
 * `pointer` to the library, and release it when the library no longer calls it. The callbacks of a library are released
 * when it is closed; a process has at most 8192 of them at a time.
 *
 * When it is called from another thread of the library, it runs in the JS thread once the event loop gets to it. An
 * exception it throws goes to the error handler of its library (the `error` event of a component), and the library gets
 * zero (or a null pointer) as its result.
 * @example
 * ```typescript
 * import {loadNativeLibrary, type NativeCallback} from '@lakutata/ffi'
 *
 * const vendor = loadNativeLibrary('vendor', 'typedef void (*vendor_log)(int level, const char *message);')
 * const setLogger = vendor.func<(logger: bigint | null) => void>('void vendor_set_logger(vendor_log logger)')
 * const logger: NativeCallback = vendor.callback('vendor_log', (level: number, message: string): void => console.log(level, message))
 * setLogger(logger.pointer)
 * //Once the library no longer calls it
 * setLogger(null)
 * logger.release()
 * ```
 */
export class NativeCallback {

    readonly #pointer: Pointer

    readonly #onRelease: (callback: NativeCallback) => void

    #released: boolean = false

    /**
     * A registered callback (made by `callback()` of a library, not by this constructor).
     * @param pointer Its pointer.
     * @param onRelease Called once it is released.
     */
    constructor(pointer: Pointer, onRelease: (callback: NativeCallback) => void) {
        this.#pointer = pointer
        this.#onRelease = onRelease
    }

    /**
     * The pointer to give to the library: the address of a C function calling the JS function.
     */
    public get pointer(): Pointer {
        return this.#pointer
    }

    /**
     * Whether it is released: the library must not call it any more.
     */
    public get released(): boolean {
        return this.#released
    }

    /**
     * Release it: its pointer is no longer valid, its slot is free for another callback. Releasing it again does
     * nothing.
     */
    public release(): void {
        if (this.#released) return
        this.#released = true
        koffi.unregister(this.#pointer)
        this.#onRelease(this)
    }
}

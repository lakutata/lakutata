/**
 * What a worker thread of a library is started with
 */
export interface NativeWorkerData {
    /**
     * The path of koffi, resolved by the thread of the library
     */
    readonly koffi: string
    /**
     * The file of the library, as the thread of the library loaded it
     */
    readonly file: string
    /**
     * The C declarations of the library
     */
    readonly declarations: string
    /**
     * On Windows, the C library whose errno is read after each call
     */
    readonly crt?: string
}

/**
 * The options a function is bound with in a thread (the synchronous ones: the thread calls it synchronously)
 */
export interface ThreadFunctionOptions {
    readonly free?: string | boolean
    readonly int64?: 'bigint' | 'number'
}

/**
 * An error sent from a thread: made again by its name
 */
export interface ThreadError {
    readonly name: string
    readonly message: string
}

/**
 * The messages to a thread: a function bound (a prototype, or the name of a declared function), declarations added, a
 * call (the arguments to send back after it), the end
 */
export type ToNativeWorker =
    | { readonly type: 'bind', readonly id: number, readonly declaration: string, readonly named: boolean, readonly options: ThreadFunctionOptions }
    | { readonly type: 'declare', readonly declarations: string }
    | { readonly type: 'call', readonly id: number, readonly function: number, readonly args: unknown[], readonly back: readonly number[] }
    | { readonly type: 'close' }

/**
 * The messages from a thread: the library loaded (or not), the result of a call (its value or its error, the arguments
 * asked back, the errno of the thread after it), the end
 */
export type FromNativeWorker =
    | { readonly type: 'ready' }
    | { readonly type: 'failed', readonly error: ThreadError }
    | { readonly type: 'result', readonly id: number, readonly value?: unknown, readonly error?: ThreadError, readonly back: readonly unknown[], readonly errno: number, readonly windowsError?: number }
    | { readonly type: 'closed' }

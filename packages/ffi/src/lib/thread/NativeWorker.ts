import {parentPort, workerData} from 'node:worker_threads'
import {NativeLibraryHandle} from '../library/NativeLibraryHandle.js'
import {nativeWindowsError} from '../Runtime.js'
import type {FromNativeWorker, NativeWorkerData, ThreadError, ToNativeWorker} from './ThreadProtocol.js'

/**
 * An error as a thread sends it
 * @param error
 */
function threadError(error: unknown): ThreadError {
    return error instanceof Error ? {name: error.name, message: error.message} : {name: 'Error', message: String(error)}
}

/**
 * The buffers of values sent back, transferred rather than copied (they are the copies of the thread)
 * @param values
 */
function transferables(values: readonly unknown[]): ArrayBuffer[] {
    const buffers: Set<ArrayBuffer> = new Set()
    for (const value of values) if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) buffers.add(value.buffer)
    return [...buffers]
}

/**
 * Serve the calls of a library in this worker thread: it loads the library, binds the functions it is asked to bind
 * (synchronous: the thread is the one waiting), calls them in the order of the messages, and sends back their results,
 * the arguments asked back (the output parameters, the buffers written) and its errno after each call
 */
export function runNativeWorker(): void {
    const port = parentPort!
    const data: NativeWorkerData = workerData
    const post = (message: FromNativeWorker, transfer: ArrayBuffer[] = []): void => port.postMessage(message, transfer)
    let library: NativeLibraryHandle
    try {
        library = new NativeLibraryHandle(data.file, data.declarations, {crt: data.crt})
    } catch (error) {
        post({type: 'failed', error: threadError(error)})
        port.close()
        return
    }
    //The functions bound, or why they could not be
    const functions: Map<number, ((...args: unknown[]) => unknown) | ThreadError> = new Map()
    port.on('message', (message: ToNativeWorker): void => {
        switch (message.type) {
            case 'bind':
                try {
                    functions.set(message.id, message.named ? library.function(message.declaration, message.options) : library.func(message.declaration, message.options))
                } catch (error) {
                    functions.set(message.id, threadError(error))
                }
                return
            case 'declare':
                try {
                    library.declare(message.declarations)
                } catch {
                    //The thread of the library read them first: it reported their error
                }
                return
            case 'call': {
                const bound: ((...args: unknown[]) => unknown) | ThreadError | undefined = functions.get(message.function)
                let value: unknown
                let error: ThreadError | undefined
                if (typeof bound !== 'function') {
                    error = bound ?? {name: 'Error', message: 'The function is not bound in the thread'}
                } else {
                    try {
                        value = bound(...message.args)
                    } catch (thrown) {
                        error = threadError(thrown)
                    }
                }
                //GetLastError first: reading the errno of the C library of Windows is a call too
                const windowsError: number | undefined = nativeWindowsError()
                const errno: number = library.errno()
                const back: unknown[] = message.back.map((index: number): unknown => message.args[index])
                post({type: 'result', id: message.id, ...error ? {error: error} : {value: value}, back: back, errno: errno, ...windowsError !== undefined ? {windowsError: windowsError} : {}}, transferables(back))
                return
            }
            case 'close': {
                const end = (): void => {
                    post({type: 'closed'})
                    port.close()
                }
                library.close().then(end, end)
                return
            }
        }
    })
    post({type: 'ready'})
}

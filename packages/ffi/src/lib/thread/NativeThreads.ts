import {Worker} from 'node:worker_threads'
import koffi from 'koffi'
import {NativeDeclarationException} from '../../exceptions/NativeDeclarationException.js'
import {NativeLibraryClosedException} from '../../exceptions/NativeLibraryClosedException.js'
import {NativeLibraryNotFoundException} from '../../exceptions/NativeLibraryNotFoundException.js'
import {NativeMemoryException} from '../../exceptions/NativeMemoryException.js'
import {convertedCallback} from '../backend/Functions.js'
import type {CType, FunctionDeclaration, FunctionType, Parameter} from '../declarations/Types.js'
import {TYPES} from '../Runtime.js'
import {nativeWorkerCode} from './NativeWorkerCode.js'
import {packageRequire} from './PackageRequire.js'
import type {FromNativeWorker, NativeWorkerData, ThreadError, ThreadFunctionOptions, ToNativeWorker} from './ThreadProtocol.js'

/**
 * How long the threads have to close once asked, in milliseconds
 */
const CLOSE_TIMEOUT: number = 5000

/**
 * A function called in the threads: how a thread binds it
 */
export interface ThreadFunction {
    /**
     * Its prototype, or the name of a declared function
     */
    readonly declaration: string
    readonly named: boolean
    readonly options: ThreadFunctionOptions
    /**
     * Its declaration, read by the thread of the library: which arguments are written by the function, which are
     * callbacks
     */
    readonly type: FunctionDeclaration
}

/**
 * The result of a call in a thread: its value, and the errno of the thread after it
 */
export interface ThreadResult {
    readonly value: unknown
    readonly errno: number
    readonly windowsError?: number
}

/**
 * A call waiting for its result
 */
interface PendingCall {
    readonly resolve: (result: ThreadResult) => void
    readonly reject: (error: Error) => void
    readonly settle: (message: Extract<FromNativeWorker, { type: 'result' }>) => void
}

/**
 * A worker thread of the library
 */
interface Slot {
    readonly worker: Worker
    readonly ready: Promise<void>
    readonly calls: Map<number, PendingCall>
    readonly bound: Map<ThreadFunction, number>
    exited: boolean
    //Why it could not load the library
    error?: Error
}

/**
 * An error of a thread, made again with its class
 * @param error
 */
function errorOf(error: ThreadError): Error {
    const classes: Record<string, new (message: string) => Error> = {
        NativeDeclarationException: NativeDeclarationException,
        NativeLibraryClosedException: NativeLibraryClosedException,
        NativeLibraryNotFoundException: NativeLibraryNotFoundException,
        NativeMemoryException: NativeMemoryException,
        TypeError: TypeError,
        RangeError: RangeError
    }
    const made: Error = new (classes[error.name] ?? Error)(error.message)
    if (!classes[error.name]) made.name = error.name
    return made
}

/**
 * The value a callback returns to the library when it throws: zero, false, a null pointer
 * @param type
 */
function zeroOf(type: CType): unknown {
    if (type.kind === 'primitive') return type.name === 'void' ? undefined : type.name === 'bool' ? false : 0
    if (type.kind === 'enum') return 0
    if (type.kind === 'pointer') return null
    return {}
}

/**
 * Whether a parameter points to memory the function may write: not const, or marked _Out_ or _Inout_
 * @param parameter
 */
function written(parameter: Parameter | undefined): boolean {
    if (!parameter) return true
    if (parameter.direction !== 'in') return true
    return parameter.type.kind === 'pointer' && !parameter.type.constTarget
}

/**
 * The worker threads of a library: they load it, and run its asynchronous calls (synchronously, each in its thread);
 * with one thread, in the order they are made. The arguments are copied to the thread and the ones the function writes
 * copied back; a JS function given as a callback is registered for the call in the thread of the library, which runs it
 * when the library calls it
 */
export class NativeThreads {

    readonly #data: NativeWorkerData

    readonly #count: number

    readonly #slots: (Slot | undefined)[]

    readonly #declarations: string[] = []

    #nextFunction: number = 1

    #nextCall: number = 1

    #closed: boolean = false

    /**
     * Start the threads of a library.
     * @param file The file of the library, as loaded by this thread.
     * @param declarations Its C declarations.
     * @param count The number of threads.
     * @param crt On Windows, the C library whose errno is read after each call.
     */
    constructor(file: string, declarations: string, count: number, crt?: string) {
        if (!nativeWorkerCode || !packageRequire) throw new Error('The code of the worker threads of the libraries is not built (scripts/worker.mjs)')
        this.#data = {koffi: packageRequire.resolve('koffi'), file: file, declarations: declarations, ...crt ? {crt: crt} : {}}
        this.#count = count
        this.#slots = Array.from({length: count}, (): Slot => this.#start())
    }

    /**
     * Settled once every thread has loaded the library: rejected with the error of a thread that could not.
     */
    public get ready(): Promise<void> {
        return Promise.all(this.#slots.map((slot: Slot | undefined): Promise<void> => slot?.ready ?? Promise.resolve())).then((): void => undefined)
    }

    /**
     * The number of threads.
     */
    public get count(): number {
        return this.#count
    }

    /**
     * Add declarations to the ones of the threads (and of the threads started later).
     * @param declarations The declarations.
     */
    public declare(declarations: string): void {
        this.#declarations.push(declarations)
        for (const slot of this.#slots) if (slot && !slot.exited) this.#post(slot, {type: 'declare', declarations: declarations})
    }

    /**
     * Bind a function in the threads now rather than at its first call: when the library is made, while the threads
     * start (a thread started later binds it at its first call in it).
     * @param fn The function.
     */
    public bind(fn: ThreadFunction): void {
        if (this.#closed) return
        for (const slot of this.#slots) if (slot && !slot.exited) this.#bound(slot, fn)
    }

    /**
     * Call a function in the least busy thread (with one thread, after the calls made before).
     * @param fn The function.
     * @param args Its arguments.
     * @returns Its value and the errno of the thread after it.
     */
    public call(fn: ThreadFunction, args: unknown[]): Promise<ThreadResult> {
        if (this.#closed) return Promise.reject(new NativeLibraryClosedException(`The library ${this.#data.file} is closed`))
        const slot: Slot = this.#leastBusy()
        const id: number = this.#bound(slot, fn)
        const type: FunctionType = fn.type.type
        const passed: unknown[] = args.slice()
        const back: number[] = []
        const views: Map<number, ArrayBufferView> = new Map()
        const transfer: ArrayBuffer[] = []
        const callbacks: bigint[] = []
        let callbackError: { error: unknown } | undefined
        for (let index: number = 0; index < passed.length; index++) {
            const value: unknown = passed[index]
            const parameter: Parameter | undefined = type.parameters[index]
            //A JS function given as a callback: registered for the call, run in this thread when the library calls it
            if (typeof value === 'function') {
                const target: CType | undefined = parameter?.type.kind === 'pointer' ? parameter.type.to : undefined
                if (!target || target.kind !== 'function') return this.#refuse(callbacks, new TypeError(`The argument ${index} of ${fn.type.name} is a function, but its parameter is not a pointer to a function`))
                const prototype: FunctionType = target
                const zero: unknown = zeroOf(prototype.result)
                const safe = (...callbackArgs: unknown[]): unknown => {
                    try {
                        return (value as (...a: unknown[]) => unknown)(...callbackArgs)
                    } catch (error) {
                        callbackError ??= {error: error}
                        return zero
                    }
                }
                const pointer: bigint = koffi.register(convertedCallback(prototype, TYPES, safe), koffi.pointer(TYPES.prototype(prototype)))
                callbacks.push(pointer)
                passed[index] = pointer
                continue
            }
            //A buffer: its own bytes only, copied and transferred (a Buffer of the pool would copy all its pool); copied
            //back after the call when the function may write it
            if (ArrayBuffer.isView(value)) {
                const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(value.byteLength)
                bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
                //A Buffer as its bytes (koffi takes them as it takes the Buffer)
                const copy: ArrayBufferView = Buffer.isBuffer(value) || value instanceof Uint8Array ? bytes : value instanceof DataView ? new DataView(bytes.buffer) : new (value.constructor as new (buffer: ArrayBuffer) => ArrayBufferView)(bytes.buffer)
                passed[index] = copy
                transfer.push(bytes.buffer)
                if (written(parameter)) {
                    back.push(index)
                    views.set(index, value)
                }
                continue
            }
            //An output parameter: an array of one element, an object filled by the function
            if (parameter && parameter.direction !== 'in' && value && typeof value === 'object') back.push(index)
        }
        const callId: number = this.#nextCall++
        return new Promise((resolve: (result: ThreadResult) => void, reject: (error: Error) => void): void => {
            const release = (): void => {
                for (const pointer of callbacks) koffi.unregister(pointer)
            }
            slot.calls.set(callId, {
                resolve: resolve,
                reject: (error: Error): void => {
                    release()
                    reject(error)
                },
                settle: (message: Extract<FromNativeWorker, { type: 'result' }>): void => {
                    release()
                    //The arguments the function wrote, given back to the caller
                    back.forEach((index: number, at: number): void => {
                        const given: unknown = args[index]
                        const returned: unknown = message.back[at]
                        const view: ArrayBufferView | undefined = views.get(index)
                        if (view && ArrayBuffer.isView(returned)) new Uint8Array(view.buffer, view.byteOffset, view.byteLength).set(new Uint8Array(returned.buffer, returned.byteOffset, returned.byteLength))
                        else if (Array.isArray(given) && Array.isArray(returned)) given.splice(0, given.length, ...returned)
                        else if (given && typeof given === 'object' && returned && typeof returned === 'object') Object.assign(given, returned)
                    })
                    if (callbackError) return reject(callbackError.error as Error)
                    if (message.error) return reject(errorOf(message.error))
                    resolve({value: message.value, errno: message.errno, ...message.windowsError !== undefined ? {windowsError: message.windowsError} : {}})
                }
            })
            try {
                this.#post(slot, {type: 'call', id: callId, function: id, args: passed, back: back}, transfer)
            } catch (error) {
                slot.calls.delete(callId)
                release()
                reject(error as Error)
            }
        })
    }

    /**
     * Stop a thread as if it had ended on its own (for the tests): its calls fail, the next call starts a new one.
     * @param index The index of the thread.
     */
    public async stopThread(index: number): Promise<void> {
        await this.#slots[index]?.worker.terminate()
    }

    /**
     * Close the threads: each unloads the library and ends; the ones still running after a while are stopped.
     */
    public async close(): Promise<void> {
        if (this.#closed) return
        this.#closed = true
        await Promise.all(this.#slots.map(async (slot: Slot | undefined): Promise<void> => {
            if (!slot || slot.exited) return
            const exited: Promise<void> = new Promise((resolve: () => void): void => {
                slot.worker.once('exit', (): void => resolve())
            })
            //A thread still loading the library gets it once loaded: its port keeps the messages until it listens
            this.#post(slot, {type: 'close'})
            let timer: NodeJS.Timeout | undefined
            const timeout: Promise<boolean> = new Promise((resolve: (late: boolean) => void): void => {
                timer = setTimeout((): void => resolve(true), CLOSE_TIMEOUT)
            })
            const late: boolean | void = await Promise.race([exited, timeout])
            clearTimeout(timer)
            if (late) await slot.worker.terminate()
        }))
    }

    /**
     * A call refused before it is sent: its callbacks released
     * @param callbacks
     * @param error
     */
    #refuse(callbacks: bigint[], error: Error): Promise<never> {
        for (const pointer of callbacks) koffi.unregister(pointer)
        return Promise.reject(error)
    }

    /**
     * The identifier of a function in a thread, which binds it once
     * @param slot
     * @param fn
     */
    #bound(slot: Slot, fn: ThreadFunction): number {
        let id: number | undefined = slot.bound.get(fn)
        if (id === undefined) {
            id = this.#nextFunction++
            slot.bound.set(fn, id)
            this.#post(slot, {type: 'bind', id: id, declaration: fn.declaration, named: fn.named, options: fn.options})
        }
        return id
    }

    /**
     * The thread with the fewest calls waiting, started again if it ended
     */
    #leastBusy(): Slot {
        for (let index: number = 0; index < this.#slots.length; index++) {
            if (!this.#slots[index] || this.#slots[index]!.exited) this.#slots[index] = this.#start()
        }
        let chosen: Slot = this.#slots[0]!
        for (const slot of this.#slots) if (slot!.calls.size < chosen.calls.size) chosen = slot!
        return chosen
    }

    /**
     * A message to a thread
     * @param slot
     * @param message
     * @param transfer
     */
    #post(slot: Slot, message: ToNativeWorker, transfer: ArrayBuffer[] = []): void {
        slot.worker.postMessage(message, transfer)
        //Kept alive while calls wait in it
        if (message.type === 'call') slot.worker.ref()
    }

    /**
     * A thread started: it loads the library, then serves its calls
     */
    #start(): Slot {
        const worker: Worker = new Worker(nativeWorkerCode, {eval: true, workerData: {...this.#data, declarations: [this.#data.declarations, ...this.#declarations].join('\n')}})
        let readied: () => void = (): void => undefined
        let failed: (error: Error) => void = (): void => undefined
        const ready: Promise<void> = new Promise((resolve: () => void, reject: (error: Error) => void): void => {
            readied = resolve
            failed = reject
        })
        //Not unhandled when nothing awaits it: the calls report the failure
        ready.catch((): void => undefined)
        const slot: Slot = {worker: worker, ready: ready, calls: new Map(), bound: new Map(), exited: false}
        //A thread keeps the process alive while it starts and while calls wait in it, not once idle
        const refresh = (): void => {
            if (!slot.calls.size) worker.unref()
        }
        worker.on('message', (message: FromNativeWorker): void => {
            switch (message.type) {
                case 'ready':
                    readied()
                    refresh()
                    return
                case 'failed':
                    slot.error = errorOf(message.error)
                    failed(slot.error)
                    refresh()
                    return
                case 'result': {
                    const call: PendingCall | undefined = slot.calls.get(message.id)
                    slot.calls.delete(message.id)
                    refresh()
                    call?.settle(message)
                    return
                }
                case 'closed':
                    return
            }
        })
        const end = (error: Error): void => {
            if (slot.exited) return
            slot.exited = true
            failed(error)
            for (const call of slot.calls.values()) call.reject(slot.error ?? error)
            slot.calls.clear()
        }
        worker.on('error', (error: Error): void => end(error))
        worker.on('exit', (code: number): void => end(new Error(`The worker thread of the library ${this.#data.file} ended (exit code ${code})`)))
        return slot
    }
}

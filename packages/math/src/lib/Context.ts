import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {MathCancelledException} from '../exceptions/MathCancelledException.js'
import {MathTimeoutException} from '../exceptions/MathTimeoutException.js'
import {type Handle, nativeCall, toException} from './Native.js'

/**
 * The options of an asynchronous operation: its cancellation, its time limit
 */
export interface AsyncOptions {
    /**
     * Cancels the operation when aborted: it is rejected with `MathCancelledException`.
     */
    signal?: AbortSignal
    /**
     * The time limit of the operation, in milliseconds: past it, it is rejected with `MathTimeoutException`. The
     * `timeout` of the options of `createMath()` by default.
     */
    timeout?: number
}

/**
 * The settings a context gives its operations
 */
export interface ContextSettings {
    /**
     * The significant digits of `toDecimal()` and of `decimal()` when none are given
     */
    precision: number
    /**
     * The time limit of the asynchronous operations when none is given, in milliseconds (0: none)
     */
    timeout: number
    /**
     * The asynchronous operations running at the same time (the others wait for them)
     */
    concurrency: number
}

/**
 * The asynchronous operations of a scope of `createMath()` and of the scopes of its `with()`: how many run at a time
 * in the threads of the addon. An operation keeps its place until its thread is done with it, even when its promise is
 * already rejected (a time limit, a cancellation).
 */
export class AsyncTracker {
    readonly #waiting: (() => void)[] = []
    #active: number = 0

    constructor(protected readonly concurrency: number) {
    }

    /**
     * Wait for a free place
     */
    public async acquire(): Promise<void> {
        if (this.#active >= this.concurrency) await new Promise<void>((resolve: () => void): unknown => this.#waiting.push(resolve))
        this.#active++
    }

    /**
     * Free a place
     */
    public release(): void {
        this.#active--
        this.#waiting.shift()?.()
    }

    /**
     * Keep a place until an operation is done in its thread
     * @param running
     */
    public hold(running: Promise<unknown>): void {
        running.then((): void => undefined, (): void => undefined).finally((): void => this.release())
    }
}

/**
 * A context of the formulas: a scope of definitions, the settings and the tracker of its operations. `createMath()`
 * makes one; each `with()` makes another over it.
 */
export class Context {

    constructor(public readonly scope: Handle, public readonly settings: ContextSettings, public readonly tracker: AsyncTracker) {
    }

    /**
     * A context over this one, its definitions added
     * @param definitions
     */
    public derive(definitions: Record<string, string | number>): Context {
        return new Context(nativeCall((native) => native.scope(this.scope, definitionsOf(definitions))), this.settings, this.tracker)
    }

    /**
     * Run an operation of the addon in its threads
     * @param operation
     * @param args
     * @param options
     */
    public async runAsync<T>(operation: string, args: unknown[], options: AsyncOptions = {}): Promise<T> {
        const signal: AbortSignal | undefined = options.signal
        if (signal?.aborted) throw new MathCancelledException('The operation is cancelled')
        await this.tracker.acquire()
        if (signal?.aborted) {
            this.tracker.release()
            throw new MathCancelledException('The operation is cancelled')
        }
        let token: Handle
        let running: Promise<T>
        try {
            token = nativeCall((native) => native.token())
            running = nativeCall((native) => native.runAsync(operation, args, token)) as Promise<T>
        } catch (error) {
            this.tracker.release()
            throw error
        }
        this.tracker.hold(running)
        //Rejected at the time limit or the cancellation: the thread stops at its next checkpoint, or finishes first
        return await new Promise<T>((resolve: (value: T) => void, reject: (reason: unknown) => void): void => {
            const timeout: number = options.timeout ?? this.settings.timeout
            let timer: NodeJS.Timeout | undefined
            const finish = (): void => {
                clearTimeout(timer)
                signal?.removeEventListener('abort', abort)
            }
            const stop = (reason: 'cancelled' | 'timeout', exception: unknown): void => {
                finish()
                nativeCall((native) => native.cancel(token, reason))
                reject(exception)
            }
            const abort = (): void => stop('cancelled', new MathCancelledException('The operation is cancelled'))
            if (timeout > 0) timer = setTimeout((): void => stop('timeout', new MathTimeoutException(`The operation took more than ${timeout} ms`)), timeout)
            signal?.addEventListener('abort', abort, {once: true})
            running.then((value: T): void => {
                finish()
                resolve(value)
            }, (error: unknown): void => {
                finish()
                reject(toException(error))
            })
        })
    }

    /**
     * Run an operation of the addon in the thread of JavaScript
     * @param operation
     * @param args
     */
    public run<T>(operation: string, args: unknown[]): T {
        return nativeCall((native) => native.run(operation, args)) as T
    }
}

/**
 * The definitions of the configuration as the addon takes them: [signature, body] pairs
 * @param definitions
 */
export function definitionsOf(definitions: Record<string, string | number>): [string, string][] {
    return Object.entries(definitions).map(([signature, body]: [string, unknown]): [string, string] => {
        if (typeof body !== 'string' && typeof body !== 'number') throw new MathArgumentException(`The definition ${signature}: its body is a formula (a string) or a number`)
        return [signature, String(body)]
    })
}

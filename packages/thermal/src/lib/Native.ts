import {ThermalCancelledException} from '../exceptions/ThermalCancelledException.js'
import {ThermalContentException} from '../exceptions/ThermalContentException.js'
import {ThermalException} from '../exceptions/ThermalException.js'
import {ThermalFontException} from '../exceptions/ThermalFontException.js'
import {ThermalOptionException} from '../exceptions/ThermalOptionException.js'
import {ThermalTimeoutException} from '../exceptions/ThermalTimeoutException.js'
import {addon} from './Addon.js'

/**
 * A page as the addon gives it: its rows of bits, (width + 7) / 8 bytes each, 1 a black dot
 */
export interface NativePage {
    width: number
    height: number
    rows: Buffer
}

/**
 * The options of a rendering as the addon reads them (sizes in dots)
 */
export interface NativeRenderOptions {
    width: number
    scale: number
    pageLength: number
    paginate: boolean
    lead: number
    rotate: number
    maxLength: number
    baseDirectory: string
    language: string
    userStyles: string
}

/**
 * The functions of the addon (native/addon.cpp)
 */
interface Addon {
    render(html: string, options: NativeRenderOptions, token: unknown): Promise<NativePage[]>
    registerFont(options: {family: string, weight: number, italic: boolean, index: number, path?: string, data?: Uint8Array}): number
    png(rows: Uint8Array, width: number, height: number): Buffer
    words(text: string, language: string): string[]
    token(): unknown
    cancel(token: unknown, reason: 'cancelled' | 'timeout'): void
    versions(): {litehtml: string, freetype: string, plutovg: string, lunasvg: string, libunibreak: string, threads: number}
}

/**
 * The addon of the package
 */
export const native: Addon = addon as Addon

/**
 * The exception of an error of the addon, by its code
 * @param error
 */
export function exceptionOf(error: unknown): Error {
    if (error instanceof ThermalException) return error
    const message: string = error instanceof Error ? error.message : String(error)
    switch ((error as {code?: string} | undefined)?.code) {
        case 'argument':
            return new ThermalOptionException(message)
        case 'font':
            return new ThermalFontException(message)
        case 'content':
        case 'size':
            return new ThermalContentException(message)
        case 'cancelled':
            return new ThermalCancelledException(message)
        case 'timeout':
            return new ThermalTimeoutException(message)
        default:
            return new ThermalException(message)
    }
}

/**
 * Run an operation of the addon with its cancellation: its signal and its time limit reject it at once, and drop it if
 * it has not started (a running one cannot be stopped: its result is discarded)
 * @param start the operation, given its token
 * @param signal
 * @param timeout milliseconds, 0 for none
 */
export async function runOperation<T>(start: (token: unknown) => Promise<T>, signal: AbortSignal | undefined, timeout: number): Promise<T> {
    if (signal?.aborted) throw new ThermalCancelledException('The operation is cancelled')
    const token: unknown = native.token()
    let stop: (() => void) | undefined
    const stopped = new Promise<never>((_resolve, reject): void => {
        const timer: NodeJS.Timeout | undefined = timeout > 0 ? setTimeout((): void => {
            native.cancel(token, 'timeout')
            reject(new ThermalTimeoutException('The operation took longer than its timeout ({0} ms)', timeout))
        }, timeout) : undefined
        const abort = (): void => {
            native.cancel(token, 'cancelled')
            reject(new ThermalCancelledException('The operation is cancelled'))
        }
        signal?.addEventListener('abort', abort, {once: true})
        stop = (): void => {
            if (timer) clearTimeout(timer)
            signal?.removeEventListener('abort', abort)
        }
    })
    //The arguments are checked when the operation starts: their errors are thrown as the ones of the operation
    const operation: Promise<T> = new Promise<T>((resolve): void => resolve(start(token)))
    //Settled after the operation is rejected by its signal or its time limit: nothing waits for it
    operation.catch((): void => undefined)
    stopped.catch((): void => undefined)
    try {
        return await Promise.race([operation, stopped])
    } catch (error) {
        throw exceptionOf(error)
    } finally {
        stop?.()
    }
}

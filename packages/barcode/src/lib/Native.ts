import {BarcodeCancelledException} from '../exceptions/BarcodeCancelledException.js'
import {BarcodeContentException} from '../exceptions/BarcodeContentException.js'
import {BarcodeException} from '../exceptions/BarcodeException.js'
import {BarcodeImageException} from '../exceptions/BarcodeImageException.js'
import {BarcodeOptionException} from '../exceptions/BarcodeOptionException.js'
import {BarcodeTimeoutException} from '../exceptions/BarcodeTimeoutException.js'
import {addon} from './Addon.js'
import type {BarcodeFormatInfo} from './Types.js'

/**
 * A code read, as the addon gives it
 */
export interface NativeResult {
    format: string
    text: string
    bytes: Buffer
    //topLeft, topRight, bottomRight, bottomLeft: x, y
    position: number[]
    orientation: number
    errorCorrectionLevel: string
    version: string
    symbologyIdentifier: string
    addOn: string
    gs1: boolean
    mirrored: boolean
    inverted: boolean
    sequenceIndex: number
    sequenceSize: number
    sequenceId: string
}

/**
 * The functions of the addon (native/addon.cpp)
 */
interface Addon {
    generate(format: string, content: Uint8Array, binary: boolean, options: object, token: unknown): Promise<{type: string, data: Buffer, width: number, height: number, channels: number}>
    read(image: Uint8Array, raw: {width: number, height: number, channels: number} | null, options: object, token: unknown): Promise<NativeResult[]>
    formats(): BarcodeFormatInfo[]
    token(): unknown
    cancel(token: unknown, reason: 'cancelled' | 'timeout'): void
    versions(): {zint: string, zxing: string, wuffs: string, threads: number}
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
    if (error instanceof BarcodeException) return error
    const message: string = error instanceof Error ? error.message : String(error)
    switch ((error as {code?: string} | undefined)?.code) {
        case 'content':
            return new BarcodeContentException(message)
        case 'option':
            return new BarcodeOptionException(message)
        case 'image':
            return new BarcodeImageException(message)
        case 'cancelled':
            return new BarcodeCancelledException(message)
        case 'timeout':
            return new BarcodeTimeoutException(message)
        default:
            return new BarcodeException(message)
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
    if (signal?.aborted) throw new BarcodeCancelledException('The operation is cancelled')
    const token: unknown = native.token()
    let stop: (() => void) | undefined
    const stopped = new Promise<never>((_resolve, reject): void => {
        const timer: NodeJS.Timeout | undefined = timeout > 0 ? setTimeout((): void => {
            native.cancel(token, 'timeout')
            reject(new BarcodeTimeoutException('The operation took longer than its timeout ({0} ms)', timeout))
        }, timeout) : undefined
        const abort = (): void => {
            native.cancel(token, 'cancelled')
            reject(new BarcodeCancelledException('The operation is cancelled'))
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

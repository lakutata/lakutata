import {SerialException} from '../exceptions/SerialException.js'
import {addon} from './Addon.js'
import type {SerialLineOptions, SerialPortInfo} from './Types.js'

/**
 * An open port of the addon
 */
export type NativePort = object

/**
 * The settings of a line, all given
 */
export type LineSettings = Required<SerialLineOptions>

/**
 * What the thread of a port tells: the port open, a request done or failed, data received, the port dead (the device
 * gone), the port closed (its thread ended)
 */
type EventKind = 'opened' | 'result' | 'failed' | 'data' | 'fatal' | 'closed'

/**
 * The functions of the addon: the requests go to the thread of the port, their results come back as events
 */
export interface NativeSerial {
    open(path: string, settings: LineSettings, exclusive: boolean, onEvent: (kind: EventKind, id: number, value: unknown) => void): NativePort
    write(port: NativePort, id: number, data: Buffer): void
    drain(port: NativePort, id: number, stall: number, limit: number): void
    configure(port: NativePort, id: number, settings: LineSettings): void
    flush(port: NativePort, id: number, input: boolean, output: boolean): void
    signals(port: NativePort, id: number): void
    setSignals(port: NativePort, id: number, dtr: number, rts: number, brk: number): void
    read(port: NativePort, wanted: boolean): void
    close(port: NativePort, id: number, discard: boolean): void
    list(): Promise<SerialPortInfo[] | null>
}

export const native: NativeSerial = addon as NativeSerial

/**
 * An exception of a failure of the addon: what failed, the message of the system, its code, whether the device is gone
 * @param error
 * @param what
 */
export function exceptionOf(error: unknown, what: string): SerialException {
    if (error instanceof SerialException) return error
    const exception: SerialException = new SerialException(`${what}: ${error instanceof Error ? error.message : String(error)}`)
    const code: unknown = (error as {code?: unknown})?.code
    if (typeof code === 'string') exception.code = code
    if ((error as {disconnected?: unknown})?.disconnected === true) exception.disconnected = true
    return exception
}

/**
 * An exception of options refused
 * @param message
 */
export function invalid(message: string): SerialException {
    const exception: SerialException = new SerialException(message)
    exception.code = 'EINVAL'
    return exception
}

/**
 * The settings of a line: the ones given checked, the defaults for the others
 * @param options
 * @param current the settings the ones not given keep
 */
export function settingsOf(options: SerialLineOptions, current?: LineSettings): LineSettings {
    const settings: LineSettings = {
        baudRate: options.baudRate ?? current?.baudRate ?? 9600,
        dataBits: options.dataBits ?? current?.dataBits ?? 8,
        stopBits: options.stopBits ?? current?.stopBits ?? 1,
        parity: options.parity ?? current?.parity ?? 'none',
        flowControl: options.flowControl ?? current?.flowControl ?? 'none',
        stallTimeout: options.stallTimeout ?? current?.stallTimeout ?? 0
    }
    if (!Number.isInteger(settings.baudRate) || settings.baudRate <= 0 || settings.baudRate > 0xFFFFFFFF) throw invalid(`The speed ${settings.baudRate} is not a positive integer`)
    if (![5, 6, 7, 8].includes(settings.dataBits)) throw invalid(`The data bits ${settings.dataBits} are not 5, 6, 7 or 8`)
    if (![1, 1.5, 2].includes(settings.stopBits)) throw invalid(`The stop bits ${settings.stopBits} are not 1, 1.5 or 2`)
    if (!['none', 'even', 'odd', 'mark', 'space'].includes(settings.parity)) throw invalid(`The parity ${settings.parity} is not none, even, odd, mark or space`)
    if (!['none', 'rts/cts', 'xon/xoff', 'dtr/dsr'].includes(settings.flowControl)) throw invalid(`The flow control ${settings.flowControl} is not none, rts/cts, xon/xoff or dtr/dsr`)
    //The frames the UARTs of Windows refuse (as their documentation lists them)
    if (settings.stopBits === 1.5 && settings.dataBits !== 5) throw invalid('1.5 stop bits go with 5 data bits only')
    if (process.platform === 'win32' && settings.stopBits === 2 && settings.dataBits === 5) throw invalid('2 stop bits do not go with 5 data bits on Windows')
    if (typeof settings.stallTimeout !== 'number' || !(settings.stallTimeout >= 0)) throw invalid(`The stall timeout ${settings.stallTimeout} is not a number of milliseconds`)
    return settings
}

interface Pending {
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
    closing: boolean
}

/**
 * The requests of a port to its thread and their results, by their ids (0 is the opening)
 */
export class PortClient {
    public readonly port: NativePort

    /**
     * Once the thread opened the port, or failed to
     */
    public readonly ready: Promise<void>

    public onData: (data: Buffer) => void = (): void => undefined

    public onFatal: (error: unknown) => void = (error: unknown): void => {
        this.fatal = error
    }

    /**
     * The failure that killed the port before anyone listened
     */
    public fatal: unknown

    public closed: boolean = false

    #nextId: number = 1

    readonly #pending: Map<number, Pending> = new Map()

    #opened: {resolve: () => void, reject: (error: unknown) => void} | undefined

    constructor(path: string, settings: LineSettings, exclusive: boolean) {
        this.ready = new Promise<void>((resolve, reject): void => {
            this.#opened = {resolve, reject}
        })
        this.ready.catch((): void => undefined)
        this.port = native.open(path, settings, exclusive, (kind: EventKind, id: number, value: unknown): void => this.#event(kind, id, value))
    }

    /**
     * A request to the thread, settled by its result
     * @param send the call of the addon, given the id of the request
     * @param closing whether it is a closing (settled when the thread ends)
     */
    public request<T = void>(send: (id: number) => void, closing: boolean = false): Promise<T> {
        if (this.closed) return Promise.reject(closedFailure())
        const id: number = this.#nextId++
        return new Promise<T>((resolve, reject): void => {
            this.#pending.set(id, {resolve: resolve as (value: unknown) => void, reject, closing})
            try {
                send(id)
            } catch (error) {
                this.#pending.delete(id)
                reject(error)
            }
        })
    }

    #event(kind: EventKind, id: number, value: unknown): void {
        switch (kind) {
            case 'opened':
                this.#opened?.resolve()
                return
            case 'result':
            case 'failed': {
                if (id === 0) return this.#opened?.reject(value)
                const pending: Pending | undefined = this.#pending.get(id)
                if (!pending) return
                this.#pending.delete(id)
                if (kind === 'result') pending.resolve(value)
                else pending.reject(value)
                return
            }
            case 'data':
                this.onData(value as Buffer)
                return
            case 'fatal':
                this.onFatal(value)
                return
            case 'closed':
                this.closed = true
                this.#opened?.reject(closedFailure())
                for (const pending of this.#pending.values()) {
                    if (pending.closing) pending.resolve(undefined)
                    else pending.reject(closedFailure())
                }
                this.#pending.clear()
        }
    }
}

/**
 * The failure of a request to a closed port
 */
function closedFailure(): Error {
    return Object.assign(new Error('The port is closed'), {code: 'ECANCELED'})
}

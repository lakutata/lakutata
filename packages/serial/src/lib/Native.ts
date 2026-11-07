import {SerialException} from '../exceptions/SerialException.js'
import {addon} from './Addon.js'
import type {SerialLineOptions, SerialPortInfo, SerialSignals} from './Types.js'

/**
 * An open port of the addon
 */
export type NativePort = object

/**
 * The settings of a line, all given
 */
export type LineSettings = Required<SerialLineOptions>

/**
 * The functions of the addon
 */
export interface NativeSerial {
    open(path: string, settings: LineSettings, exclusive: boolean): Promise<NativePort>
    configure(port: NativePort, settings: LineSettings): void
    write(port: NativePort, data: Buffer): Promise<number>
    read(port: NativePort, buffer: Buffer): Promise<number>
    drain(port: NativePort): Promise<void>
    flush(port: NativePort, input: boolean, output: boolean): void
    close(port: NativePort, discard: boolean): Promise<void>
    signals(port: NativePort): SerialSignals
    setSignals(port: NativePort, dtr: number, rts: number, brk: number): void
    list(): SerialPortInfo[] | null
}

export const native: NativeSerial = addon as NativeSerial

/**
 * An exception of a failure of the addon: what failed, the message of the system, its code
 * @param error
 * @param what
 */
export function exceptionOf(error: unknown, what: string): SerialException {
    if (error instanceof SerialException) return error
    const exception: SerialException = new SerialException(`${what}: ${error instanceof Error ? error.message : String(error)}`)
    const code: unknown = (error as {code?: unknown})?.code
    if (typeof code === 'string') exception.code = code
    return exception
}

/**
 * An exception of options refused
 * @param message
 */
function invalid(message: string): SerialException {
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
        flowControl: options.flowControl ?? current?.flowControl ?? 'none'
    }
    if (!Number.isInteger(settings.baudRate) || settings.baudRate <= 0 || settings.baudRate > 0xFFFFFFFF) throw invalid(`The speed ${settings.baudRate} is not a positive integer`)
    if (![5, 6, 7, 8].includes(settings.dataBits)) throw invalid(`The data bits ${settings.dataBits} are not 5, 6, 7 or 8`)
    if (![1, 1.5, 2].includes(settings.stopBits)) throw invalid(`The stop bits ${settings.stopBits} are not 1, 1.5 or 2`)
    if (!['none', 'even', 'odd', 'mark', 'space'].includes(settings.parity)) throw invalid(`The parity ${settings.parity} is not none, even, odd, mark or space`)
    if (!['none', 'rts/cts', 'xon/xoff'].includes(settings.flowControl)) throw invalid(`The flow control ${settings.flowControl} is not none, rts/cts or xon/xoff`)
    return settings
}

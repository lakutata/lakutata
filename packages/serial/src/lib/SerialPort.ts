import {Duplex} from 'node:stream'
import {setTimeout as sleep} from 'node:timers/promises'
import {SerialException} from '../exceptions/SerialException.js'
import {exceptionOf, type LineSettings, native, type NativePort, settingsOf} from './Native.js'
import type {SerialLineOptions, SerialPortOptions, SerialSignalOptions, SerialSignals} from './Types.js'

/**
 * The size of the buffer of the reads
 */
const READ_SIZE: number = 16384

/**
 * An open serial port: a stream whose writes are sent on the line and whose reads are what the line receives. Its
 * `end()` waits for its data to be sent (`'finish'`), its `close()` closes it, its `destroy()` closes it at once (the
 * data not sent yet discarded). Opened by {@link openSerialPort}.
 * @example
 * ```typescript
 * import {openSerialPort} from '@lakutata/serial'
 * const port = await openSerialPort({path: '/dev/ttyUSB0', baudRate: 115200})
 * port.on('data', (data: Buffer) => console.log(data))
 * port.write('AT\r')
 * ```
 */
export class SerialPort extends Duplex {
    /**
     * Its path.
     */
    public readonly path: string

    readonly #port: NativePort

    #settings: LineSettings

    #reading: boolean = false

    #closed: Promise<void> | undefined

    /**
     * A port opened by the addon (opened by {@link openSerialPort}, not constructed directly).
     * @param path Its path.
     * @param port The port of the addon.
     * @param settings The settings of its line.
     */
    constructor(path: string, port: object, settings: Required<SerialLineOptions>) {
        super({allowHalfOpen: true})
        this.path = path
        this.#port = port
        this.#settings = settings
    }

    /**
     * Its speed in bits a second.
     */
    public get baudRate(): number {
        return this.#settings.baudRate
    }

    /**
     * The settings of its line.
     */
    public get settings(): Readonly<Required<SerialLineOptions>> {
        return {...this.#settings}
    }

    /**
     * Change the settings of its line (the ones given; the others stay).
     * @param options The settings.
     * @throws {SerialException} The port or the system refuses them.
     * @example
     * ```typescript
     * port.update({baudRate: 38400})
     * ```
     */
    public update(options: SerialLineOptions): void {
        const settings: LineSettings = settingsOf(options, this.#settings)
        try {
            native.configure(this.#port, settings)
        } catch (error) {
            throw exceptionOf(error, `The serial port ${this.path} refuses the settings`)
        }
        this.#settings = settings
    }

    /**
     * The input lines of its modem.
     * @returns CTS, DSR, DCD and RI.
     * @throws {SerialException} The port has no modem lines (a pseudo-terminal).
     * @example
     * ```typescript
     * const {cts, dsr} = port.getSignals()
     * ```
     */
    public getSignals(): SerialSignals {
        try {
            return native.signals(this.#port)
        } catch (error) {
            throw exceptionOf(error, `The lines of the serial port ${this.path} cannot be read`)
        }
    }

    /**
     * Set output lines of its modem (the ones given).
     * @param signals DTR, RTS, a break.
     * @throws {SerialException} The port has no modem lines.
     * @example
     * ```typescript
     * port.setSignals({dtr: false})
     * ```
     */
    public setSignals(signals: SerialSignalOptions): void {
        const level = (value: boolean | undefined): number => value === undefined ? -1 : value ? 1 : 0
        try {
            native.setSignals(this.#port, level(signals.dtr), level(signals.rts), level(signals.break))
        } catch (error) {
            throw exceptionOf(error, `The lines of the serial port ${this.path} cannot be set`)
        }
    }

    /**
     * Wait for the data written so far to be sent on the line.
     * @returns Once they are sent.
     * @example
     * ```typescript
     * port.write(Buffer.from([0x1B, 0x40]))
     * await port.drain()
     * ```
     */
    public async drain(): Promise<void> {
        //The writes queued in the stream, then the output of the system
        if (this.writableLength > 0) {
            await new Promise<void>((resolve, reject): void => {
                this.write(Buffer.alloc(0), (error?: Error | null): void => error ? reject(error) : resolve())
            })
        }
        try {
            await native.drain(this.#port)
        } catch (error) {
            throw exceptionOf(error, `The output of the serial port ${this.path} cannot be waited for`)
        }
    }

    /**
     * Discard the data received and not read yet, and the data written and not sent yet.
     * @param which What is discarded.
     * @example
     * ```typescript
     * port.flush('input')
     * ```
     */
    public flush(which: 'input' | 'output' | 'both' = 'both'): void {
        try {
            native.flush(this.#port, which !== 'output', which !== 'input')
        } catch (error) {
            throw exceptionOf(error, `The serial port ${this.path} cannot be flushed`)
        }
    }

    /**
     * Close it once its data are sent.
     * @returns Once it is closed.
     * @example
     * ```typescript
     * port.write('bye\r')
     * await port.close()
     * ```
     */
    public close(): Promise<void> {
        return this.#closed ??= new Promise<void>((resolve, reject): void => {
            const closed = (): void => {
                this.off('error', failed)
                resolve()
            }
            const failed = (error: Error): void => {
                this.off('close', closed)
                reject(error)
            }
            this.once('close', closed)
            this.once('error', failed)
            if (this.destroyed) return
            if (this.writableEnded) {
                this.destroy()
                return
            }
            this.end((): void => {
                this.destroy()
            })
        })
    }

    /**
     * A write: sent in slices until all of it is taken
     * @param chunk
     * @param _encoding
     * @param callback
     * @protected
     */
    public _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        void (async (): Promise<void> => {
            let offset: number = 0
            while (offset < chunk.length) {
                if (this.destroyed) throw new SerialException(`The serial port ${this.path} is closed`)
                offset += await native.write(this.#port, chunk.subarray(offset))
            }
        })().then((): void => callback(), (error: unknown): void => callback(exceptionOf(error, `The serial port ${this.path} cannot be written`)))
    }

    /**
     * The end of the writes: once their data are sent on the line
     * @param callback
     * @protected
     */
    public _final(callback: (error?: Error | null) => void): void {
        native.drain(this.#port).then((): void => callback(), (error: unknown): void => callback(exceptionOf(error, `The output of the serial port ${this.path} cannot be waited for`)))
    }

    /**
     * The reads: a loop of slices while the reader wants data
     * @protected
     */
    public _read(): void {
        if (this.#reading) return
        this.#reading = true
        void (async (): Promise<void> => {
            const buffer: Buffer = Buffer.allocUnsafe(READ_SIZE)
            try {
                while (!this.destroyed) {
                    const started: number = Date.now()
                    const length: number = await native.read(this.#port, buffer)
                    if (this.destroyed) break
                    if (length === 0) {
                        //Nothing came within the slice; a slice ended early with nothing (the system woke it) waits a bit
                        if (Date.now() - started < 20) await sleep(20)
                        continue
                    }
                    if (!this.push(Buffer.from(buffer.subarray(0, length)))) break
                }
            } catch (error) {
                if (!this.destroyed) this.destroy(exceptionOf(error, `The serial port ${this.path} cannot be read`))
            } finally {
                this.#reading = false
            }
        })()
    }

    /**
     * The closing: the operations running end within their slice, the data not sent are discarded unless the writes
     * ended
     * @param error
     * @param callback
     * @protected
     */
    public _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        native.close(this.#port, !this.writableFinished).then((): void => callback(error), (closing: unknown): void => callback(error ?? exceptionOf(closing, `The serial port ${this.path} cannot be closed`)))
    }
}

/**
 * Open a serial port, its line set as given.
 * @param options Its path and the settings of its line.
 * @returns The port, a stream.
 * @throws {SerialException} The port cannot be opened (`code`: `'ENOENT'` no such port, `'EBUSY'` open elsewhere,
 * `'EACCES'` not allowed, `'ENOTTY'` not a serial port) or refuses the settings (`'EINVAL'`).
 * @example
 * ```typescript
 * import {openSerialPort} from '@lakutata/serial'
 * const port = await openSerialPort({path: 'COM3', baudRate: 9600, flowControl: 'rts/cts'})
 * port.write(Buffer.from([0x1B, 0x40, 0x0A]))
 * await port.close()
 * ```
 */
export async function openSerialPort(options: SerialPortOptions): Promise<SerialPort> {
    if (!options || typeof options.path !== 'string' || !options.path) {
        const exception: SerialException = new SerialException('A serial port is opened by its path')
        exception.code = 'EINVAL'
        throw exception
    }
    const settings: LineSettings = settingsOf(options)
    try {
        return new SerialPort(options.path, await native.open(options.path, settings, options.exclusive ?? true), settings)
    } catch (error) {
        throw exceptionOf(error, `The serial port ${options.path} cannot be opened`)
    }
}

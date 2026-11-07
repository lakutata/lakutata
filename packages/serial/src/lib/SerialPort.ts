import {Duplex} from 'node:stream'
import {SerialException} from '../exceptions/SerialException.js'
import {exceptionOf, invalid, type LineSettings, native, PortClient, settingsOf} from './Native.js'
import type {
    SerialCloseOptions,
    SerialDrainOptions,
    SerialLineOptions,
    SerialPortOptions,
    SerialSignalOptions,
    SerialSignals
} from './Types.js'

/**
 * How long a closing waits for an output that stopped moving, by default
 */
const CLOSE_STALL: number = 10000

/**
 * An open serial port: a stream whose writes are sent on the line and whose reads are what the line receives. Each
 * port has a thread of its own for its reads, writes and settings. Its `end()` waits for its data to be sent
 * (`'finish'`), its `close()` closes it once they are sent, its `destroy()` closes it at once (the data not sent
 * discarded). When the device goes away the stream fails (`'error'`, a `SerialException` whose `disconnected` is true),
 * so an `'error'` listener is needed. Opened by {@link openSerialPort}.
 * @example
 * ```typescript
 * import {openSerialPort} from '@lakutata/serial'
 * const port = await openSerialPort({path: '/dev/ttyUSB0', baudRate: 115200})
 * port.on('error', (error: Error) => console.error(error))
 * port.on('data', (data: Buffer) => console.log(data))
 * port.write('AT\r')
 * ```
 */
export class SerialPort extends Duplex {
    /**
     * Its path.
     */
    public readonly path: string

    readonly #client: PortClient

    #settings: LineSettings

    #reading: boolean = false

    #closeStall: number | undefined

    #closing: Promise<void> | undefined

    /**
     * A port opened by its thread (opened by {@link openSerialPort}, not constructed directly).
     * @param path Its path.
     * @param client The requests to its thread.
     * @param settings The settings of its line.
     */
    constructor(path: string, client: object, settings: Required<SerialLineOptions>) {
        super({allowHalfOpen: true})
        this.path = path
        this.#client = client as PortClient
        this.#settings = settings
        this.#client.onData = (data: Buffer): void => {
            if (!this.push(data)) this.#read(false)
        }
        this.#client.onFatal = (error: unknown): void => {
            this.destroy(exceptionOf(error, `The serial port ${this.path} failed`))
        }
        if (this.#client.fatal) process.nextTick((): void => {
            this.destroy(exceptionOf(this.#client.fatal, `The serial port ${this.path} failed`))
        })
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
     * Change the settings of its line (the ones given; the others stay), after the writes before it are sent.
     * @param options The settings.
     * @returns Once they are set.
     * @throws {SerialException} The port or the system refuses them (`'EINVAL'`).
     * @example
     * ```typescript
     * await port.update({baudRate: 38400})
     * ```
     */
    public async update(options: SerialLineOptions): Promise<void> {
        const settings: LineSettings = settingsOf(options, this.#settings)
        try {
            await this.#client.request((id: number): void => native.configure(this.#client.port, id, settings))
        } catch (error) {
            throw exceptionOf(error, `The serial port ${this.path} refuses the settings`)
        }
        this.#settings = settings
    }

    /**
     * The input lines of its modem.
     * @returns CTS, DSR, DCD and RI.
     * @throws {SerialException} The port has no modem lines (a pseudo-terminal, some USB devices).
     * @example
     * ```typescript
     * const {cts, dsr} = await port.getSignals()
     * ```
     */
    public async getSignals(): Promise<SerialSignals> {
        try {
            return await this.#client.request<SerialSignals>((id: number): void => native.signals(this.#client.port, id))
        } catch (error) {
            throw exceptionOf(error, `The lines of the serial port ${this.path} cannot be read`)
        }
    }

    /**
     * Set output lines of its modem (the ones given).
     * @param signals DTR, RTS (not with the RTS/CTS flow control, which drives it), a break.
     * @returns Once they are set.
     * @throws {SerialException} The port has no modem lines, or RTS is driven by the flow control (`'EINVAL'`).
     * @example
     * ```typescript
     * await port.setSignals({dtr: false})
     * ```
     */
    public async setSignals(signals: SerialSignalOptions): Promise<void> {
        const level = (value: boolean | undefined): number => value === undefined ? -1 : value ? 1 : 0
        try {
            await this.#client.request((id: number): void => native.setSignals(this.#client.port, id, level(signals.dtr), level(signals.rts), level(signals.break)))
        } catch (error) {
            throw exceptionOf(error, `The lines of the serial port ${this.path} cannot be set`)
        }
    }

    /**
     * Wait for the data written so far to be sent on the line.
     * @param options How long the output may stop moving, and how long the wait may last.
     * @returns Once they are sent.
     * @throws {SerialException} The output stopped moving, or took too long (`'ETIMEDOUT'`); the data stay queued.
     * @example
     * ```typescript
     * port.write(Buffer.from([0x1B, 0x40]))
     * await port.drain({stallTimeout: 5000})
     * ```
     */
    public async drain(options: SerialDrainOptions = {}): Promise<void> {
        //The writes queued in the stream first
        if (this.writableLength > 0) {
            await new Promise<void>((resolve, reject): void => {
                this.write(Buffer.alloc(0), (error?: Error | null): void => error ? reject(error) : resolve())
            })
        }
        const stall: number = options.stallTimeout ?? this.#settings.stallTimeout
        const limit: number = options.timeout ?? 0
        if (!(stall >= 0) || !(limit >= 0)) throw invalid('The times of a drain are numbers of milliseconds')
        try {
            await this.#client.request((id: number): void => native.drain(this.#client.port, id, stall, limit))
        } catch (error) {
            throw exceptionOf(error, `The output of the serial port ${this.path} was not sent`)
        }
    }

    /**
     * Discard the data received and not read yet, and the data handed to the system and not sent yet.
     * @param which What is discarded.
     * @returns Once they are discarded.
     * @example
     * ```typescript
     * await port.flush('input')
     * ```
     */
    public async flush(which: 'input' | 'output' | 'both' = 'both'): Promise<void> {
        try {
            await this.#client.request((id: number): void => native.flush(this.#client.port, id, which !== 'output', which !== 'input'))
        } catch (error) {
            throw exceptionOf(error, `The serial port ${this.path} cannot be flushed`)
        }
    }

    /**
     * Close it once its data are sent. When the output stops moving for longer than `stallTimeout` (a device holding
     * CTS low, a printer out of paper), the data left are discarded, the port is closed, and the closing rejects.
     * @param options How long the output may stop moving.
     * @returns Once it is closed.
     * @throws {SerialException} The output had to be discarded (`'ETIMEDOUT'`), or the port failed; it is closed.
     * @example
     * ```typescript
     * port.write('bye\r')
     * await port.close()
     * ```
     */
    public close(options: SerialCloseOptions = {}): Promise<void> {
        const stall: number = options.stallTimeout ?? CLOSE_STALL
        if (!(stall >= 0)) return Promise.reject(invalid('The stall timeout of a closing is a number of milliseconds'))
        this.#closeStall = stall
        //A write stuck on a stopped output never lets the stream reach its end (_final): a drain sent now bounds it, the
        //write failing once the output stopped for that long
        if (!this.destroyed && !this.#client.closed) this.#client.request((id: number): void => native.drain(this.#client.port, id, stall, 0)).catch((): void => undefined)
        return this.#closing ??= new Promise<void>((resolve, reject): void => {
            let failure: Error | undefined
            const failed = (error: Error): void => {
                failure = error
            }
            this.on('error', failed)
            const closed = (): void => {
                this.off('error', failed)
                if (failure) reject(failure)
                else resolve()
            }
            if (this.closed) return closed()
            this.once('close', closed)
            if (this.destroyed) return
            if (this.writableFinished) {
                this.destroy()
                return
            }
            //Ended: closed; a failure (the output stopped, the device gone) destroys the stream with its error
            this.end((error?: Error | null): void => {
                if (!error) this.destroy()
            })
        })
    }

    #read(wanted: boolean): void {
        if (wanted === this.#reading || this.#client.closed) return
        this.#reading = wanted
        try {
            native.read(this.#client.port, wanted)
        } catch {
            //Closed meanwhile
        }
    }

    #write(data: Buffer, callback: (error?: Error | null) => void): void {
        this.#client.request((id: number): void => native.write(this.#client.port, id, data)).then(
            (): void => callback(),
            (error: unknown): void => callback(exceptionOf(error, `The serial port ${this.path} cannot be written`))
        )
    }

    /**
     * A write: sent by the thread of the port
     * @param chunk
     * @param _encoding
     * @param callback
     * @protected
     */
    public _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.#write(chunk, callback)
    }

    /**
     * The writes queued meanwhile: sent as one
     * @param chunks
     * @param callback
     * @protected
     */
    public _writev(chunks: Array<{chunk: Buffer, encoding: BufferEncoding}>, callback: (error?: Error | null) => void): void {
        this.#write(Buffer.concat(chunks.map((entry: {chunk: Buffer}): Buffer => entry.chunk)), callback)
    }

    /**
     * The end of the writes: once their data are sent on the line, or the output stopped for too long
     * @param callback
     * @protected
     */
    public _final(callback: (error?: Error | null) => void): void {
        const stall: number = this.#closeStall ?? this.#settings.stallTimeout
        this.#client.request((id: number): void => native.drain(this.#client.port, id, stall, 0)).then(
            (): void => callback(),
            (error: unknown): void => callback(exceptionOf(error, `The output of the serial port ${this.path} was not sent`))
        )
    }

    /**
     * The reads: the thread reads while the reader wants data
     * @protected
     */
    public _read(): void {
        this.#read(true)
    }

    /**
     * The closing: by the thread of the port, the data not sent discarded unless the writes ended
     * @param error
     * @param callback
     * @protected
     */
    public _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        if (this.#client.closed) return callback(error)
        this.#client.request((id: number): void => native.close(this.#client.port, id, !this.writableFinished), true).then(
            (): void => callback(error),
            (closing: unknown): void => callback(error ?? exceptionOf(closing, `The serial port ${this.path} cannot be closed`))
        )
    }
}

/**
 * Open a serial port, its line set as given.
 * @param options Its path, the settings of its line, the time the opening may take.
 * @returns The port, a stream.
 * @throws {SerialException} The port cannot be opened (`code`: `'ENOENT'` no such port, `'EBUSY'` open elsewhere,
 * `'EACCES'` not allowed, `'ENOTTY'` not a serial port, `'ETIMEDOUT'` the opening took too long) or refuses the
 * settings (`'EINVAL'`).
 * @example
 * ```typescript
 * import {openSerialPort} from '@lakutata/serial'
 * const port = await openSerialPort({path: 'COM3', baudRate: 9600, flowControl: 'rts/cts'})
 * port.write(Buffer.from([0x1B, 0x40, 0x0A]))
 * await port.close()
 * ```
 */
export async function openSerialPort(options: SerialPortOptions): Promise<SerialPort> {
    if (!options || typeof options.path !== 'string' || !options.path) throw invalid('A serial port is opened by its path')
    return await openPort(options.path, settingsOf(options), options.exclusive ?? true, options.openTimeout ?? 30000, `The serial port ${options.path}`)
}

/**
 * Open a port by its thread, within a time limit: a serial port, or a Bluetooth device by its socket
 * @param path
 * @param settings
 * @param exclusive
 * @param timeout
 * @param what
 * @param bluetooth
 */
export async function openPort(path: string, settings: LineSettings, exclusive: boolean, timeout: number, what: string, bluetooth?: {address: string, channel: number}): Promise<SerialPort> {
    if (!(timeout >= 0)) throw invalid('The open timeout is a number of milliseconds')
    const options = {path}
    let client: PortClient
    try {
        client = new PortClient(path, settings, exclusive, bluetooth)
    } catch (error) {
        throw exceptionOf(error, `${what} cannot be opened`)
    }
    let timer: NodeJS.Timeout | undefined
    try {
        await Promise.race([
            client.ready,
            new Promise<never>((_resolve, reject): void => {
                if (timeout > 0) timer = setTimeout((): void => {
                    const exception: SerialException = new SerialException(`${what} did not open within ${timeout} ms`)
                    exception.code = 'ETIMEDOUT'
                    reject(exception)
                }, timeout)
            })
        ])
    } catch (error) {
        //Its thread closes it once the opening returns
        if (!client.closed) client.request((id: number): void => native.close(client.port, id, true), true).catch((): void => undefined)
        throw exceptionOf(error, `${what} cannot be opened`)
    } finally {
        clearTimeout(timer)
    }
    return new SerialPort(options.path, client, settings)
}

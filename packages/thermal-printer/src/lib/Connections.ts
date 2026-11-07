import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process'
import {connect, type Socket} from 'node:net'
import type {Duplex, Writable} from 'node:stream'
import {setTimeout as sleep} from 'node:timers/promises'
import {ThermalPrinterConnectionException} from '../exceptions/ThermalPrinterConnectionException.js'
import {ThermalPrinterException} from '../exceptions/ThermalPrinterException.js'
import type {BluetoothConnection, PrinterConnection, SerialConnection, UsbConnection} from './Types.js'

/**
 * An open connection to a printer: the commands written to it, then closed once they are sent
 */
export interface Channel {
    write(data: Buffer, bytesPerSecond?: number): Promise<void>
    close(): Promise<void>
}

/**
 * The size of the chunks written
 */
const CHUNK: number = 4096

/**
 * The message of an error
 */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/**
 * Write data to a stream in chunks, waiting for it to drain, at most a number of bytes a second
 * @param stream
 * @param data
 * @param bytesPerSecond
 */
async function writeStream(stream: Writable, data: Buffer, bytesPerSecond?: number): Promise<void> {
    let failure: Error | undefined
    const fail = (error: Error): void => {
        failure = error
    }
    stream.on('error', fail)
    try {
        const size: number = bytesPerSecond ? Math.max(1, Math.min(CHUNK, Math.floor(bytesPerSecond / 10))) : CHUNK
        for (let offset = 0; offset < data.length; offset += size) {
            if (failure) throw failure
            const started: number = Date.now()
            const chunk: Buffer = data.subarray(offset, offset + size)
            if (!stream.write(chunk)) {
                await new Promise<void>((resolve, reject): void => {
                    const done = (): void => {
                        stream.off('error', failed)
                        resolve()
                    }
                    const failed = (error: Error): void => {
                        stream.off('drain', done)
                        reject(error)
                    }
                    stream.once('drain', done)
                    stream.once('error', failed)
                })
            }
            if (bytesPerSecond) {
                const wait: number = chunk.length / bytesPerSecond * 1000 - (Date.now() - started)
                if (wait > 0) await sleep(wait)
            }
        }
        if (failure) throw failure
    } finally {
        stream.off('error', fail)
    }
}

/**
 * Close a stream after its data are written: ended, then finished (or failed)
 * @param stream
 */
function endStream(stream: Writable): Promise<void> {
    return new Promise<void>((resolve, reject): void => {
        stream.once('error', reject)
        stream.end((): void => resolve())
    })
}

/**
 * A channel of a stream (a socket, a port, a device)
 * @param stream
 * @param close how the stream is closed once its data are written
 */
function streamChannel(stream: Duplex | Writable, close?: () => Promise<void>): Channel {
    return {
        write: (data: Buffer, bytesPerSecond?: number): Promise<void> => writeStream(stream, data, bytesPerSecond),
        close: async (): Promise<void> => {
            await endStream(stream)
            await close?.()
        }
    }
}

/**
 * A printer on the network: a socket to its port, connected within the time limit
 */
async function openNetwork(host: string, port: number, timeout: number): Promise<Channel> {
    const socket: Socket = await new Promise<Socket>((resolve, reject): void => {
        const opened: Socket = connect({host, port})
        const timer: NodeJS.Timeout = setTimeout((): void => {
            opened.destroy()
            reject(new ThermalPrinterConnectionException(`The printer ${host}:${port} did not answer within ${timeout} ms`))
        }, timeout)
        opened.once('connect', (): void => {
            clearTimeout(timer)
            resolve(opened)
        })
        opened.once('error', (error: Error): void => {
            clearTimeout(timer)
            reject(new ThermalPrinterConnectionException(`The printer ${host}:${port} cannot be reached: ${messageOf(error)}`))
        })
    })
    return streamChannel(socket, (): Promise<void> => new Promise<void>((resolve): void => {
        //Our end sent (the data handed to the system, which sends them before its FIN): the printer closes its side, or
        //the socket is closed a second later
        if (socket.destroyed) return resolve()
        const timer: NodeJS.Timeout = setTimeout((): void => {
            socket.destroy()
        }, 1000)
        socket.once('close', (): void => {
            clearTimeout(timer)
            resolve()
        })
    }))
}

/**
 * A queue of the system's printing: CUPS's lp, the commands on its input, sent raw
 */
function openQueue(name: string): Channel {
    if (process.platform === 'win32') throw new ThermalPrinterException('The print queue connection is not supported on Windows yet')
    const child: ChildProcessWithoutNullStreams = spawn('lp', ['-d', name, '-o', 'raw'], {stdio: 'pipe'})
    let errors: string = ''
    child.stderr.on('data', (data: Buffer): void => {
        errors += data.toString()
    })
    const exited: Promise<number | null> = new Promise<number | null>((resolve, reject): void => {
        child.once('error', (error: Error): void => reject(new ThermalPrinterConnectionException(`lp cannot be run (CUPS): ${messageOf(error)}`)))
        child.once('close', (code: number | null): void => resolve(code))
    })
    exited.catch((): void => undefined)
    return streamChannel(child.stdin, async (): Promise<void> => {
        const code: number | null = await exited
        if (code !== 0) throw new ThermalPrinterConnectionException(`lp failed for the queue ${name} (${code}): ${errors.trim()}`)
    })
}

/**
 * A package of the connections, loaded when a printer needs it
 * @param name
 */
async function load<T>(name: '@lakutata/serial' | '@lakutata/usb' | '@lakutata/bluetooth', importer: () => Promise<T>): Promise<T> {
    try {
        return await importer()
    } catch (error) {
        if ((error as {code?: string}).code === 'ERR_MODULE_NOT_FOUND' || (error as {code?: string}).code === 'MODULE_NOT_FOUND')
            throw new ThermalPrinterException(`The printer needs the package ${name}: npm install ${name}`)
        throw error
    }
}

/**
 * A stream opened by a package of the connections, its errors as the ones of the connection
 */
async function opened(what: string, open: () => Promise<Duplex>): Promise<Channel> {
    try {
        const stream: Duplex = await open()
        return streamChannel(stream, async (): Promise<void> => {
            stream.destroy()
        })
    } catch (error) {
        if (error instanceof ThermalPrinterException) throw error
        throw new ThermalPrinterConnectionException(`${what} cannot be opened: ${messageOf(error)}`)
    }
}

/**
 * Open the connection of a printer
 * @param connection
 * @param timeout the time limit of the opening, in milliseconds
 */
export async function openChannel(connection: PrinterConnection, timeout: number): Promise<Channel> {
    switch (connection.type) {
        case 'network':
            return await openNetwork(connection.host, connection.port ?? 9100, timeout)
        case 'queue':
            return openQueue(connection.name)
        case 'serial': {
            const serial: SerialConnection = connection
            const module = await load('@lakutata/serial', (): Promise<{openSerialPort(options: object): Promise<Duplex>}> => import('@lakutata/serial' as string))
            return await opened(`The serial port ${serial.path}`, (): Promise<Duplex> => module.openSerialPort({path: serial.path, baudRate: serial.baudRate ?? 9600, flowControl: serial.flowControl ?? 'none'}))
        }
        case 'usb': {
            const usb: UsbConnection = connection
            const module = await load('@lakutata/usb', (): Promise<{openUsbPrinter(options: object): Promise<Duplex>}> => import('@lakutata/usb' as string))
            return await opened('The USB printer', (): Promise<Duplex> => module.openUsbPrinter({vendorId: usb.vendorId, productId: usb.productId, serialNumber: usb.serialNumber, path: usb.path}))
        }
        case 'bluetooth': {
            const bluetooth: BluetoothConnection = connection
            const module = await load('@lakutata/bluetooth', (): Promise<{openBluetoothSerial(options: object): Promise<Duplex>}> => import('@lakutata/bluetooth' as string))
            return await opened(`The Bluetooth printer ${bluetooth.address}`, (): Promise<Duplex> => module.openBluetoothSerial({address: bluetooth.address, channel: bluetooth.channel ?? 1}))
        }
        default:
            throw new ThermalPrinterException(`Unknown connection type ${(connection as {type: string}).type}`)
    }
}

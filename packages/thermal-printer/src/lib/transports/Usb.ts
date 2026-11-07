import {close, constants, open, readdir, readFile, realpath, write} from 'node:fs'
import {promisify} from 'node:util'
import path from 'node:path'
import {Writable} from 'node:stream'
import {ThermalPrinterConnectionException} from '../../exceptions/ThermalPrinterConnectionException.js'
import {ThermalPrinterException} from '../../exceptions/ThermalPrinterException.js'
import {addon, type NativeUsbPrinter} from '../Native.js'
import {type Channel, messageOf, streamChannel} from '../Stream.js'
import type {UsbConnection} from '../Types.js'

/**
 * A USB printer (of the printer class), as listed
 */
export type UsbPrinterInfo = NativeUsbPrinter

/**
 * A file of sysfs, trimmed (undefined when it cannot be read)
 */
async function attribute(file: string): Promise<string | undefined> {
    try {
        return (await promisify(readFile)(file, 'utf8')).trim()
    } catch {
        return undefined
    }
}

/**
 * The USB printers of Linux: the devices of the usblp driver (/sys/class/usbmisc/lpN, written as /dev/usb/lpN), the
 * IEEE 1284 id the driver read from each, the ids of the USB device above it
 * @param root the root of the file system (another one for the tests)
 */
export async function listLinuxUsbPrinters(root: string = '/'): Promise<UsbPrinterInfo[]> {
    const base: string = path.join(root, 'sys/class/usbmisc')
    let names: string[]
    try {
        names = await promisify(readdir)(base)
    } catch {
        return []
    }
    const printers: UsbPrinterInfo[] = []
    for (const name of names.filter((entry: string): boolean => /^lp\d+$/.test(entry)).sort()) {
        const info: UsbPrinterInfo = {path: `/dev/usb/${name}`}
        const deviceId: string | undefined = await attribute(path.join(base, name, 'device/ieee1284_id'))
        if (deviceId) info.deviceId = deviceId
        let directory: string
        try {
            directory = await promisify(realpath)(path.join(base, name, 'device'))
        } catch {
            printers.push(info)
            continue
        }
        //The devices under the real root (a root given through a link resolves to its target)
        const devices: string = path.join(await promisify(realpath)(root).catch((): string => root), 'sys/devices')
        for (; directory.startsWith(devices) && directory !== devices; directory = path.dirname(directory)) {
            const vendor: string | undefined = await attribute(path.join(directory, 'idVendor'))
            if (vendor === undefined) continue
            info.vendorId = parseInt(vendor, 16)
            const product: string | undefined = await attribute(path.join(directory, 'idProduct'))
            if (product !== undefined) info.productId = parseInt(product, 16)
            const serialNumber: string | undefined = await attribute(path.join(directory, 'serial'))
            if (serialNumber) info.serialNumber = serialNumber
            const manufacturer: string | undefined = await attribute(path.join(directory, 'manufacturer'))
            if (manufacturer) info.manufacturer = manufacturer
            const productName: string | undefined = await attribute(path.join(directory, 'product'))
            if (productName) info.product = productName
            break
        }
        printers.push(info)
    }
    return printers
}

/**
 * The USB printers of the system: sysfs on Linux, IOKit on macOS, the printer interface of USB on Windows
 */
export async function listUsbPrinters(): Promise<UsbPrinterInfo[]> {
    if (process.platform === 'linux' || process.platform === 'android') return await listLinuxUsbPrinters()
    if (process.platform === 'darwin' || process.platform === 'win32') return await addon().usbList()
    return []
}

/**
 * The listed USB printer a connection names: by its path, or by its ids (the serial number when given)
 * @param connection
 */
export async function resolveUsb(connection: UsbConnection): Promise<UsbPrinterInfo | undefined> {
    const printers: UsbPrinterInfo[] = await listUsbPrinters()
    if (connection.path) return printers.find((printer: UsbPrinterInfo): boolean => printer.path === connection.path)
    return printers.find((printer: UsbPrinterInfo): boolean => printer.vendorId === connection.vendorId && printer.productId === connection.productId && (connection.serialNumber === undefined || printer.serialNumber === connection.serialNumber))
}

/**
 * The device file of a printer (/dev/usb/lpN), opened without blocking: a write the printer cannot take yet fails with
 * EAGAIN and is tried again, so that a busy printer holds no thread
 */
class DeviceWriter extends Writable {
    readonly #fd: number

    #writing: Promise<void> | undefined

    constructor(fd: number) {
        super({highWaterMark: 16384})
        this.#fd = fd
    }

    public _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        let offset: number = 0
        let finished: () => void = (): void => undefined
        this.#writing = new Promise<void>((resolve): void => {
            finished = resolve
        })
        const done = (error?: Error | null): void => {
            finished()
            callback(error)
        }
        const next = (): void => {
            if (this.destroyed) return done(new Error('the connection is closed'))
            write(this.#fd, chunk, offset, chunk.length - offset, null, (error: NodeJS.ErrnoException | null, written: number): void => {
                if (error) {
                    if (error.code === 'EAGAIN') {
                        setTimeout(next, 5)
                        return
                    }
                    return done(error)
                }
                offset += written
                if (offset < chunk.length) next()
                else done()
            })
        }
        next()
    }

    public _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        //The descriptor closed once no write uses it (its number could be given to another file meanwhile)
        const writing: Promise<void> = this.#writing ?? Promise.resolve()
        void writing.then((): void => {
            close(this.#fd, (): void => callback(error))
        })
    }
}

/**
 * A printer by its device file
 */
async function openDeviceFile(file: string): Promise<Channel> {
    let fd: number
    try {
        fd = await promisify(open)(file, constants.O_WRONLY | constants.O_NONBLOCK)
    } catch (error) {
        throw new ThermalPrinterConnectionException(`The USB printer ${file} cannot be opened: ${messageOf(error)}`)
    }
    const writer: DeviceWriter = new DeviceWriter(fd)
    return streamChannel(writer, async (): Promise<void> => {
        writer.destroy()
    })
}

/**
 * A USB printer opened by the addon (macOS, Windows): each write waits for the printer, failing once it takes nothing
 * for the stall timeout
 */
class AddonWriter extends Writable {
    readonly #handle: object

    readonly #stallTimeout: number

    constructor(handle: object, stallTimeout: number) {
        super({highWaterMark: 65536})
        this.#handle = handle
        this.#stallTimeout = stallTimeout
    }

    public _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        addon().usbWrite(this.#handle, chunk, this.#stallTimeout).then((): void => callback(), (error: Error): void => callback(error))
    }

    public _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        addon().usbClose(this.#handle).then((): void => callback(error), (): void => callback(error))
    }
}

/**
 * The description of a USB printer for the messages
 */
function describe(connection: UsbConnection): string {
    if (connection.path) return connection.path
    const hex = (value: number | undefined): string => (value ?? 0).toString(16).padStart(4, '0')
    return `${hex(connection.vendorId)}:${hex(connection.productId)}${connection.serialNumber ? ` (${connection.serialNumber})` : ''}`
}

/**
 * A USB printer, held open while its printer object lives
 * @param connection
 * @param stallTimeout how long the printer may take no data
 */
export async function openUsbPrinter(connection: UsbConnection, stallTimeout: number): Promise<Channel> {
    const what: string = `The USB printer ${describe(connection)}`
    //A device file (Linux, or a character device given by its path)
    if (process.platform !== 'win32' && connection.path) return await openDeviceFile(connection.path)
    if (process.platform === 'linux' || process.platform === 'android') {
        const printer: UsbPrinterInfo | undefined = await resolveUsb(connection)
        if (!printer?.path) throw new ThermalPrinterConnectionException(`${what} is not connected`)
        return await openDeviceFile(printer.path)
    }
    if (process.platform !== 'darwin' && process.platform !== 'win32') throw new ThermalPrinterException(`USB printers are not offered on ${process.platform}`)
    let target: {path?: string, vendorId?: number, productId?: number, serialNumber?: string} = {vendorId: connection.vendorId, productId: connection.productId, serialNumber: connection.serialNumber}
    //Windows opens its printers by the path of their interface
    if (process.platform === 'win32') {
        const path: string | undefined = connection.path ?? (await resolveUsb(connection))?.path
        if (!path) throw new ThermalPrinterConnectionException(`${what} is not connected`)
        target = {path}
    }
    let handle: object
    try {
        handle = await addon().usbOpen(target)
    } catch (error) {
        throw new ThermalPrinterConnectionException(`${what} cannot be opened: ${messageOf(error)}`)
    }
    const writer: AddonWriter = new AddonWriter(handle, stallTimeout)
    return streamChannel(writer, async (): Promise<void> => {
        writer.destroy()
    })
}

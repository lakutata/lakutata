import {readdir, readFile, realpath} from 'node:fs/promises'
import path from 'node:path'
import {exceptionOf, native} from './Native.js'
import type {SerialPortInfo} from './Types.js'

/**
 * A file of sysfs, trimmed (undefined when it cannot be read)
 */
async function attribute(file: string): Promise<string | undefined> {
    try {
        return (await readFile(file, 'utf8')).trim()
    } catch {
        return undefined
    }
}

/**
 * The ports of Linux: the terminals of /sys/class/tty with a device (not the virtual ones), but the 8250 ports no UART
 * answers (type 0), with the ids of the USB device above them
 */
async function linuxPorts(): Promise<SerialPortInfo[]> {
    let names: string[]
    try {
        names = await readdir('/sys/class/tty')
    } catch {
        return []
    }
    const ports: SerialPortInfo[] = []
    for (const name of names) {
        const base: string = `/sys/class/tty/${name}`
        let device: string
        try {
            device = await realpath(`${base}/device`)
        } catch {
            //A port bound to a Bluetooth device has no device of its own
            if (/^rfcomm\d+$/.test(name)) ports.push({path: `/dev/${name}`})
            continue
        }
        if (/^ttyS\d+$/.test(name) && (await attribute(`${base}/type`)) === '0') continue
        const info: SerialPortInfo = {path: `/dev/${name}`}
        for (let directory: string = device; directory.startsWith('/sys/devices/') && directory !== '/sys/devices'; directory = path.dirname(directory)) {
            const vendor: string | undefined = await attribute(`${directory}/idVendor`)
            if (vendor === undefined) continue
            info.vendorId = parseInt(vendor, 16)
            const product: string | undefined = await attribute(`${directory}/idProduct`)
            if (product !== undefined) info.productId = parseInt(product, 16)
            const serialNumber: string | undefined = await attribute(`${directory}/serial`)
            if (serialNumber) info.serialNumber = serialNumber
            const manufacturer: string | undefined = await attribute(`${directory}/manufacturer`)
            if (manufacturer) info.manufacturer = manufacturer
            const productName: string | undefined = await attribute(`${directory}/product`)
            if (productName) info.product = productName
            break
        }
        ports.push(info)
    }
    return ports.sort((a: SerialPortInfo, b: SerialPortInfo): number => a.path.localeCompare(b.path, 'en', {numeric: true}))
}

/**
 * The serial ports of the system, with the ids of their USB devices (USB adapters): from sysfs on Linux, IOKit on macOS
 * (the callout devices, `/dev/cu.*`), the device manager on Windows (`COMn`).
 * @returns The ports.
 * @example
 * ```typescript
 * import {listSerialPorts} from '@lakutata/serial'
 * for (const port of await listSerialPorts()) console.log(port.path, port.vendorId?.toString(16), port.product)
 * ```
 */
export async function listSerialPorts(): Promise<SerialPortInfo[]> {
    let listed: SerialPortInfo[] | null
    try {
        listed = native.list()
    } catch (error) {
        throw exceptionOf(error, 'The serial ports cannot be listed')
    }
    if (listed) return listed.sort((a: SerialPortInfo, b: SerialPortInfo): number => a.path.localeCompare(b.path, 'en', {numeric: true}))
    return process.platform === 'linux' || process.platform === 'android' ? await linuxPorts() : []
}

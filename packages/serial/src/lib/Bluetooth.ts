import {SerialException} from '../exceptions/SerialException.js'
import {listSerialPorts} from './List.js'
import {invalid, settingsOf} from './Native.js'
import {openPort, openSerialPort, type SerialPort} from './SerialPort.js'
import type {BluetoothSerialOptions, SerialPortInfo} from './Types.js'

/**
 * Open a paired Bluetooth device by its address, through its serial port profile (classic Bluetooth, not Bluetooth Low
 * Energy): a socket of RFCOMM on Linux, the serial port the system made for the device on macOS and Windows (the
 * outgoing one on Windows). The port is the same stream as a serial port's; its line settings and modem lines do not
 * apply to a Bluetooth link.
 * @param options Its address, its channel (Linux), the time the connection may take.
 * @returns The port, a stream.
 * @throws {SerialException} The address is not one (`'EINVAL'`), no serial port of that device is found (`'ENOENT'`:
 * pair it with the system first), the device does not answer (`'EHOSTDOWN'`, `'ETIMEDOUT'`…), or the system offers no
 * Bluetooth sockets (`'EAFNOSUPPORT'`, `'ENOTSUP'`).
 * @example
 * ```typescript
 * import {openBluetoothSerial} from '@lakutata/serial'
 * const printer = await openBluetoothSerial({address: '00:11:22:33:44:55'})
 * printer.write(Buffer.from([0x1B, 0x40, 0x0A]))
 * await printer.close()
 * ```
 */
export async function openBluetoothSerial(options: BluetoothSerialOptions): Promise<SerialPort> {
    const address: string = typeof options?.address === 'string' ? options.address.trim().toUpperCase().replace(/-/g, ':') : ''
    if (!/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(address)) throw invalid(`The Bluetooth address ${options?.address} is not six bytes like 00:11:22:33:44:55`)
    const channel: number = options.channel ?? 1
    if (!Number.isInteger(channel) || channel < 1 || channel > 30) throw invalid(`The RFCOMM channel ${channel} is not between 1 and 30`)
    const stallTimeout: number = options.stallTimeout ?? 0
    const openTimeout: number = options.openTimeout ?? 30000
    if (process.platform === 'linux' || process.platform === 'android') {
        //The speed of a Bluetooth link is its own: the one given only sizes the wait for the bytes in flight
        const settings = settingsOf({baudRate: 115200, stallTimeout})
        return await openPort(address, settings, false, openTimeout, `The Bluetooth device ${address}`, {address, channel})
    }
    if (process.platform === 'darwin' || process.platform === 'win32') {
        const port: SerialPortInfo | undefined = (await listSerialPorts()).find((entry: SerialPortInfo): boolean => entry.bluetoothAddress?.toUpperCase() === address)
        if (!port) {
            const exception: SerialException = new SerialException(`No serial port of the Bluetooth device ${address}: pair it with the system first (its serial port profile)`)
            exception.code = 'ENOENT'
            throw exception
        }
        return await openSerialPort({path: port.path, stallTimeout, openTimeout})
    }
    const exception: SerialException = new SerialException(`Bluetooth devices are not offered on ${process.platform}`)
    exception.code = 'ENOTSUP'
    throw exception
}

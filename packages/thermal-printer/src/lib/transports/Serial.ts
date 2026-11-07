import type {Duplex} from 'node:stream'
import {ThermalPrinterConnectionException} from '../../exceptions/ThermalPrinterConnectionException.js'
import {ThermalPrinterException} from '../../exceptions/ThermalPrinterException.js'
import {type Channel, messageOf, streamChannel} from '../Stream.js'
import type {BluetoothConnection, SerialConnection} from '../Types.js'

type SerialModule = typeof import('@lakutata/serial')

/**
 * The package of the serial ports and Bluetooth devices, loaded when a printer needs it (undefined when it is not
 * installed)
 */
export async function serialModule(): Promise<SerialModule | undefined> {
    try {
        return await import('@lakutata/serial')
    } catch (error) {
        const code: unknown = (error as {code?: unknown}).code
        if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return undefined
        throw error
    }
}

async function requiredSerialModule(): Promise<SerialModule> {
    const module: SerialModule | undefined = await serialModule()
    if (!module) throw new ThermalPrinterException('The printer needs the package @lakutata/serial: npm install @lakutata/serial')
    return module
}

/**
 * A port opened by the serial package, its errors as the ones of the connection
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
 * A printer on a serial port
 * @param connection
 * @param timeout the time the opening may take
 * @param stallTimeout how long the port may take no data
 */
export async function openSerial(connection: SerialConnection, timeout: number, stallTimeout: number): Promise<Channel> {
    const module: SerialModule = await requiredSerialModule()
    return await opened(`The serial port ${connection.path}`, (): Promise<Duplex> => module.openSerialPort({path: connection.path, baudRate: connection.baudRate ?? 9600, flowControl: connection.flowControl ?? 'none', stallTimeout, openTimeout: timeout}))
}

/**
 * A Bluetooth printer (its serial port profile)
 * @param connection
 * @param timeout the time the connection may take
 * @param stallTimeout how long the link may take no data
 */
export async function openBluetooth(connection: BluetoothConnection, timeout: number, stallTimeout: number): Promise<Channel> {
    const module: SerialModule = await requiredSerialModule()
    return await opened(`The Bluetooth printer ${connection.address}`, (): Promise<Duplex> => module.openBluetoothSerial({address: connection.address, channel: connection.channel ?? 1, stallTimeout, openTimeout: timeout}))
}

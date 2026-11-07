import {ThermalPrinterException} from '../exceptions/ThermalPrinterException.js'
import type {Channel} from './Stream.js'
import {openNetwork} from './transports/Network.js'
import {openQueue} from './transports/Queue.js'
import {openBluetooth, openSerial} from './transports/Serial.js'
import {openUsbPrinter} from './transports/Usb.js'
import type {PrinterConnection} from './Types.js'

/**
 * Whether a printer holds its connection between its prints: a serial port, a USB printer and a Bluetooth link are its
 * alone (and a Bluetooth link takes seconds to connect); a network printer and a print queue are opened for each print
 * (printers on port 9100 often take one client at a time, a queue takes one document)
 * @param connection
 */
export function holdsConnection(connection: PrinterConnection): boolean {
    return connection.type === 'serial' || connection.type === 'usb' || connection.type === 'bluetooth'
}

/**
 * Open the connection of a printer
 * @param connection
 * @param timeout the time limit of the opening, in milliseconds
 * @param stallTimeout how long the printer may take no data
 */
export async function openChannel(connection: PrinterConnection, timeout: number, stallTimeout: number = 0): Promise<Channel> {
    switch (connection.type) {
        case 'network':
            return await openNetwork(connection.host, connection.port ?? 9100, timeout)
        case 'queue':
            return openQueue(connection.name)
        case 'serial':
            return await openSerial(connection, timeout, stallTimeout)
        case 'usb':
            return await openUsbPrinter(connection, stallTimeout)
        case 'bluetooth':
            return await openBluetooth(connection, timeout, stallTimeout)
        default:
            throw new ThermalPrinterException(`Unknown connection type ${(connection as {type: string}).type}`)
    }
}

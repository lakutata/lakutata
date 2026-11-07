import {languageOfDeviceId, modelOfDeviceId} from './DeviceId.js'
import {listQueues, type QueueInfo} from './transports/Queue.js'
import {serialModule} from './transports/Serial.js'
import {listUsbPrinters, type UsbPrinterInfo} from './transports/Usb.js'
import type {PrinterCandidate, PrinterConnection} from './Types.js'

/**
 * The model and the language a device id names
 */
function identified(deviceId: string | undefined): Pick<PrinterCandidate, 'deviceId' | 'model' | 'language'> {
    if (!deviceId) return {}
    return {deviceId, model: modelOfDeviceId(deviceId)?.name, language: languageOfDeviceId(deviceId)}
}

/**
 * The USB printers: by their path where the system has one (Linux, Windows), by their ids on macOS
 */
export async function usbCandidates(): Promise<PrinterCandidate[]> {
    return (await listUsbPrinters()).map((printer: UsbPrinterInfo): PrinterCandidate => {
        const connection: PrinterConnection = printer.path && process.platform !== 'darwin'
            ? {type: 'usb', path: printer.path}
            : {type: 'usb', vendorId: printer.vendorId, productId: printer.productId, ...(printer.serialNumber ? {serialNumber: printer.serialNumber} : {})}
        return {
            kind: 'usb',
            connection,
            name: printer.product ?? printer.path ?? 'USB printer',
            printer: true,
            vendorId: printer.vendorId,
            productId: printer.productId,
            serialNumber: printer.serialNumber,
            manufacturer: printer.manufacturer,
            product: printer.product,
            ...identified(printer.deviceId)
        }
    })
}

/**
 * The print queues of the system
 */
export async function queueCandidates(): Promise<PrinterCandidate[]> {
    return (await listQueues()).map((queue: QueueInfo): PrinterCandidate => ({
        kind: 'queue',
        connection: {type: 'queue', name: queue.name},
        name: queue.name,
        printer: true,
        device: queue.device
    }))
}

/**
 * The serial ports (the ones of the system's own devices left out) and the ports of Bluetooth devices, with
 * @lakutata/serial installed
 */
export async function serialCandidates(): Promise<PrinterCandidate[]> {
    const module = await serialModule()
    if (!module) return []
    const candidates: PrinterCandidate[] = []
    for (const port of await module.listSerialPorts()) {
        if (/^\/dev\/cu\.(debug-console|Bluetooth-Incoming-Port)$/.test(port.path)) continue
        const shared = {vendorId: port.vendorId, productId: port.productId, serialNumber: port.serialNumber, manufacturer: port.manufacturer, product: port.product}
        if (port.bluetoothAddress) {
            candidates.push({kind: 'bluetooth', connection: {type: 'bluetooth', address: port.bluetoothAddress}, name: port.product ?? port.bluetoothAddress, printer: false, ...shared})
        } else {
            candidates.push({kind: 'serial', connection: {type: 'serial', path: port.path}, name: port.product ?? port.path, printer: false, ...shared})
        }
    }
    return candidates
}

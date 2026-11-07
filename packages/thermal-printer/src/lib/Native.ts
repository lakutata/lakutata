import {loadAddon} from './Addon.js'

/**
 * A USB printer to open: its device path (Windows), or its ids (macOS)
 */
export interface UsbTarget {
    path?: string
    vendorId?: number
    productId?: number
    serialNumber?: string
}

/**
 * A USB printer as the addon lists it: its device path on Windows, its location on macOS, the IEEE 1284 id it reports
 */
export interface NativeUsbPrinter extends UsbTarget {
    manufacturer?: string
    product?: string
    deviceId?: string
    locationId?: number
}

/**
 * A printer of the spooler of Windows
 */
export interface NativeQueue {
    name: string
    driver?: string
    port?: string
    isDefault?: boolean
}

/**
 * The functions of the addon (macOS and Windows)
 */
export interface NativePrinterAddon {
    usbList(): Promise<NativeUsbPrinter[]>
    usbOpen(target: UsbTarget): Promise<object>
    /**
     * Write all of the data, failing with ETIMEDOUT once the printer took nothing for stallTimeout milliseconds
     */
    usbWrite(handle: object, data: Buffer, stallTimeout: number): Promise<number>
    usbClose(handle: object): Promise<void>
    queueList(): Promise<NativeQueue[]>
    queuePrint(name: string, data: Buffer, document: string): Promise<void>
}

let loaded: NativePrinterAddon | undefined

/**
 * The addon, loaded at its first use
 */
export function addon(): NativePrinterAddon {
    return loaded ??= loadAddon() as NativePrinterAddon
}

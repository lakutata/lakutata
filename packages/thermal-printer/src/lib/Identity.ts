import type {PrinterConnection} from './Types.js'

/**
 * The key of the device a connection reaches: two connections of the same key are the same printer (one object, one
 * queue). The settings that do not name the device (a speed, a flow control) are not part of it
 * @param connection
 */
export function keyOf(connection: PrinterConnection): string {
    switch (connection.type) {
        case 'network':
            return `network:${connection.host.toLowerCase()}:${connection.port ?? 9100}`
        case 'queue':
            return `queue:${connection.name}`
        case 'serial':
            return `serial:${connection.path}`
        case 'bluetooth':
            return `bluetooth:${connection.address.toUpperCase().replace(/-/g, ':')}`
        case 'usb':
            return connection.path ? `usb:${connection.path}` : `usb:${connection.vendorId ?? 0}:${connection.productId ?? 0}:${connection.serialNumber ?? ''}`
    }
}

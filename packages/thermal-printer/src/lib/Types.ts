import type {EncodeOptions, MediaOptions, PrinterLanguage} from '@lakutata/thermal'

/**
 * A printer on the network, by its raw printing port (9100 for ESC/POS, TSPL and ZPL printers alike).
 */
export interface NetworkConnection {
    /**
     * The connection type: a printer on the network.
     */
    type: 'network'

    /**
     * Its address or host name.
     */
    host: string

    /**
     * Its port.
     * @default 9100
     */
    port?: number
}

/**
 * A printer of the system's print queue, sent the commands as they are (raw): CUPS on macOS and Linux (`lp -o raw`).
 */
export interface QueueConnection {
    /**
     * The connection type: a print queue of the system.
     */
    type: 'queue'

    /**
     * The name of the queue (`lpstat -p` lists them).
     */
    name: string
}

/**
 * A printer on a serial port (by `@lakutata/serial`), a Bluetooth printer paired as a serial port included.
 */
export interface SerialConnection {
    /**
     * The connection type: a serial port.
     */
    type: 'serial'

    /**
     * The path of the port: `/dev/ttyUSB0`, `/dev/cu.usbserial-110`, `COM3`.
     */
    path: string

    /**
     * Its speed.
     * @default 9600
     */
    baudRate?: number

    /**
     * Its flow control: `'rts/cts'`, `'dtr/dsr'` (Windows and macOS), `'xon/xoff'` or `'none'`.
     * @default 'none'
     */
    flowControl?: 'none' | 'rts/cts' | 'dtr/dsr' | 'xon/xoff'
}

/**
 * A printer on USB (of the printer class): its vendor and product (and its serial number when several are plugged),
 * or its device path (`/dev/usb/lp0` on Linux, the path of its printer interface on Windows; macOS names it by its ids).
 */
export interface UsbConnection {
    /**
     * The connection type: a USB printer.
     */
    type: 'usb'

    /**
     * Its vendor id.
     */
    vendorId?: number

    /**
     * Its product id.
     */
    productId?: number

    /**
     * Its serial number.
     */
    serialNumber?: string

    /**
     * The path of its device (`/dev/usb/lp0` on Linux, `\\?\usb#vid_…` on Windows), in place of its ids.
     */
    path?: string
}

/**
 * A Bluetooth printer (by `@lakutata/serial`): classic Bluetooth, its serial port profile (SPP).
 */
export interface BluetoothConnection {
    /**
     * The connection type: a classic Bluetooth printer.
     */
    type: 'bluetooth'

    /**
     * Its address (`'00:11:22:33:44:55'`); the printer is paired by the system first.
     */
    address: string

    /**
     * Its RFCOMM channel (Linux; elsewhere the serial port the system made for the device chooses it).
     * @default 1
     */
    channel?: number
}

/**
 * How a printer is reached.
 */
export type PrinterConnection = NetworkConnection | QueueConnection | SerialConnection | UsbConnection | BluetoothConnection

/**
 * A printer: how it is reached, its media (as `render()` takes them: `model`, `paper`, `label`, `width`, `dpi`,
 * `rotate`, `page`), how its HTML is read, and the options of its commands (as `encode()` takes them).
 */
export interface PrinterDefinition extends MediaOptions {
    /**
     * How the printer is reached.
     */
    connection: PrinterConnection

    /**
     * The directory its HTML reads its pictures and style sheets from.
     */
    baseDir?: string

    /**
     * The language of its text, for the line breaking.
     * @default 'zh'
     */
    textLanguage?: string

    /**
     * The options of its commands: its command language (when it has no `model`), the feed, the cut, the drawer, the
     * sensor, the density…
     */
    commands?: Omit<EncodeOptions, 'model'>

    /**
     * The most bytes a second sent to it: a slow link (Bluetooth, a serial port) whose printer stalls when data come too
     * fast or too slow. Unlimited by default.
     */
    bytesPerSecond?: number

    /**
     * How long the connection may take to open, in milliseconds.
     * @default 10000
     */
    connectTimeout?: number

    /**
     * How long the printer may take no data (out of paper, its cover open, offline) before the print fails, in
     * milliseconds; 0 waits as long as it takes.
     * @default 10000
     */
    stallTimeout?: number
}

/**
 * The options of one print: the options of the commands for this print only, a cancellation.
 */
export interface PrintOptions {
    /**
     * The options of the commands for this print (the cut, the copies…), over the printer's own.
     */
    commands?: Omit<EncodeOptions, 'model' | 'language'>

    /**
     * A signal that cancels the print while it waits for its turn or renders.
     */
    signal?: AbortSignal
}

/**
 * What a print sent.
 */
export interface PrintResult {
    /**
     * The pages printed (0 for raw commands).
     */
    pages: number

    /**
     * The bytes sent to the printer.
     */
    bytes: number
}

/**
 * A device found by the manager, ready to be opened and its connection saved.
 */
export interface PrinterCandidate {
    /**
     * What it is: a USB printer, a print queue of the system, a serial port, the serial port of a Bluetooth device.
     */
    kind: 'usb' | 'queue' | 'serial' | 'bluetooth'

    /**
     * Its connection, as a printer takes it (`manager.open({connection, …})`).
     */
    connection: PrinterConnection

    /**
     * A name to show: the product, the queue, the port.
     */
    name: string

    /**
     * Whether it is known to be a printer (a USB printer, a print queue), or only a port a printer may be on (a serial
     * port, a Bluetooth device).
     */
    printer: boolean

    /**
     * The vendor id of its USB device.
     */
    vendorId?: number

    /**
     * The product id of its USB device.
     */
    productId?: number

    /**
     * The serial number of its USB device.
     */
    serialNumber?: string

    /**
     * Its manufacturer.
     */
    manufacturer?: string

    /**
     * Its product name.
     */
    product?: string

    /**
     * Where a print queue sends its jobs: a device URI of CUPS (`usb://…`, `socket://…`), a port of Windows.
     */
    device?: string

    /**
     * The IEEE 1284 id the printer reports (`MFG:EPSON;CMD:ESC/POS;MDL:TM-T88V;`).
     */
    deviceId?: string

    /**
     * The model of `printerModels()` its id names, for its `model` option.
     */
    model?: string

    /**
     * The command language its id reports, for its `commands.language` option when it has no model.
     */
    language?: PrinterLanguage
}

/**
 * What the manager looks for.
 */
export interface DiscoverOptions {
    /**
     * USB printers.
     * @default true
     */
    usb?: boolean

    /**
     * The print queues of the system.
     * @default true
     */
    queues?: boolean

    /**
     * The serial ports and the serial ports of Bluetooth devices (with `@lakutata/serial` installed).
     * @default true
     */
    serial?: boolean
}

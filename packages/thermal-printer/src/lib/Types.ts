import type {EncodeOptions, MediaOptions} from '@lakutata/thermal'

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
 * A printer on USB (by `@lakutata/usb`): its vendor and product (and serial number when several are plugged), or its
 * device path.
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
     * The path of its device (`/dev/usb/lp0` on Linux), in place of its ids.
     */
    path?: string
}

/**
 * A Bluetooth printer (by `@lakutata/bluetooth`): classic Bluetooth, its serial port profile (SPP).
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
     * Its RFCOMM channel.
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

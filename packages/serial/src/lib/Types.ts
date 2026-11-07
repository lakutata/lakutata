/**
 * The settings of a line: its speed, its frame and its flow control.
 */
export interface SerialLineOptions {
    /**
     * Its speed in bits a second: the standard ones (9600, 19200, 38400, 57600, 115200…) everywhere, others where the
     * system and the adapter take them (Linux, macOS, Windows).
     * @default 9600
     */
    baudRate?: number

    /**
     * The data bits of a character.
     * @default 8
     */
    dataBits?: 5 | 6 | 7 | 8

    /**
     * Its stop bits (1.5 on Windows only).
     * @default 1
     */
    stopBits?: 1 | 1.5 | 2

    /**
     * Its parity (`'mark'` and `'space'` on Linux and Windows only).
     * @default 'none'
     */
    parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'

    /**
     * Its flow control: by the RTS and CTS lines (hardware), by the XON and XOFF characters (software), or none.
     * @default 'none'
     */
    flowControl?: 'none' | 'rts/cts' | 'xon/xoff'
}

/**
 * The options of a port opened: its path and the settings of its line.
 */
export interface SerialPortOptions extends SerialLineOptions {
    /**
     * Its path: `/dev/ttyUSB0`, `/dev/ttyACM0` (Linux), `/dev/cu.usbserial-110` (macOS), `COM3` (Windows).
     */
    path: string

    /**
     * Whether the other programs are kept from opening it while it is open (always on Windows).
     * @default true
     */
    exclusive?: boolean
}

/**
 * A port of the system, as listed.
 */
export interface SerialPortInfo {
    /**
     * Its path, to open it.
     */
    path: string

    /**
     * The vendor id of its USB device (an adapter), when it is one.
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
     * Its product name (its friendly name on Windows).
     */
    product?: string
}

/**
 * The input lines of a port's modem.
 */
export interface SerialSignals {
    /**
     * Clear To Send.
     */
    cts: boolean

    /**
     * Data Set Ready.
     */
    dsr: boolean

    /**
     * Data Carrier Detect.
     */
    dcd: boolean

    /**
     * Ring Indicator.
     */
    ri: boolean
}

/**
 * The output lines of a port set: the ones given, the others left as they are.
 */
export interface SerialSignalOptions {
    /**
     * Data Terminal Ready.
     */
    dtr?: boolean

    /**
     * Request To Send (not with the RTS/CTS flow control, which drives it).
     */
    rts?: boolean

    /**
     * A break: the line held low while it is on.
     */
    break?: boolean
}

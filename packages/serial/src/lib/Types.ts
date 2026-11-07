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
     * Its flow control: by the RTS and CTS lines (hardware), by the XON and XOFF characters (software), by the DTR
     * and DSR lines (Windows and macOS; Linux has none), or none. With XON/XOFF a received 0x13 stops the output: a
     * device that sends binary data (a printer's status) wants a hardware one. A printer set to DTR/DSR on a cable
     * that wires its DTR to the CTS of the computer works with `'rts/cts'` too.
     * @default 'none'
     */
    flowControl?: 'none' | 'rts/cts' | 'xon/xoff' | 'dtr/dsr'

    /**
     * How long the output may stop moving (a device holding CTS low, a printer out of paper) before a write or a
     * drain fails with `'ETIMEDOUT'`, in milliseconds; 0 waits as long as it takes.
     * @default 0
     */
    stallTimeout?: number
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

    /**
     * How long the opening may take, in milliseconds (a Bluetooth port connects to its device when it is opened).
     * @default 30000
     */
    openTimeout?: number
}

/**
 * The options of a drain.
 */
export interface SerialDrainOptions {
    /**
     * How long the output may stop moving before the drain fails with `'ETIMEDOUT'`, in milliseconds (0: no limit).
     * @default the stallTimeout of the port
     */
    stallTimeout?: number

    /**
     * How long the drain may take in all before it fails with `'ETIMEDOUT'`, in milliseconds (0: no limit).
     * @default 0
     */
    timeout?: number
}

/**
 * The options of a closing.
 */
export interface SerialCloseOptions {
    /**
     * How long the output may stop moving before the closing gives up on it: the data not sent are discarded, the port
     * is closed, and the closing rejects with `'ETIMEDOUT'`; in milliseconds (0: wait as long as it takes).
     * @default 10000
     */
    stallTimeout?: number
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

    /**
     * A path of the port that stays the same when the device is plugged again (Linux: its link in
     * `/dev/serial/by-id`).
     */
    stablePath?: string

    /**
     * The address of the paired Bluetooth device whose serial port profile it is (macOS, Windows): `'00:11:22:33:44:55'`.
     */
    bluetoothAddress?: string
}

/**
 * The options of a Bluetooth device opened by its address (its serial port profile, classic Bluetooth).
 */
export interface BluetoothSerialOptions {
    /**
     * The address of the device: `'00:11:22:33:44:55'`. The device is paired with the system first.
     */
    address: string

    /**
     * Its RFCOMM channel (Linux, where the device is reached by a socket; elsewhere the system's serial port of the
     * device chooses it).
     * @default 1
     */
    channel?: number

    /**
     * How long the output may stop moving before a write or a drain fails with `'ETIMEDOUT'`, in milliseconds (0: no
     * limit).
     * @default 0
     */
    stallTimeout?: number

    /**
     * How long the connection may take, in milliseconds.
     * @default 30000
     */
    openTimeout?: number
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
     * Data Terminal Ready (not with the DTR/DSR flow control, which drives it).
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

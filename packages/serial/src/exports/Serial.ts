export {SerialException} from '../exceptions/SerialException.js'
export {
    type BluetoothSerialOptions,
    type SerialCloseOptions,
    type SerialDrainOptions,
    type SerialLineOptions,
    type SerialPortInfo,
    type SerialPortOptions,
    type SerialSignalOptions,
    type SerialSignals
} from '../lib/Types.js'
export {openSerialPort, SerialPort} from '../lib/SerialPort.js'
export {listSerialPorts} from '../lib/List.js'
export {openBluetoothSerial} from '../lib/Bluetooth.js'

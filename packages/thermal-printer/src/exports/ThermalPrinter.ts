export {ThermalPrinterException} from '../exceptions/ThermalPrinterException.js'
export {ThermalPrinterConnectionException} from '../exceptions/ThermalPrinterConnectionException.js'
export {ThermalPrinterOptionException} from '../exceptions/ThermalPrinterOptionException.js'
export {
    type BluetoothConnection,
    type DiscoverOptions,
    type NetworkConnection,
    type PrinterCandidate,
    type PrinterConnection,
    type PrinterDefinition,
    type PrintOptions,
    type PrintResult,
    type QueueConnection,
    type SerialConnection,
    type UsbConnection
} from '../lib/Types.js'
export {validatePrinterDefinition} from '../lib/Schema.js'
export {ThermalPrinter} from '../providers/ThermalPrinter.js'
export {buildThermalPrinterManagerOptions, ThermalPrinterManager, type ThermalPrinterManagerConfig} from '../components/ThermalPrinterManager.js'

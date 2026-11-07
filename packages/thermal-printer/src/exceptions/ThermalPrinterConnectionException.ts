import {ThermalPrinterException} from './ThermalPrinterException.js'

/**
 * Thrown when a printer cannot be reached or the commands cannot be sent: the connection refused or timed out, the
 * device not found, the print queue failing. Its `errno` is `'E_THERMAL_PRINTER_CONNECTION'`.
 */
export class ThermalPrinterConnectionException extends ThermalPrinterException {
    /**
     * `'E_THERMAL_PRINTER_CONNECTION'`.
     */
    public errno: string | number = 'E_THERMAL_PRINTER_CONNECTION'
}

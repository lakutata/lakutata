import {ThermalPrinterException} from './ThermalPrinterException.js'

/**
 * Thrown for a printer definition that is not one: a connection missing or wrong, an option of the wrong kind. Its
 * `errno` is `'E_THERMAL_PRINTER_OPTION'`. Media the engine refuses throw the `ThermalOptionException` of
 * `@lakutata/thermal`.
 */
export class ThermalPrinterOptionException extends ThermalPrinterException {
    /**
     * `'E_THERMAL_PRINTER_OPTION'`.
     */
    public errno: string | number = 'E_THERMAL_PRINTER_OPTION'
}

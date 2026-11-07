import {Exception} from '@lakutata/core'

/**
 * The base of the exceptions of the package: catch it for any of them. Thrown itself for a printer not configured, a
 * connection whose package is not installed, or a connection the platform does not offer; its `errno` is
 * `'E_THERMAL_PRINTER'`, the one of the subclass otherwise.
 */
export class ThermalPrinterException extends Exception {
    /**
     * `'E_THERMAL_PRINTER'`, or the one of the subclass.
     */
    public errno: string | number = 'E_THERMAL_PRINTER'
}

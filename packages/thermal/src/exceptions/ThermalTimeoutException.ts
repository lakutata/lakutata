import {ThermalException} from './ThermalException.js'

/**
 * Thrown when an operation took longer than its `timeout`. Its `errno` is `'E_THERMAL_TIMEOUT'`.
 */
export class ThermalTimeoutException extends ThermalException {
    /**
     * `'E_THERMAL_TIMEOUT'`.
     */
    public errno: string | number = 'E_THERMAL_TIMEOUT'
}

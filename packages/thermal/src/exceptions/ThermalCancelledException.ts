import {ThermalException} from './ThermalException.js'

/**
 * Thrown when an operation is cancelled by its `signal`. Its `errno` is `'E_THERMAL_CANCELLED'`.
 */
export class ThermalCancelledException extends ThermalException {
    /**
     * `'E_THERMAL_CANCELLED'`.
     */
    public errno: string | number = 'E_THERMAL_CANCELLED'
}

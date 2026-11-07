import {ThermalException} from './ThermalException.js'

/**
 * Thrown when a font cannot be registered or used: its file cannot be read, or FreeType does not open it as a font.
 * Its `errno` is `'E_THERMAL_FONT'`.
 */
export class ThermalFontException extends ThermalException {
    /**
     * `'E_THERMAL_FONT'`.
     */
    public errno: string | number = 'E_THERMAL_FONT'
}

import {ThermalException} from './ThermalException.js'

/**
 * Thrown when the options of a rendering or an encoding are not valid: no media or more than one (`model`, `paper`,
 * `label`, `width`), a media without the resolution it needs, an unknown model or paper, a size out of range. Its
 * `errno` is `'E_THERMAL_OPTION'`.
 */
export class ThermalOptionException extends ThermalException {
    /**
     * `'E_THERMAL_OPTION'`.
     */
    public errno: string | number = 'E_THERMAL_OPTION'
}

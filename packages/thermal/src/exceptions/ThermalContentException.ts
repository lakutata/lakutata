import {ThermalException} from './ThermalException.js'

/**
 * Thrown when the content cannot be rendered: a picture or a style sheet it refers to cannot be read or decoded (a file
 * outside the base directory, a remote address, a broken image), a QR code with too much text, or content longer than
 * the limit of the rendering (`maxLength`). Its `errno` is `'E_THERMAL_CONTENT'`.
 */
export class ThermalContentException extends ThermalException {
    /**
     * `'E_THERMAL_CONTENT'`.
     */
    public errno: string | number = 'E_THERMAL_CONTENT'
}

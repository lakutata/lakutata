import {Exception} from '@lakutata/core'

/**
 * The base of the exceptions of the package: catch it for any of them. Thrown itself for an internal error of the
 * addon; its `errno` is `'E_THERMAL'`, the one of the subclass otherwise.
 */
export class ThermalException extends Exception {
    /**
     * `'E_THERMAL'`, or the one of the subclass.
     */
    public errno: string | number = 'E_THERMAL'
}

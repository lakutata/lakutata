import {Exception} from '@lakutata/core'

/**
 * The base of the exceptions of the package: catch it for any of them. Thrown itself for an internal error of the
 * addon; its `errno` is `'E_BARCODE'`, the one of the subclass otherwise.
 */
export class BarcodeException extends Exception {
    /**
     * `'E_BARCODE'`, or the one of the subclass.
     */
    public errno: string | number = 'E_BARCODE'
}

import {BarcodeException} from './BarcodeException.js'

/**
 * Thrown when an option of the symbol does not apply to the format or is out of its range: an `errorCorrection`, a
 * `version`, `gs1`, `eci` or `addOn` the format does not take. Its `errno` is `'E_BARCODE_OPTION'`.
 */
export class BarcodeOptionException extends BarcodeException {
    /**
     * `'E_BARCODE_OPTION'`.
     */
    public errno: string | number = 'E_BARCODE_OPTION'
}

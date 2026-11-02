import {BarcodeException} from './BarcodeException.js'

/**
 * Thrown when an operation took longer than its `timeout`. Its `errno` is `'E_BARCODE_TIMEOUT'`.
 */
export class BarcodeTimeoutException extends BarcodeException {
    /**
     * `'E_BARCODE_TIMEOUT'`.
     */
    public errno: string | number = 'E_BARCODE_TIMEOUT'
}

import {BarcodeException} from './BarcodeException.js'

/**
 * Thrown when an operation is cancelled by its `signal`, or by the destruction of the component. Its `errno` is
 * `'E_BARCODE_CANCELLED'`.
 */
export class BarcodeCancelledException extends BarcodeException {
    /**
     * `'E_BARCODE_CANCELLED'`.
     */
    public errno: string | number = 'E_BARCODE_CANCELLED'
}

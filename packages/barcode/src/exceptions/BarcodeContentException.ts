import {BarcodeException} from './BarcodeException.js'

/**
 * Thrown when the content cannot be encoded in the format: characters the format does not take (letters in an EAN-13),
 * a wrong length or check digit, too much data for the format or its version. Its message is the one of zint. Its
 * `errno` is `'E_BARCODE_CONTENT'`.
 */
export class BarcodeContentException extends BarcodeException {
    /**
     * `'E_BARCODE_CONTENT'`.
     */
    public errno: string | number = 'E_BARCODE_CONTENT'
}

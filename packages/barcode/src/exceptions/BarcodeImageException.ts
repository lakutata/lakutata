import {BarcodeException} from './BarcodeException.js'

/**
 * Thrown when the image given to `read()` cannot be decoded (not a PNG, JPEG, GIF, BMP, WebP or TGA, or damaged), has
 * more than 50 million pixels, or when its pixels do not match their width, height and channels. An image without
 * barcode is not an error: `read()` gives an empty array. Its `errno` is `'E_BARCODE_IMAGE'`.
 */
export class BarcodeImageException extends BarcodeException {
    /**
     * `'E_BARCODE_IMAGE'`.
     */
    public errno: string | number = 'E_BARCODE_IMAGE'
}

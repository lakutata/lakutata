import {native} from './Native.js'
import type {BarcodeFormatInfo} from './Types.js'

/**
 * The formats of the package and the options of the symbol each takes (`errorCorrection`, `version`, `gs1`, `eci`,
 * `addOn`, `showText`): the choices to offer for a format.
 * @example
 * ```typescript
 * import {barcodeFormats} from '@lakutata/barcode'
 * const withVersions: string[] = barcodeFormats.filter((format) => format.versions > 0).map((format) => format.name)
 * ```
 */
export const barcodeFormats: readonly BarcodeFormatInfo[] = Object.freeze(native.formats().map((format: BarcodeFormatInfo): BarcodeFormatInfo => Object.freeze(format)))

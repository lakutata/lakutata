/**
 * The formats of the package: the ones it generates and reads back. Their names are the ones of the results of
 * `read()`, which may also give formats it reads but does not generate (`'QRCodeModel1'`).
 */
export const BARCODE_FORMATS = [
    'EAN13', 'EAN8', 'UPCA', 'UPCE', 'ISBN',
    'DataBar', 'DataBarStacked', 'DataBarStackedOmni', 'DataBarLimited', 'DataBarExpanded', 'DataBarExpandedStacked',
    'Code128', 'Code39', 'Code39Extended', 'Code32', 'PZN', 'Code93', 'ITF', 'ITF14', 'Codabar', 'Telepen', 'DXFilmEdge',
    'QRCode', 'MicroQRCode', 'RMQRCode', 'DataMatrix', 'PDF417', 'CompactPDF417', 'MicroPDF417', 'Aztec', 'AztecRune', 'MaxiCode'
] as const

/**
 * A format of the package.
 */
export type BarcodeFormat = typeof BARCODE_FORMATS[number]

/**
 * The pixels of an image: `width * height * channels` bytes, row after row, the channels of a pixel together (1 gray, 3
 * RGB, 4 RGBA). The image `generate()` gives with `output: 'raw'`, or the pixels of a picture for `read()`.
 */
export interface RawImage {
    /**
     * The bytes of the pixels.
     */
    data: Uint8Array
    /**
     * The width, in pixels.
     */
    width: number
    /**
     * The height, in pixels.
     */
    height: number
    /**
     * The bytes of a pixel: 1 gray, 3 RGB, 4 RGBA.
     */
    channels: 1 | 3 | 4
}

/**
 * The options of an operation that runs in the threads of the addon.
 */
export interface OperationOptions {
    /**
     * Cancels the operation: it is rejected with `BarcodeCancelledException`. An operation waiting for a thread is
     * dropped; one already running cannot be stopped (zint and zxing-cpp have no checkpoint): it finishes in its thread
     * and its result is discarded.
     */
    signal?: AbortSignal
    /**
     * The time limit of the operation, in milliseconds: past it, it is rejected with `BarcodeTimeoutException` (an
     * operation already running finishes in its thread, its result discarded). The `timeout` of the component by
     * default; 0 for none.
     */
    timeout?: number
}

/**
 * The options of `generate()`. The ones of the symbol (`errorCorrection`, `version`, `gs1`, `eci`, `addOn`) given for a
 * format that does not take them throw `BarcodeOptionException`; the ones of the presentation (`height`, `showText`,
 * `quietZone`) are ignored by the formats without them.
 */
export interface GenerateOptions extends OperationOptions {
    /**
     * `'png'` (a `Buffer`), `'svg'` (a string) or `'raw'` (a `RawImage`).
     * @default 'png'
     */
    output?: 'png' | 'svg' | 'raw'
    /**
     * The size of a module (the narrowest bar, a square of a matrix code): pixels in PNG and raw, units of the SVG.
     * @default 4
     */
    scale?: number
    /**
     * The height of the bars of a linear format, in modules. The one of the standard of the format by default.
     */
    height?: number
    /**
     * The margin around the symbol: `true` for the quiet zones of the standard of the format, `false` for none, or a
     * number of modules.
     * @default true
     */
    quietZone?: boolean | number
    /**
     * Whether a linear format shows its content as text under its bars (in PNG and raw, from a `scale` of 2: the
     * font needs 2 pixels by module).
     * @default true
     */
    showText?: boolean
    /**
     * The color of the bars: `#RRGGBB`, or `#RRGGBBAA` with an opacity.
     * @default '#000000'
     */
    foreground?: string
    /**
     * The color of the background: `#RRGGBB`, or `#RRGGBBAA` (`#FFFFFF00` for a transparent one).
     * @default '#FFFFFF'
     */
    background?: string
    /**
     * The rotation, clockwise.
     * @default 0
     */
    rotate?: 0 | 90 | 180 | 270
    /**
     * The error correction: a letter for QR Code (`'L'`, `'M'`, `'Q'`, `'H'`), Micro QR Code (`'L'`, `'M'`, `'Q'`)
     * and rMQR Code (`'M'`, `'H'`); a level for PDF417 and Compact PDF417 (0 to 8) and Aztec (1 to 4). Chosen by the
     * format by default.
     */
    errorCorrection?: 'L' | 'M' | 'Q' | 'H' | number
    /**
     * The size of a matrix format: the version of QR Code (1 to 40), of Micro QR Code (1 to 4, M1 to M4), the size of
     * rMQR Code (1 to 38), of Data Matrix (1 to 48) and the layers of Aztec (1 to 36), in the order of zint. The
     * smallest one the content fits in by default.
     */
    version?: number
    /**
     * The content is GS1 data: application identifiers and their values, `[01]09506000134352[17]261231` or
     * `(01)09506000134352(17)261231`. For Code 128 (GS1-128), the DataBar formats, QR Code, rMQR Code, Data Matrix and
     * Aztec; DataBar Expanded always takes GS1 data.
     * @default false
     */
    gs1?: boolean
    /**
     * The Extended Channel Interpretation: the character set the content is encoded in (26 for UTF-8, 3 for ISO-8859-1,
     * 20 for Shift JIS...). Chosen by zint from the text by default.
     */
    eci?: number
    /**
     * The add-on of an EAN-13, EAN-8, UPC-A, UPC-E or ISBN: 2 or 5 digits.
     */
    addOn?: string
}

/**
 * The options of `read()`.
 */
export interface ReadOptions extends OperationOptions {
    /**
     * The formats looked for: all the ones zxing-cpp reads by default.
     */
    formats?: BarcodeFormat[]
    /**
     * Spends more time to find the codes that are hard to read.
     * @default true
     */
    tryHarder?: boolean
    /**
     * Also looks for the codes turned by 90 degrees.
     * @default true
     */
    tryRotate?: boolean
    /**
     * Also looks for the codes in light on dark.
     * @default true
     */
    tryInvert?: boolean
    /**
     * Also looks in the image scaled down (the large images).
     * @default true
     */
    tryDownscale?: boolean
    /**
     * The image holds a single code, straight, with nothing around (an image made by `generate()`): the fastest read.
     * @default false
     */
    pure?: boolean
    /**
     * The codes read at most.
     * @default 255
     */
    maxSymbols?: number
    /**
     * The add-ons of EAN and UPC codes: `'ignore'`, `'read'` (read when there is one) or `'require'` (the codes without
     * one are not given).
     * @default 'read'
     */
    addOn?: 'ignore' | 'read' | 'require'
}

/**
 * A point of an image, in pixels from its top left corner.
 */
export interface BarcodePoint {
    /**
     * The pixels from the left.
     */
    x: number
    /**
     * The pixels from the top.
     */
    y: number
}

/**
 * A code read from an image.
 */
export interface BarcodeResult {
    /**
     * Its format: one of the package, or another one zxing-cpp reads (`'QRCodeModel1'`).
     */
    format: BarcodeFormat | string
    /**
     * Its content as text; GS1 data as `(01)09506000134352(17)261231`.
     */
    text: string
    /**
     * Its content as it is encoded, without its add-on.
     */
    bytes: Uint8Array
    /**
     * Its corners in the image.
     */
    position: {topLeft: BarcodePoint, topRight: BarcodePoint, bottomRight: BarcodePoint, bottomLeft: BarcodePoint}
    /**
     * Its rotation in the image, in degrees.
     */
    orientation: number
    /**
     * Its error correction (`'M'` for a QR Code), when the format has one.
     */
    errorCorrectionLevel?: string
    /**
     * Its version or size (`'2'` for a QR Code, `'12x12'` for a Data Matrix), when the format has one.
     */
    version?: string
    /**
     * The symbology identifier of ISO/IEC 15424 (`']Q1'`).
     */
    symbologyIdentifier: string
    /**
     * The add-on of an EAN or UPC code.
     */
    addOn?: string
    /**
     * Whether its content is GS1 data.
     */
    gs1: boolean
    /**
     * Whether it was read mirrored.
     */
    mirrored: boolean
    /**
     * Whether it was read in light on dark.
     */
    inverted: boolean
    /**
     * A code of several (structured append): its index, the number of codes, the id of the sequence.
     */
    structuredAppend?: {index: number, count: number, id: string}
}

/**
 * A format and the options of the symbol it takes.
 */
export interface BarcodeFormatInfo {
    /**
     * The name of the format.
     */
    name: BarcodeFormat
    /**
     * The format `read()` gives for it: itself, or the one zxing-cpp cannot tell it from (a UPC-A is an EAN-13
     * starting with 0, an ISBN one starting with 978 or 979; an ITF-14 is read as an ITF, a Compact PDF417 as a PDF417,
     * an Aztec Rune as an Aztec, a DataBar Stacked Omnidirectional as a DataBar Stacked). A UPC-A is read as such when
     * `formats` asks for UPC-A without EAN-13.
     */
    reads: BarcodeFormat
    /**
     * The letters of its `errorCorrection` (`'LMQH'`), its levels (`'0-8'`), or null when it takes none.
     */
    errorCorrection: string | null
    /**
     * The highest `version` it takes, 0 when it takes none.
     */
    versions: number
    /**
     * Whether it takes `gs1`.
     */
    gs1: boolean
    /**
     * Whether it takes `eci`.
     */
    eci: boolean
    /**
     * Whether it takes `addOn`.
     */
    addOn: boolean
    /**
     * Whether it shows text (`showText`).
     */
    text: boolean
}

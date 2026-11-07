import {ThermalOptionException} from '../exceptions/ThermalOptionException.js'
import {dotsOf} from './Media.js'
import {type EscPosRaster, modelOf, type PrinterLanguage, type PrinterModel} from './Models.js'
import type {PrintImage, PrintPage} from './PrintImage.js'
import type {Length} from './Types.js'

/**
 * The options of an encoding: the language of the printer (or its model), what follows each page, and the settings of
 * the language.
 */
export interface EncodeOptions {
    /**
     * The printer of the model table: its language and its raster command.
     */
    model?: string

    /**
     * The command language, when no model is given.
     */
    language?: PrinterLanguage

    /**
     * ESC/POS: the raster command (`gsv0` by default, the model's when a model is given).
     */
    raster?: EscPosRaster

    /**
     * ESC/POS: the most rows of one raster command; a taller page is sent in bands. Small printers have small buffers.
     * At most 2303 (`GS v 0`), 1662 (`GS ( L`, which also carries 65525 bytes at most).
     * @default 255
     */
    bandHeight?: number

    /**
     * ESC/POS: reset the printer (`ESC @`) before the first page.
     * @default true
     */
    initialize?: boolean

    /**
     * ESC/POS: the paper pushed out after each page, before the cut: past the tear bar of a printer without a cutter.
     * @default 0
     */
    feed?: Length

    /**
     * Cut after each page, on a printer with a cutter: `'full'` (or `true`), or `'partial'` (a half cut that keeps the
     * receipts hanging). ESC/POS: the paper fed to the cutter first (`GS V`); TSPL: `SET CUTTER 1`, `SET PARTIAL_CUTTER 1`;
     * ZPL: the cutter mode (`^MMC`, a full cut). `false` turns the cutter of a label printer off (`SET CUTTER OFF`,
     * `^MMT`), as a label printer keeps the setting of the jobs before.
     * @default no cut
     */
    cut?: 'full' | 'partial' | boolean

    /**
     * ESC/POS: open the cash drawer after the last page (`ESC p`): `true` for its pin 2, or the pin (2 or 5) and the
     * pulse in milliseconds.
     */
    drawer?: boolean | {pin?: 2 | 5, on?: number, off?: number}

    /**
     * TSPL and ZPL: how the printer finds the start of a label: by the gap between labels, a black mark, or not at all
     * (continuous media).
     * @default 'gap'
     */
    sensor?: 'gap' | 'mark' | 'continuous'

    /**
     * TSPL: the length of the gap or of the black mark between labels.
     * @default 2 (millimetres; 0 for continuous media)
     */
    gap?: Length

    /**
     * TSPL: the darkness, 0 to 15. ZPL: the darkness, 0 to 30 (`~SD`).
     */
    density?: number

    /**
     * TSPL and ZPL: the print speed in inches per second.
     */
    speed?: number

    /**
     * TSPL and ZPL: the copies of each page.
     * @default 1
     */
    copies?: number

    /**
     * ZPL: compress the graphic fields (`^GF` ASCII compression), about half the size of plain hexadecimal.
     * @default true
     */
    compress?: boolean
}

const ESC: number = 0x1B
const GS: number = 0x1D

/**
 * Whether a value is an integer in a range
 */
function checkInteger(value: number | undefined, name: string, minimum: number, maximum: number): void {
    if (value !== undefined && (!Number.isInteger(value) || value < minimum || value > maximum)) throw new ThermalOptionException(`${name} is an integer from ${minimum} to ${maximum}`)
}

/**
 * The rows of a page from one row to another, packed as the page holds them
 */
function rowsOf(page: PrintPage, from: number, to: number): Buffer {
    return page.rows.subarray(from * page.bytesPerRow, to * page.bytesPerRow)
}

/**
 * ESC/POS: each page as raster commands in bands, then the feed, the cut; the drawer after the last page
 */
function encodeEscPos(image: PrintImage, options: EncodeOptions, raster: EscPosRaster): Buffer {
    const chunks: Buffer[] = []
    if (options.initialize !== false) chunks.push(Buffer.from([ESC, 0x40]))
    const feed: number = options.feed === undefined ? 0 : dotsOf(options.feed, image.dotsPerMm, 'feed')
    //ESC J n (the feed) and ESC 3 n (the bands of ESC *) count in the vertical motion unit, not always a dot (1/360 inch
    //on some Epson models): GS P sets it to the dot pitch (the horizontal one left as it is)
    if ((feed > 0 || raster === 'esc*') && Math.round(image.dpi) <= 255) chunks.push(Buffer.from([GS, 0x50, 0x00, Math.round(image.dpi)]))
    for (const page of image.pages) {
        const bytes: number = page.bytesPerRow
        if (raster === 'esc*') {
            //24-dot columns, double density (m = 33): 3 bytes a column, its top dot the high bit of its first byte; the
            //line spacing set to 24 dots, each band followed by a line feed
            chunks.push(Buffer.from([ESC, 0x33, 24]))
            for (let top = 0; top < page.height; top += 24) {
                const band: Buffer = Buffer.alloc(5 + page.width * 3 + 1)
                band.set([ESC, 0x2A, 33, page.width & 0xFF, page.width >> 8])
                for (let x = 0; x < page.width; x++) {
                    for (let y = 0; y < 24; y++) {
                        if (top + y < page.height && page.dot(x, top + y)) band[5 + x * 3 + (y >> 3)]! |= 0x80 >> (y & 7)
                    }
                }
                band[band.length - 1] = 0x0A
                chunks.push(band)
            }
            //The default line spacing back
            chunks.push(Buffer.from([ESC, 0x32]))
        } else {
            //GS ( L carries 65525 bytes of data at most (its length on two bytes, 10 of them its header) and 1662 rows
            const most: number = raster === 'gsl' ? Math.min(options.bandHeight ?? 255, 1662, Math.floor(65525 / bytes)) : options.bandHeight ?? 255
            for (let top = 0; top < page.height; top += most) {
                const rows: number = Math.min(most, page.height - top)
                const data: Buffer = rowsOf(page, top, top + rows)
                if (raster === 'gsv0') {
                    chunks.push(Buffer.from([GS, 0x76, 0x30, 0x00, bytes & 0xFF, bytes >> 8, rows & 0xFF, rows >> 8]), data)
                } else {
                    //GS ( L fn 112: the graphics into the print buffer (monochrome, single size); fn 50: printed
                    const length: number = data.length + 10
                    chunks.push(Buffer.from([GS, 0x28, 0x4C, length & 0xFF, length >> 8, 0x30, 0x70, 0x30, 0x01, 0x01, 0x31, page.width & 0xFF, page.width >> 8, rows & 0xFF, rows >> 8]), data)
                    chunks.push(Buffer.from([GS, 0x28, 0x4C, 0x02, 0x00, 0x30, 0x32]))
                }
            }
        }
        //The feed in dots (ESC J n: n dots at most 255 a command)
        for (let left = feed; left > 0; left -= 255) chunks.push(Buffer.from([ESC, 0x4A, Math.min(255, left)]))
        //GS V 65/66 0: fed to the cutter, then cut (full, partial)
        if (options.cut === 'full' || options.cut === true) chunks.push(Buffer.from([GS, 0x56, 0x41, 0x00]))
        else if (options.cut === 'partial') chunks.push(Buffer.from([GS, 0x56, 0x42, 0x00]))
    }
    if (options.drawer) {
        const drawer: {pin?: 2 | 5, on?: number, off?: number} = options.drawer === true ? {} : options.drawer
        const pin: 2 | 5 = drawer.pin ?? 2
        if (pin !== 2 && pin !== 5) throw new ThermalOptionException('drawer.pin is 2 or 5')
        checkInteger(drawer.on, 'drawer.on', 2, 510)
        checkInteger(drawer.off, 'drawer.off', 2, 510)
        //ESC p m t1 t2: the pulse on for t1 × 2 ms, off for t2 × 2 ms
        chunks.push(Buffer.from([ESC, 0x70, pin === 2 ? 0 : 1, Math.round((drawer.on ?? 100) / 2), Math.round((drawer.off ?? 500) / 2)]))
    }
    return Buffer.concat(chunks)
}

/**
 * A number of millimetres as TSPL writes it (two decimals at most)
 */
function millimetres(dots: number, dotsPerMm: number): string {
    return String(Math.round(dots / dotsPerMm * 100) / 100)
}

/**
 * TSPL: the size of the labels, their sensor, the settings, then each page as a bitmap printed. The bits of BITMAP are
 * inverted (1 a white dot), as the community implementations of TSPL send them; the BITMAP entry of TSC's programming
 * manual does not state it in its text (not verified on a printer yet)
 */
function encodeTspl(image: PrintImage, options: EncodeOptions): Buffer {
    checkInteger(options.density, 'density', 0, 15)
    checkInteger(options.speed, 'speed', 1, 18)
    checkInteger(options.copies, 'copies', 1, 9999)
    const first: PrintPage = image.pages[0]!
    const sensor: 'gap' | 'mark' | 'continuous' = options.sensor ?? 'gap'
    const gap: string = sensor === 'continuous' ? '0' : millimetres(dotsOf(options.gap ?? 2, image.dotsPerMm, 'gap'), image.dotsPerMm)
    const lines: string[] = [`SIZE ${millimetres(first.width, image.dotsPerMm)} mm,${millimetres(first.height, image.dotsPerMm)} mm`]
    lines.push(sensor === 'mark' ? `BLINE ${gap} mm,0 mm` : `GAP ${gap} mm,0 mm`)
    if (options.density !== undefined) lines.push(`DENSITY ${options.density}`)
    if (options.speed !== undefined) lines.push(`SPEED ${options.speed}`)
    //The cutter: after each label, or off (the printer keeps the setting of the jobs before)
    if (options.cut === 'full' || options.cut === true) lines.push('SET CUTTER 1')
    else if (options.cut === 'partial') lines.push('SET PARTIAL_CUTTER 1')
    else if (options.cut === false) lines.push('SET CUTTER OFF')
    lines.push('DIRECTION 0')
    const chunks: Buffer[] = [Buffer.from(`${lines.join('\r\n')}\r\n`, 'latin1')]
    for (const page of image.pages) {
        const inverted: Buffer = Buffer.from(page.rows)
        for (let i = 0; i < inverted.length; i++) inverted[i] = ~inverted[i]! & 0xFF
        chunks.push(Buffer.from(`CLS\r\nBITMAP 0,0,${page.bytesPerRow},${page.height},0,`, 'latin1'), inverted, Buffer.from(`\r\nPRINT 1,${options.copies ?? 1}\r\n`, 'latin1'))
    }
    return Buffer.concat(chunks)
}

/**
 * The ZPL ASCII compression of a row of hexadecimal digits: runs of a digit as their count (G–Y for 1 to 19, g–z for 20
 * to 400 by twenties) and the digit, the end of the row of 0s as "," and of Fs as "!"
 */
function compressRow(hex: string): string {
    let end: number = hex.length
    let tail: string = ''
    if (/0+$/.test(hex)) {
        end = hex.search(/0+$/)
        tail = ','
    } else if (/F+$/.test(hex)) {
        end = hex.search(/F+$/)
        tail = '!'
    }
    let result: string = ''
    for (let i = 0; i < end;) {
        //A run is written in 400 digits at most (z)
        let run: number = 1
        while (i + run < end && hex[i + run] === hex[i] && run < 400) run++
        let count: number = run
        let prefix: string = ''
        if (count >= 20) {
            const twenties: number = Math.min(20, Math.floor(count / 20))
            prefix += String.fromCharCode(0x66 + twenties)
            count -= twenties * 20
        }
        if (count > 0 && run > 1) prefix += String.fromCharCode(0x46 + count)
        result += `${prefix}${hex[i]}`
        i += run
    }
    return result + tail
}

/**
 * ZPL: each page a label: its width and length, its sensor, the settings, the page as a graphic field
 */
function encodeZpl(image: PrintImage, options: EncodeOptions): Buffer {
    checkInteger(options.density, 'density', 0, 30)
    checkInteger(options.speed, 'speed', 1, 14)
    checkInteger(options.copies, 'copies', 1, 99999999)
    const tracking: string = {gap: 'Y', mark: 'M', continuous: 'N'}[options.sensor ?? 'gap']
    //The print mode: the cutter (a full cut after each label), the tear-off mode, or the printer's own
    const mode: string = options.cut === undefined ? '' : options.cut === false ? '^MMT' : '^MMC'
    const parts: string[] = []
    if (options.density !== undefined) parts.push(`~SD${String(options.density).padStart(2, '0')}`)
    for (const page of image.pages) {
        const bytes: number = page.bytesPerRow
        let data: string
        if (options.compress === false) {
            data = page.rows.toString('hex').toUpperCase()
        } else {
            const rows: string[] = []
            let previous: string | undefined
            for (let y = 0; y < page.height; y++) {
                const hex: string = rowsOf(page, y, y + 1).toString('hex').toUpperCase()
                //A row like the one before it: ":"
                rows.push(hex === previous ? ':' : compressRow(hex))
                previous = hex
            }
            data = rows.join('')
        }
        const total: number = bytes * page.height
        parts.push(`^XA^PW${page.width}^LL${page.height}^MN${tracking}${mode}${options.speed !== undefined ? `^PR${options.speed}` : ''}^FO0,0^GFA,${total},${total},${bytes},${data}^FS^PQ${options.copies ?? 1}^XZ`)
    }
    return Buffer.from(parts.join('\n'), 'latin1')
}

/**
 * Encode a rendering as the commands of a printer: ESC/POS (receipt printers: raster bands, the feed, the cut, the cash
 * drawer), TSPL or ZPL (label and wristband printers: the label size and sensor, each page a bitmap printed). The
 * language and the ESC/POS raster command come from `model`, or are given.
 * @param image The rendering.
 * @param options The language or the model, and what follows each page.
 * @returns The bytes to send to the printer.
 * @example
 * ```typescript
 * import {encode, render} from '@lakutata/thermal'
 *
 * const receipt = await render('<h1>Order 42</h1>', {paper: 80})
 * const commands: Buffer = encode(receipt, {language: 'escpos', feed: 3, cut: 'partial'})
 * const band = await render('<b>Ward 3 · Bed 12</b>', {model: 'HC100', label: {width: 25, height: 250}})
 * const zpl: Buffer = encode(band, {model: 'HC100', sensor: 'mark'})
 * console.log(commands.length, zpl.length)
 * ```
 */
export function encode(image: PrintImage, options: EncodeOptions): Buffer {
    if (!image || !Array.isArray(image.pages) || !image.pages.length) throw new ThermalOptionException('The image is a rendering of render()')
    if (!options || typeof options !== 'object') throw new ThermalOptionException('The options give the language or the model')
    const model: PrinterModel | undefined = options.model !== undefined ? modelOf(options.model) : undefined
    if (options.model !== undefined && !model) throw new ThermalOptionException(`Unknown model ${options.model} (printerModels() lists them)`)
    if (model && options.language !== undefined && options.language !== model.language) throw new ThermalOptionException(`The model ${model.name} speaks ${model.language}, not ${options.language}`)
    const language: PrinterLanguage | undefined = model?.language ?? options.language
    if (options.sensor !== undefined && !['gap', 'mark', 'continuous'].includes(options.sensor)) throw new ThermalOptionException('sensor is \'gap\', \'mark\' or \'continuous\'')
    if (options.cut !== undefined && typeof options.cut !== 'boolean' && options.cut !== 'full' && options.cut !== 'partial') throw new ThermalOptionException('cut is \'full\', \'partial\', true or false')
    checkInteger(options.bandHeight, 'bandHeight', 1, 2303)
    switch (language) {
        case 'escpos': {
            const raster: EscPosRaster = options.raster ?? model?.raster ?? 'gsv0'
            if (!['gsv0', 'gsl', 'esc*'].includes(raster)) throw new ThermalOptionException('raster is \'gsv0\', \'gsl\' or \'esc*\'')
            return encodeEscPos(image, options, raster)
        }
        case 'tspl':
            return encodeTspl(image, options)
        case 'zpl':
            return encodeZpl(image, options)
        default:
            throw new ThermalOptionException('The options give the language (escpos, tspl or zpl) or a model')
    }
}

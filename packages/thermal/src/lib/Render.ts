import {ThermalFontException} from '../exceptions/ThermalFontException.js'
import {ThermalOptionException} from '../exceptions/ThermalOptionException.js'
import {fontFiles} from './Addon.js'
import {dotsOf, resolveMedia, type ResolvedMedia} from './Media.js'
import {exceptionOf, native, type NativePage, runOperation} from './Native.js'
import {PrintImage, PrintPage} from './PrintImage.js'
import type {FontSource, RenderOptions} from './Types.js'

/**
 * The style sheet of every rendering, after the master one of litehtml: no margin around the page (the paper has its
 * own), the default text about 3 mm high (12px, the printers' own 12×24 font at 203 dpi)
 */
const USER_STYLES: string = 'html,body{margin:0;padding:0}'

/**
 * Whether the bundled fonts are registered
 */
let defaults: boolean = false

/**
 * Register the bundled fonts (Noto Sans SC, regular and bold) once
 */
function registerDefaults(): void {
    if (defaults) return
    try {
        native.registerFont({family: 'Noto Sans SC', weight: 400, italic: false, index: 0, path: fontFiles.regular})
        native.registerFont({family: 'Noto Sans SC', weight: 700, italic: false, index: 0, path: fontFiles.bold})
    } catch (error) {
        throw exceptionOf(error)
    }
    defaults = true
}

/**
 * Register a font for the HTML of the renderings (`font-family`): TrueType, OpenType or WOFF, its file or its bytes.
 * The bundled Noto Sans SC (regular and bold) is the font of the generic families (`sans-serif`, `serif`…) and of the
 * characters a font lacks. A family registered in a weight or a style it lacks is emboldened or slanted. The fonts are
 * registered for the process and never removed.
 * @param font The font: its family, weight and style, and its file or its data.
 * @example
 * ```typescript
 * import {registerFont, render} from '@lakutata/thermal'
 *
 * await registerFont({family: 'Brand', weight: 700, file: './fonts/brand-bold.ttf'})
 * const image = await render('<h1 style="font-family: Brand">Lakeside</h1>', {paper: 80})
 * ```
 */
export async function registerFont(font: FontSource): Promise<void> {
    if (!font || typeof font.family !== 'string' || !font.family.trim()) throw new ThermalOptionException('A font has a family')
    if ((font.file === undefined) === (font.data === undefined)) throw new ThermalOptionException('A font has a file or data, one of them')
    if (font.style !== undefined && font.style !== 'normal' && font.style !== 'italic') throw new ThermalOptionException('style is \'normal\' or \'italic\'')
    const weight: number = font.weight ?? 400
    if (!Number.isInteger(weight) || weight < 1 || weight > 1000) throw new ThermalOptionException('weight is 1 to 1000')
    registerDefaults()
    try {
        native.registerFont({family: font.family.trim(), weight: weight, italic: font.style === 'italic', index: font.index ?? 0, ...(font.file !== undefined ? {path: font.file} : {data: font.data})})
    } catch (error) {
        const exception: Error = exceptionOf(error)
        throw exception instanceof ThermalOptionException ? new ThermalFontException(exception.message) : exception
    }
}

/**
 * Render HTML and CSS into the printer's dots: laid out at the print width of the media, drawn in black dots (the text
 * in monochrome glyphs, line art thresholded, photographs and gradients dithered), cut into pages on fixed length
 * media and turned by `rotate`. The result is the print preview and the data the encoders turn into printer commands.
 *
 * Sizes in the CSS are real sizes: `mm`, `pt` and `px` (1/96 inch) are converted through the printer's resolution, so a
 * template prints the same size at 180, 203 and 300 dpi. Pictures are inline `<svg>`, `data:` URLs, `qrcode:` sources
 * (a QR code drawn on whole dots: `<img src="qrcode:https%3A%2F%2Fexample.com#ec=M&quiet=2">`) and the files of
 * `baseDir`.
 * @param html The HTML of the page.
 * @param options The media (one of `model`, `paper`, `label`, `width`), and how the HTML is read.
 * @returns The rendering: its pages of dots.
 * @example
 * ```typescript
 * import {render} from '@lakutata/thermal'
 *
 * const receipt = await render('<h1 style="text-align: center">Lakeside Café</h1><p>Latte ¥32.00</p>', {paper: 80})
 * const band = await render('<b>Ward 3 · Bed 12</b>', {label: {width: 25, height: 250}, dpi: 300, rotate: 90})
 * console.log(receipt.width, band.pages.length)
 * ```
 */
export async function render(html: string, options: RenderOptions): Promise<PrintImage> {
    if (typeof html !== 'string') throw new ThermalOptionException('The HTML is a string')
    if (!options || typeof options !== 'object') throw new ThermalOptionException('The options give the media: model, paper, label or width')
    const media: ResolvedMedia = resolveMedia(options)
    const maxLength: number = dotsOf(options.maxLength ?? 2500, media.dotsPerMm, 'maxLength')
    const timeout: number = options.timeout ?? 0
    if (!Number.isFinite(timeout) || timeout < 0) throw new ThermalOptionException('timeout is a positive number of milliseconds')
    registerDefaults()
    const pages: NativePage[] = await runOperation((token: unknown): Promise<NativePage[]> => native.render(html, {
        width: media.layoutWidth,
        scale: media.dotsPerMm * 25.4 / 96,
        pageLength: media.pageLength,
        paginate: media.paginate,
        lead: media.lead,
        rotate: media.rotate,
        maxLength: maxLength,
        baseDirectory: options.baseDir ?? '',
        language: options.language ?? 'zh',
        userStyles: USER_STYLES
    }, token), options.signal, timeout)
    return new PrintImage(pages.map((page: NativePage): PrintPage => new PrintPage(page.width, page.height, page.rows)), media.dpi, media.dotsPerMm)
}

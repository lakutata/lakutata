import {ThermalOptionException} from '../exceptions/ThermalOptionException.js'
import {native} from './Native.js'

/**
 * A page of a rendering: the printer's dots, `width` × `height`, black or white. Its rows are packed bits, as the
 * printers take them.
 * @example
 * ```typescript
 * import {render} from '@lakutata/thermal'
 *
 * const image = await render('<p>Hello</p>', {paper: 58})
 * const page = image.pages[0]
 * console.log(page.width, page.height, page.dot(0, 0))
 * ```
 */
export class PrintPage {
    /**
     * Its width in dots.
     */
    public readonly width: number

    /**
     * Its height in dots.
     */
    public readonly height: number

    /**
     * Its rows: `(width + 7) >> 3` bytes each, the high bit of a byte its leftmost dot, a set bit a black dot.
     */
    public readonly rows: Buffer

    /**
     * A page of its dots.
     * @param width Its width in dots.
     * @param height Its height in dots.
     * @param rows Its rows of bits.
     */
    constructor(width: number, height: number, rows: Buffer) {
        this.width = width
        this.height = height
        this.rows = rows
    }

    /**
     * The bytes of a row.
     */
    public get bytesPerRow(): number {
        return (this.width + 7) >> 3
    }

    /**
     * Whether a dot is black.
     * @param x Its column, from the left.
     * @param y Its row, from the top.
     * @returns true for a black dot, false for a white one or a dot outside the page.
     */
    public dot(x: number, y: number): boolean {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false
        return (this.rows[y * this.bytesPerRow + (x >> 3)]! & (0x80 >> (x & 7))) !== 0
    }

    /**
     * The page as a PNG: 1-bit grayscale, one pixel per dot (the print preview).
     * @returns The bytes of the PNG.
     */
    public toPNG(): Buffer {
        return native.png(this.rows, this.width, this.height)
    }
}

/**
 * The result of a rendering: its pages (one on a roll, one per label on fixed length media) at the printer's
 * resolution. The same dots are the print preview (`toPNG()`) and the data of the printer commands.
 * @example
 * ```typescript
 * import {writeFile} from 'node:fs/promises'
 * import {render} from '@lakutata/thermal'
 *
 * const image = await render('<h1>Order 42</h1>', {paper: 80})
 * console.log(image.width, image.height, image.dpi)
 * await writeFile('preview.png', image.toPNG())
 * ```
 */
export class PrintImage {
    /**
     * The resolution in dots per inch.
     */
    public readonly dpi: number

    /**
     * The dots of a millimetre (8 at 203 dpi, 12 at 300 dpi).
     */
    public readonly dotsPerMm: number

    /**
     * The pages, in their order.
     */
    public readonly pages: readonly PrintPage[]

    /**
     * A rendering of its pages.
     * @param pages The pages.
     * @param dpi The resolution in dots per inch.
     * @param dotsPerMm The dots of a millimetre.
     */
    constructor(pages: PrintPage[], dpi: number, dotsPerMm: number) {
        this.pages = pages
        this.dpi = dpi
        this.dotsPerMm = dotsPerMm
    }

    /**
     * The width of the first page in dots.
     */
    public get width(): number {
        return this.pages[0]!.width
    }

    /**
     * The height of the first page in dots.
     */
    public get height(): number {
        return this.pages[0]!.height
    }

    /**
     * A page as a PNG: 1-bit grayscale, one pixel per dot.
     * @param page The index of the page.
     * @returns The bytes of the PNG.
     */
    public toPNG(page: number = 0): Buffer {
        const target: PrintPage | undefined = this.pages[page]
        if (!target) throw new ThermalOptionException(`The rendering has ${this.pages.length} page(s), not a page ${page}`)
        return target.toPNG()
    }
}

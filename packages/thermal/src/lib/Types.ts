/**
 * A length: a number of millimetres (`72`), or a string with its unit: `'72mm'`, `'7.2cm'`, `'2in'`, or `'576dots'` for
 * a number of the printer's dots.
 */
export type Length = number | string

/**
 * The size of a label or a wristband, across the print head (`width`) and along the feed (`height`).
 */
export interface LabelSize {
    /**
     * The width of the label: its extent across the print head.
     */
    width: Length

    /**
     * The height of the label: its extent along the feed (one page).
     */
    height: Length
}

/**
 * How the content is cut into pages on media of a fixed length (labels, wristbands).
 */
export interface PageOptions {
    /**
     * Content longer than a page: `'clip'` keeps the first page only, `'paginate'` makes as many pages as needed.
     * @default 'clip'
     */
    overflow?: 'clip' | 'paginate'

    /**
     * The start of each page the printer cannot print (a wristband printer's leading part): left blank, the content
     * placed after it.
     * @default 0
     */
    lead?: Length

    /**
     * The length of a page along the feed, for a fixed length media given by `width` (the `label` and `model` media give
     * their own).
     */
    length?: Length
}

/**
 * The media of a rendering: exactly one of `model`, `paper`, `label` and `width`, plus what it needs.
 */
export interface MediaOptions {
    /**
     * A model of the printer table (`printerModels()`): its width, resolution and media.
     */
    model?: string

    /**
     * The paper width of a 203 dpi receipt printer: `58` (a print width of 48 mm, 384 dots) or `80` (72 mm, 576 dots).
     * Printers of another resolution or width (the Epson TM-T88 family: 180 dpi, 512 dots) are given by `model`, or by
     * `width` and `dpi`.
     */
    paper?: 58 | 80 | '58mm' | '80mm'

    /**
     * The size of a label or a wristband; needs `dpi`.
     */
    label?: LabelSize

    /**
     * The print width (the width the head prints, not the paper's): a continuous roll unless `page.length` is given;
     * needs `dpi`.
     */
    width?: Length

    /**
     * The resolution of the printer in dots per inch (203, 300, 180…): needed by `label` and `width`, given by `model`,
     * 203 for `paper`. The common resolutions are their exact dot pitch: 203 dpi is 8 dots per millimetre, 300 dpi 12.
     */
    dpi?: number

    /**
     * The rotation of each page, clockwise: a wristband printed along the band is laid out along its length, then turned
     * by 90 or 270.
     * @default 0
     */
    rotate?: 0 | 90 | 180 | 270

    /**
     * The pages of a fixed length media.
     */
    page?: PageOptions
}

/**
 * The options of a rendering: its media, and how its HTML is read.
 */
export interface RenderOptions extends MediaOptions {
    /**
     * The directory the local pictures and style sheets of the HTML are read from (`<img src="logo.png">`); a path
     * outside it is refused. Without it, the HTML reads no file (inline SVG, `data:` and `qrcode:` sources only).
     */
    baseDir?: string

    /**
     * The language of the text, for its line breaking (BCP 47: `'zh'`, `'en'`, `'ja'`…). The `lang` of the HTML does not
     * change it.
     * @default 'zh'
     */
    language?: string

    /**
     * The longest content rendered, a guard against a runaway page: longer content is refused.
     * @default 2500 (millimetres)
     */
    maxLength?: Length

    /**
     * The longest the rendering may wait in the queue of the addon, in milliseconds (one already running finishes, its
     * result discarded); 0 for none.
     * @default 0
     */
    timeout?: number

    /**
     * A signal that cancels the rendering.
     */
    signal?: AbortSignal
}

/**
 * A font to register: its family and style, and its file or its data (TrueType, OpenType, WOFF).
 */
export interface FontSource {
    /**
     * The family the HTML names it by (`font-family`).
     */
    family: string

    /**
     * Its weight (400 regular, 700 bold).
     * @default 400
     */
    weight?: number

    /**
     * Its style.
     * @default 'normal'
     */
    style?: 'normal' | 'italic'

    /**
     * The path of the font file.
     */
    file?: string

    /**
     * The bytes of the font.
     */
    data?: Uint8Array

    /**
     * The face of a collection (`.ttc`).
     * @default 0
     */
    index?: number
}

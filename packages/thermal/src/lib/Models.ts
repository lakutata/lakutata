import {setModelLookup} from './Media.js'

/**
 * The command language of a printer: ESC/POS (receipt printers), TSPL (TSC and many Chinese label printers), ZPL
 * (Zebra and the printers that emulate it).
 */
export type PrinterLanguage = 'escpos' | 'tspl' | 'zpl'

/**
 * The raster command of an ESC/POS printer: `GS v 0` (the most common), `GS ( L` (graphics data, which Epson recommends
 * since it marks `GS v 0` obsolete), `ESC *` (24-dot columns, the oldest and most widely understood).
 */
export type EscPosRaster = 'gsv0' | 'gsl' | 'esc*'

/**
 * A printer of the model table.
 */
export interface PrinterModel {
    /**
     * Its name, as `model` options take it (`'TM-T88VI'`).
     */
    name: string

    /**
     * Its brand.
     */
    brand: string

    /**
     * Its resolution in dots per inch.
     */
    dpi: number

    /**
     * Its print width in dots (the widest it prints).
     */
    width: number

    /**
     * Its command language.
     */
    language: PrinterLanguage

    /**
     * The raster command of an ESC/POS printer.
     */
    raster?: EscPosRaster

    /**
     * `'roll'`: a receipt printer, the width of its roll its print width. `'label'`: labels or wristbands, their size
     * given by the `label` option of a rendering.
     */
    media: 'roll' | 'label'

    /**
     * The rotation of its pages (a wristband printer printing along the band).
     */
    rotate?: 0 | 90 | 180 | 270

    /**
     * The start of each page it cannot print, in millimetres.
     */
    lead?: number

    /**
     * Whether it ignores the page size the commands give and reads it from its media (a cartridge with a chip).
     */
    mediaFromCartridge?: boolean

    /**
     * Where its figures come from: `'documented'` by its maker, `'reported'` by other sources (community printer
     * profiles, retail listings).
     */
    source: 'documented' | 'reported'
}

/**
 * The models. The figures come from the makers' specifications and programming manuals, and from the community profiles
 * of escpos-printer-db (CC-BY-4.0, https://github.com/receipt-print-hq/escpos-printer-db), as gathered in 2026-11.
 */
const MODELS: readonly PrinterModel[] = [
    //Epson: the TM-T88 family is 180 dpi, 512 dots (72 mm); GS v 0 is marked obsolete in favour of GS ( L
    {name: 'TM-T88V', brand: 'Epson', dpi: 180, width: 512, language: 'escpos', raster: 'gsl', media: 'roll', source: 'documented'},
    {name: 'TM-T88VI', brand: 'Epson', dpi: 180, width: 512, language: 'escpos', raster: 'gsl', media: 'roll', source: 'documented'},
    {name: 'TM-T88VII', brand: 'Epson', dpi: 180, width: 512, language: 'escpos', raster: 'gsl', media: 'roll', source: 'documented'},
    {name: 'TM-T20III', brand: 'Epson', dpi: 203, width: 576, language: 'escpos', raster: 'gsv0', media: 'roll', source: 'documented'},
    {name: 'TM-m30', brand: 'Epson', dpi: 203, width: 576, language: 'escpos', raster: 'gsv0', media: 'roll', source: 'documented'},
    //Bixolon: 180 dpi, 512 dots (the width derived from the resolution and the 72 mm print width)
    {name: 'SRP-350III', brand: 'Bixolon', dpi: 180, width: 512, language: 'escpos', raster: 'gsv0', media: 'roll', source: 'reported'},
    {name: 'SRP-350plusIII', brand: 'Bixolon', dpi: 180, width: 512, language: 'escpos', raster: 'gsv0', media: 'roll', source: 'reported'},
    //Sunmi: the printers built into its terminals
    {name: 'Sunmi 58', brand: 'Sunmi', dpi: 203, width: 384, language: 'escpos', raster: 'gsv0', media: 'roll', source: 'documented'},
    {name: 'Sunmi 80', brand: 'Sunmi', dpi: 203, width: 576, language: 'escpos', raster: 'gsv0', media: 'roll', source: 'documented'},
    //Chinese brands: 58 mm printers print 48 mm (384 dots), 80 mm ones 72 mm (576 dots), at 203 dpi
    {name: 'XP-58IIH', brand: 'Xprinter', dpi: 203, width: 384, language: 'escpos', raster: 'gsv0', media: 'roll', source: 'reported'},
    {name: 'XP-Q80K', brand: 'Xprinter', dpi: 203, width: 576, language: 'escpos', raster: 'gsv0', media: 'roll', source: 'reported'},
    {name: 'GP-58130IVC', brand: 'Gprinter', dpi: 203, width: 384, language: 'escpos', raster: 'gsv0', media: 'roll', source: 'reported'},
    {name: 'TP80K', brand: 'HPRT', dpi: 203, width: 576, language: 'escpos', raster: 'gsv0', media: 'roll', source: 'reported'},
    {name: 'ZJ-5870', brand: 'Zjiang', dpi: 203, width: 384, language: 'escpos', raster: 'gsv0', media: 'roll', source: 'reported'},
    //Label printers: the label size comes from the rendering
    {name: 'TDP-225', brand: 'TSC', dpi: 203, width: 416, language: 'tspl', media: 'label', source: 'documented'},
    {name: 'TDP-324', brand: 'TSC', dpi: 300, width: 576, language: 'tspl', media: 'label', source: 'documented'},
    //Wristband printers
    {name: 'TDP-225W', brand: 'TSC', dpi: 203, width: 416, language: 'tspl', media: 'label', source: 'documented'},
    {name: 'TDP-324W', brand: 'TSC', dpi: 300, width: 576, language: 'tspl', media: 'label', source: 'documented'},
    //Zebra HC100: 300 dpi (12 dots/mm), print widths of 19.05, 25.4 and 30.16 mm by its cartridge, which also gives the
    //length (^PW and ^LL ignored); the first 25.4 mm of a band are not printed; it prints along the band
    {name: 'HC100', brand: 'Zebra', dpi: 300, width: 361, language: 'zpl', media: 'label', rotate: 90, lead: 25.4, mediaFromCartridge: true, source: 'documented'},
    {name: 'ZD510-HC', brand: 'Zebra', dpi: 300, width: 361, language: 'zpl', media: 'label', rotate: 90, mediaFromCartridge: true, source: 'documented'}
]

/**
 * The models by their names, lowercase
 */
const BY_NAME: Map<string, PrinterModel> = new Map(MODELS.map((model: PrinterModel): [string, PrinterModel] => [model.name.toLowerCase(), model]))

/**
 * A model of the table by its name (case not significant)
 * @param name
 */
export function modelOf(name: string): PrinterModel | undefined {
    return BY_NAME.get(String(name).toLowerCase())
}

/**
 * The printer models the renderings and the encodings know by name (`model`): their resolution, print width, command
 * language and media. A printer not listed is given by its figures (`width` and `dpi`, or `label` and `dpi`, and the
 * `language` of the encoding).
 * @returns The models, in the order of the table.
 * @example
 * ```typescript
 * import {printerModels} from '@lakutata/thermal'
 *
 * for (const model of printerModels()) console.log(model.name, model.dpi, model.width, model.language)
 * ```
 */
export function printerModels(): PrinterModel[] {
    return MODELS.map((model: PrinterModel): PrinterModel => ({...model}))
}

setModelLookup((name: string) => {
    const model: PrinterModel | undefined = modelOf(name)
    return model ? {dpi: model.dpi, width: model.width, media: model.media, rotate: model.rotate, lead: model.lead} : undefined
})

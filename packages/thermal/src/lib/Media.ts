import {ThermalOptionException} from '../exceptions/ThermalOptionException.js'
import type {Length, MediaOptions} from './Types.js'

/**
 * A media resolved to the printer's dots
 */
export interface ResolvedMedia {
    /**
     * The resolution in dots per inch
     */
    dpi: number

    /**
     * The dots of a millimetre (8 at 203 dpi, 12 at 300 dpi)
     */
    dotsPerMm: number

    /**
     * The width of the layout in dots (along the band for a rotated page, its lead taken off)
     */
    layoutWidth: number

    /**
     * The length of a page of the layout in dots (across the head for a rotated page, its lead taken off for the others),
     * 0 for a continuous roll
     */
    pageLength: number

    /**
     * The dots left blank at the start of each printed page, along the feed (added after the rotation)
     */
    lead: number

    rotate: 0 | 90 | 180 | 270

    paginate: boolean
}

/**
 * The media a model gives (its resolution, its print width, a roll or labels, its rotation and lead), from the printer
 * table
 */
export interface ModelMedia {
    dpi: number
    //The print width in dots
    width: number
    //A roll (its width the print width) or labels (their size given by the label option)
    media: 'roll' | 'label'
    rotate?: 0 | 90 | 180 | 270
    //Millimetres
    lead?: number
}

/**
 * The models of the printer table, set by the table (Models.ts) when it is loaded
 */
let models: (name: string) => ModelMedia | undefined = (): undefined => undefined

/**
 * Set how a model's media is found (the printer table)
 * @param lookup
 */
export function setModelLookup(lookup: (name: string) => ModelMedia | undefined): void {
    models = lookup
}

/**
 * The paper widths of the 203 dpi receipt printers: their print widths in millimetres
 */
const PAPERS: Record<string, number> = {'58': 48, '80': 72}

/**
 * The dots of a millimetre at a resolution: the common resolutions are their exact dot pitch (203 dpi is 8 dots per
 * millimetre, 203.2 dpi; 300 dpi is 12, 304.8 dpi), the others their quotient
 * @param dpi
 */
export function dotsPerMmOf(dpi: number): number {
    const pitches: Record<number, number> = {203: 8, 300: 12, 406: 16, 600: 24}
    return pitches[dpi] ?? dpi / 25.4
}

/**
 * A length in dots, rounded down (a bitmap is never wider than the head: two dots narrower is an invisible margin, two
 * wider are cut off by the printer without an error)
 * @param length
 * @param dotsPerMm
 * @param what the name of the option, for the errors
 */
export function dotsOf(length: Length, dotsPerMm: number, what: string): number {
    if (typeof length === 'number') {
        if (!Number.isFinite(length) || length < 0) throw new ThermalOptionException(`${what} is a positive length`)
        return Math.floor(length * dotsPerMm + 1e-6)
    }
    const match: RegExpExecArray | null = /^\s*(\d+(?:\.\d+)?)\s*(mm|cm|in|dots?)?\s*$/i.exec(length)
    if (!match) throw new ThermalOptionException(`${what} is a number of millimetres or a length with its unit (mm, cm, in, dots)`)
    const value: number = Number(match[1])
    switch ((match[2] ?? 'mm').toLowerCase()) {
        case 'cm':
            return Math.floor(value * 10 * dotsPerMm + 1e-6)
        case 'in':
            return Math.floor(value * 25.4 * dotsPerMm + 1e-6)
        case 'dot':
        case 'dots':
            return Math.floor(value)
        default:
            return Math.floor(value * dotsPerMm + 1e-6)
    }
}

/**
 * The media of a rendering in dots
 * @param options
 */
export function resolveMedia(options: MediaOptions): ResolvedMedia {
    const given: string[] = (['model', 'paper', 'label', 'width'] as const).filter((name): boolean => options[name] !== undefined)
    //A label printer's model gives its resolution and its habits, the label its size: the one pair allowed
    const model: ModelMedia | undefined = options.model !== undefined ? models(options.model) : undefined
    if (options.model !== undefined && !model) throw new ThermalOptionException(`Unknown model ${options.model} (printerModels() lists them)`)
    const pair: boolean = given.length === 2 && model?.media === 'label' && options.label !== undefined
    if (given.length !== 1 && !pair) throw new ThermalOptionException(given.length ? `One media is given, not ${given.join(' and ')}` : 'A media is given: model, paper, label or width')
    if (model?.media === 'label' && options.label === undefined) throw new ThermalOptionException(`The model ${options.model} prints labels: give their size (label)`)
    const rotate: 0 | 90 | 180 | 270 = options.rotate ?? model?.rotate ?? 0
    if (![0, 90, 180, 270].includes(rotate)) throw new ThermalOptionException('rotate is 0, 90, 180 or 270')
    const paginate: boolean = options.page?.overflow === 'paginate'
    if (options.page?.overflow !== undefined && !['clip', 'paginate'].includes(options.page.overflow)) throw new ThermalOptionException('page.overflow is \'clip\' or \'paginate\'')
    const turned: boolean = rotate === 90 || rotate === 270
    let dpi: number
    let width: number
    let length: number = 0
    let lead: number = 0
    if (model) {
        if (options.dpi !== undefined && options.dpi !== model.dpi) throw new ThermalOptionException(`The model ${options.model} is ${model.dpi} dpi`)
        dpi = model.dpi
        if (options.label !== undefined) {
            width = dotsOf(options.label.width, dotsPerMmOf(dpi), 'label.width')
            length = dotsOf(options.label.height, dotsPerMmOf(dpi), 'label.height')
            if (width > model.width) throw new ThermalOptionException(`The label is ${width} dots wide, wider than the ${model.width} dots the model ${options.model} prints`)
        } else {
            width = model.width
        }
        if (model.lead) lead = dotsOf(model.lead, dotsPerMmOf(dpi), 'lead')
    } else if (options.paper !== undefined) {
        const printWidth: number | undefined = PAPERS[String(options.paper).replace(/mm$/i, '')]
        if (printWidth === undefined) throw new ThermalOptionException('paper is 58 or 80 (the 203 dpi receipt printers); other printers are given by model, or by width and dpi')
        if (options.dpi !== undefined && options.dpi !== 203) throw new ThermalOptionException('paper is a 203 dpi printer: give another resolution by width and dpi, or by model')
        dpi = 203
        width = dotsOf(printWidth, dotsPerMmOf(dpi), 'paper')
    } else {
        if (options.dpi === undefined) throw new ThermalOptionException(`${options.label !== undefined ? 'label' : 'width'} needs the resolution of the printer (dpi)`)
        dpi = options.dpi
        if (!Number.isFinite(dpi) || dpi < 50 || dpi > 1200) throw new ThermalOptionException('dpi is 50 to 1200')
        if (options.label !== undefined) {
            width = dotsOf(options.label.width, dotsPerMmOf(dpi), 'label.width')
            length = dotsOf(options.label.height, dotsPerMmOf(dpi), 'label.height')
        } else {
            width = dotsOf(options.width!, dotsPerMmOf(dpi), 'width')
        }
    }
    const dotsPerMm: number = dotsPerMmOf(dpi)
    if (options.page?.length !== undefined) {
        if (options.label !== undefined) throw new ThermalOptionException('page.length is given for a media of width, paper or a roll model only (a label gives its own)')
        length = dotsOf(options.page.length, dotsPerMm, 'page.length')
    }
    if (options.page?.lead !== undefined) lead = dotsOf(options.page.lead, dotsPerMm, 'page.lead')
    if (width < 1 || width > 32768) throw new ThermalOptionException(`The print width is ${width} dots: 1 to 32768`)
    if (lead && !length) throw new ThermalOptionException('page.lead is given for a media of a fixed length')
    if (length && lead >= length) throw new ThermalOptionException('page.lead is not shorter than the page')
    if (turned && !length) throw new ThermalOptionException('A rotated page needs a fixed length (label, model, or page.length)')
    //The lead is along the feed: the layout is shorter by it along the axis that becomes the feed. A rotated page is laid
    //out along its length (the width of the layout), across the head (the length of the layout's page)
    return turned
        ? {dpi, dotsPerMm, layoutWidth: length - lead, pageLength: width, lead, rotate, paginate}
        : {dpi, dotsPerMm, layoutWidth: width, pageLength: length ? length - lead : 0, lead, rotate, paginate}
}

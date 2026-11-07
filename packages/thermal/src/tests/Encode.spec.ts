import {describe, it} from 'node:test'
import assert from 'node:assert'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {encode, printerModels, type PrintImage, render, ThermalOptionException} from '../exports/Thermal.js'
import {decodeEscPos, decodeTspl, decodeZpl, sameDots, trimmed} from './support/Decoders.js'

const FIXTURES: string = fileURLToPath(new URL('../../../src/tests/fixtures/', import.meta.url))
const RECEIPT: string = readFileSync(`${FIXTURES}receipt.html`, 'utf8')

describe('The encoders', (): void => {
    it('encode ESC/POS raster bands that decode to the dots of the page, by each raster command', async (): Promise<void> => {
        for (const options of [{paper: 58} as const, {paper: 80} as const, {width: 72, dpi: 180}]) {
            const image: PrintImage = await render(RECEIPT, options)
            const page = image.pages[0]!
            for (const raster of ['gsv0', 'gsl', 'esc*'] as const) {
                //Every row sent
                const every = decodeEscPos(encode(image, {language: 'escpos', raster, skipBlank: false}))
                assert.ok(every.initialized)
                assert.strictEqual(every.pages.length, 1)
                const got = raster === 'esc*' ? trimmed(every.pages[0]!, page.height) : every.pages[0]!
                assert.strictEqual(got.height, page.height, `${raster} ${JSON.stringify(options)}`)
                assert.ok(got.rows.equals(page.rows), `${raster} ${JSON.stringify(options)}: the dots differ`)
                //The blank stretches fed over (the default): the same dots
                const skipped = decodeEscPos(encode(image, {language: 'escpos', raster}))
                assert.ok(sameDots(skipped.pages[0]!, skipped.feeds[0]!, page), `${raster} ${JSON.stringify(options)}: the dots differ once skipped`)
                assert.ok(raster === 'esc*' || skipped.pages[0]!.height + skipped.feeds[0]! === page.height)
            }
        }
    })

    it('write the ESC/POS commands byte for byte: the bands, the feed, the cut, the drawer', async (): Promise<void> => {
        const image: PrintImage = await render('<div style="height:40mm;background:#000"></div>', {paper: 80})
        assert.strictEqual(image.height, 320)
        const bytes: Buffer = encode(image, {language: 'escpos', feed: 5, cut: 'partial', drawer: {pin: 5, on: 100, off: 400}})
        //ESC @, GS P 0 203 (the feed counts in dots), then GS v 0 of 72 bytes × 255 rows
        assert.deepStrictEqual([...bytes.subarray(0, 14)], [0x1B, 0x40, 0x1D, 0x50, 0x00, 203, 0x1D, 0x76, 0x30, 0x00, 72, 0, 255, 0])
        //The second band: the 65 rows left
        assert.deepStrictEqual([...bytes.subarray(14 + 72 * 255, 14 + 72 * 255 + 8)], [0x1D, 0x76, 0x30, 0x00, 72, 0, 65, 0])
        //The end: ESC J 40 (5 mm), GS V 66 0, ESC p 1 50 200
        assert.deepStrictEqual([...bytes.subarray(-12)], [0x1B, 0x4A, 40, 0x1D, 0x56, 0x42, 0x00, 0x1B, 0x70, 0x01, 50, 200])
        const decoded = decodeEscPos(bytes)
        assert.deepStrictEqual([decoded.motionUnit, decoded.feeds, decoded.cuts, decoded.drawer], [203, [40], ['partial'], {pin: 5, on: 100, off: 400}])
        //Without feed nor ESC *: no GS P; a smaller band height
        const plain: Buffer = encode(image, {language: 'escpos', bandHeight: 100, initialize: false})
        assert.deepStrictEqual([...plain.subarray(0, 8)], [0x1D, 0x76, 0x30, 0x00, 72, 0, 100, 0])
        //GS ( L: its length on two bytes (10 + the data), fn 112 then fn 50
        const graphics: Buffer = encode(image, {language: 'escpos', raster: 'gsl', initialize: false})
        assert.deepStrictEqual([...graphics.subarray(0, 15)], [0x1D, 0x28, 0x4C, (10 + 72 * 255) & 0xFF, (10 + 72 * 255) >> 8, 0x30, 0x70, 0x30, 1, 1, 0x31, 576 & 0xFF, 576 >> 8, 255, 0])
    })

    it('encode TSPL labels: their size, sensor and settings, each page a bitmap of inverted bits', async (): Promise<void> => {
        const image: PrintImage = await render('<b>Ward 3 · Bed 12</b>', {label: {width: 25, height: 250}, dpi: 300, rotate: 90, page: {lead: 25.4}})
        const bytes: Buffer = encode(image, {language: 'tspl', density: 8, speed: 4, copies: 2})
        const decoded = decodeTspl(bytes)
        assert.deepStrictEqual(decoded.commands.slice(0, 6), ['SIZE 25 mm,250 mm', 'GAP 2 mm,0 mm', 'DENSITY 8', 'SPEED 4', 'DIRECTION 0', 'CLS'])
        assert.strictEqual(decoded.commands[decoded.commands.length - 1], 'PRINT 1,2')
        //The blank lead (25.4 mm at 300 dpi) left white: the first BITMAP below it
        assert.ok(Number(decoded.commands[6]!.split(',')[1]) >= 300, decoded.commands[6])
        assert.ok(sameDots(decoded.pages[0]!, 3000, image.pages[0]!))
        assert.deepStrictEqual(decodeTspl(encode(image, {language: 'tspl', skipBlank: false})).commands.filter((command: string): boolean => command.startsWith('BITMAP')), ['BITMAP 0,0,38,3000,0'])
        const mark = decodeTspl(encode(image, {language: 'tspl', sensor: 'mark', gap: 3}))
        assert.strictEqual(mark.commands[1], 'BLINE 3 mm,0 mm')
        assert.strictEqual(decodeTspl(encode(image, {language: 'tspl', sensor: 'continuous'})).commands[1], 'GAP 0 mm,0 mm')
        //Pages: each a CLS, a BITMAP and a PRINT
        const paged: PrintImage = await render('<div style="height:70mm;background:#000"></div>', {label: {width: 40, height: 30}, dpi: 203, page: {overflow: 'paginate'}})
        const three = decodeTspl(encode(paged, {language: 'tspl'}))
        assert.strictEqual(three.pages.length, 3)
        assert.strictEqual(three.commands.filter((command: string): boolean => command.startsWith('PRINT')).length, 3)
        three.pages.forEach((page, index): void => assert.ok(sameDots(page, paged.pages[index]!.height, paged.pages[index]!)))
    })

    it('encode ZPL labels, the graphic field compressed or not, both decoding to the dots of the page', async (): Promise<void> => {
        const band: PrintImage = await render(`<b>Ward 3 · Bed 12</b><br><img style="width:15mm" src="qrcode:20261107-0042">`, {model: 'HC100', label: {width: 25, height: 250}})
        assert.deepStrictEqual([band.width, band.height], [300, 3000])
        const compressed: Buffer = encode(band, {model: 'HC100', sensor: 'mark', density: 20, speed: 2})
        const plain: Buffer = encode(band, {model: 'HC100', sensor: 'mark', compress: false})
        assert.ok(compressed.length * 4 < plain.length, `${compressed.length} × 4 < ${plain.length}`)
        assert.ok(compressed.toString('latin1').startsWith('~SD20\n^XA^PW300^LL3000^MNM^PR2^FO0,0^GFA,114000,114000,38,'))
        for (const bytes of [compressed, plain]) {
            const decoded = decodeZpl(bytes)
            assert.strictEqual(decoded.pages.length, 1)
            assert.ok(decoded.pages[0]!.rows.equals(band.pages[0]!.rows))
            assert.deepStrictEqual([decoded.pages[0]!.labelWidth, decoded.pages[0]!.labelLength], [300, 3000])
        }
        //Runs longer than 400 digits, rows of black and white ends, rows repeated
        const blocks: PrintImage = await render('<div style="height:10mm;background:#000"></div><div style="height:10mm"></div><div style="width:20mm;height:10mm;background:#000"></div>', {width: 104, dpi: 203})
        const decoded = decodeZpl(encode(blocks, {language: 'zpl', sensor: 'continuous'}))
        assert.ok(decoded.pages[0]!.rows.equals(blocks.pages[0]!.rows))
        assert.match(decoded.commands[0]!, /\^MNN/)
    })

    it('feeds over the blank stretches of a page instead of sending them, the dots the same', async (): Promise<void> => {
        //Black blocks of 5 mm: 20 mm blank between the first two, 0.5 mm between the last two
        const block: string = '<div style="height: 5mm; background: #000"></div>'
        const html: string = `${block}<div style="height: 20mm"></div>${block}<div style="height: 0.5mm"></div>${block}`
        const image: PrintImage = await render(html, {paper: 58})
        const page = image.pages[0]!
        for (const raster of ['gsv0', 'gsl', 'esc*'] as const) {
            const skipped: Buffer = encode(image, {language: 'escpos', raster})
            const every: Buffer = encode(image, {language: 'escpos', raster, skipBlank: false})
            //Most of the 160 blank rows of 48 bytes not sent (ESC *: its whole bands of 24 rows)
            assert.ok(every.length - skipped.length > 140 * 48, `${raster}: ${every.length} → ${skipped.length}`)
            const decoded = decodeEscPos(skipped)
            //GS P first, the feeds in dots
            assert.strictEqual(decoded.motionUnit, 203)
            assert.ok(sameDots(decoded.pages[0]!, decoded.feeds[0]!, page), raster)
        }
        //A blank stretch under a millimetre stays in the rows sent: a band, then a feed of 20 mm, then one band
        const bands: number = (encode(image, {language: 'escpos'}).toString('latin1').match(/\x1Dv0/g) ?? []).length
        assert.strictEqual(bands, 2)
        //Every row sent: no feed, no GS P
        const every = decodeEscPos(encode(image, {language: 'escpos', skipBlank: false}))
        assert.deepStrictEqual([every.motionUnit, every.feeds], [0, [0]])
        //ESC/POS over 255 dpi: GS P cannot set the dot pitch, every row sent
        const fine: PrintImage = await render(html, {width: 48, dpi: 300})
        assert.strictEqual(decodeEscPos(encode(fine, {language: 'escpos'})).motionUnit, 0)
        //TSPL: a BITMAP for each stretch printed, the label the same
        const label: PrintImage = await render(html, {label: {width: 48, height: 60}, dpi: 203})
        const tspl = decodeTspl(encode(label, {language: 'tspl'}))
        assert.strictEqual(tspl.commands.filter((command: string): boolean => command.startsWith('BITMAP')).length, 2)
        assert.ok(sameDots(tspl.pages[0]!, label.pages[0]!.height, label.pages[0]!))
    })

    it('cuts after each page on the three languages, and turns the cutter of a label printer off', async (): Promise<void> => {
        const receipt: PrintImage = await render('<p>one</p>', {paper: 58, page: {length: 20}})
        const label: PrintImage = await render('<b>A-12</b>', {label: {width: 40, height: 30}, dpi: 203})
        //ESC/POS: GS V after each page; true is a full cut
        assert.deepStrictEqual(decodeEscPos(encode(receipt, {language: 'escpos', cut: true})).cuts, ['full'])
        assert.deepStrictEqual(decodeEscPos(encode(receipt, {language: 'escpos'})).cuts, [])
        //TSPL: the cutter set before the labels
        const tspl = (cut?: 'full' | 'partial' | boolean): string[] => encode(label, {language: 'tspl', cut}).toString('latin1').split('\r\n').filter((line: string): boolean => /CUTTER/.test(line))
        assert.deepStrictEqual(tspl(true), ['SET CUTTER 1'])
        assert.deepStrictEqual(tspl('full'), ['SET CUTTER 1'])
        assert.deepStrictEqual(tspl('partial'), ['SET PARTIAL_CUTTER 1'])
        assert.deepStrictEqual(tspl(false), ['SET CUTTER OFF'])
        assert.deepStrictEqual(tspl(), [])
        //ZPL: the cutter mode in each label
        const zpl = (cut?: 'full' | 'partial' | boolean): string[] => encode(label, {language: 'zpl', cut}).toString('latin1').match(/\^MM./g) ?? []
        assert.deepStrictEqual(zpl('partial'), ['^MMC'])
        assert.deepStrictEqual(zpl(false), ['^MMT'])
        assert.deepStrictEqual(zpl(), [])
        assert.strictEqual(decodeZpl(encode(label, {language: 'zpl', cut: true})).pages.length, 1)
        assert.throws((): void => {
            encode(label, {language: 'zpl', cut: 'half' as 'full'})
        }, ThermalOptionException)
    })

    it('knows the printers of its table by name, for the renderings and the encodings', async (): Promise<void> => {
        const models = printerModels()
        assert.ok(models.length >= 15)
        assert.ok(models.every((model): boolean => ['escpos', 'tspl', 'zpl'].includes(model.language) && model.dpi > 0 && model.width > 0))
        assert.strictEqual((await render('<p>x</p>', {model: 'TM-T88VI'})).width, 512)
        assert.strictEqual((await render('<p>x</p>', {model: 'tm-t20iii'})).width, 576)
        const decoded = decodeEscPos(encode(await render('<p>x</p>', {model: 'TM-T88VI'}), {model: 'TM-T88VI'}))
        assert.strictEqual(decoded.pages[0]!.width, 512)
        await assert.rejects(render('<p>x</p>', {model: 'HC100'}), ThermalOptionException)
        await assert.rejects(render('<p>x</p>', {model: 'HC100', label: {width: 40, height: 250}}), ThermalOptionException)
        await assert.rejects(render('<p>x</p>', {model: 'TM-T88VI', label: {width: 40, height: 30}, dpi: 180}), ThermalOptionException)
        await assert.rejects(render('<p>x</p>', {model: 'TM-T88VI', dpi: 203}), ThermalOptionException)
    })

    it('refuses the options of an encoding that are not valid', async (): Promise<void> => {
        const image: PrintImage = await render('<p>x</p>', {paper: 58})
        const cases: object[] = [{}, {language: 'pcl'}, {model: 'NONE'}, {model: 'HC100', language: 'escpos'}, {language: 'escpos', raster: 'gsv1'},
            {language: 'escpos', cut: 'half'}, {language: 'escpos', bandHeight: 0}, {language: 'escpos', drawer: {pin: 3}}, {language: 'tspl', density: 16},
            {language: 'zpl', density: 31}, {language: 'zpl', copies: 0}, {language: 'tspl', sensor: 'hole'}]
        for (const options of cases) assert.throws((): Buffer => encode(image, options as never), ThermalOptionException, JSON.stringify(options))
        assert.throws((): Buffer => encode({} as never, {language: 'escpos'}), ThermalOptionException)
    })
})

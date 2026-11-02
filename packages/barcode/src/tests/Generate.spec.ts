import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {
    Barcode,
    BARCODE_FORMATS,
    BarcodeContentException,
    type BarcodeFormat,
    barcodeFormats,
    BarcodeOptionException,
    type BarcodeResult,
    type RawImage
} from '../exports/Barcode.js'

/**
 * A content of every format, and the text a read gives (its check digits added, its human readable form)
 */
const SAMPLES: Record<BarcodeFormat, [string, string]> = {
    EAN13: ['590123412345', '5901234123457'],
    EAN8: ['9638507', '96385074'],
    UPCA: ['01234567890', '0012345678905'],
    UPCE: ['0123456', '0012345000065'],
    ISBN: ['9780143007234', '9780143007234'],
    DataBar: ['0950600013435', '(01)09506000134352'],
    DataBarStacked: ['0950600013435', '(01)09506000134352'],
    DataBarStackedOmni: ['0950600013435', '(01)09506000134352'],
    DataBarLimited: ['0950600013435', '(01)09506000134352'],
    DataBarExpanded: ['[01]09506000134352[17]261231', '(01)09506000134352(17)261231'],
    DataBarExpandedStacked: ['[01]09506000134352[17]261231[10]ABC123', '(01)09506000134352(17)261231(10)ABC123'],
    Code128: ['LKT-1001 lakutata', 'LKT-1001 lakutata'],
    Code39: ['CODE39 TEST', 'CODE39 TEST'],
    Code39Extended: ['Code39 ext', 'Code39 ext'],
    Code32: ['12345678', 'A123456788'],
    PZN: ['1234567', '-12345678'],
    Code93: ['CODE93 TEST', 'CODE93 TEST'],
    ITF: ['12345678', '12345678'],
    ITF14: ['1234567890123', '12345678901231'],
    Codabar: ['A123456B', 'A123456B'],
    Telepen: ['Telepen 1', 'Telepen 1'],
    DXFilmEdge: ['77-2', '77-2'],
    QRCode: ['https://lakutata.com', 'https://lakutata.com'],
    MicroQRCode: ['LAKUTATA', 'LAKUTATA'],
    RMQRCode: ['https://lakutata.com', 'https://lakutata.com'],
    DataMatrix: ['lakutata 123', 'lakutata 123'],
    PDF417: ['lakutata PDF417', 'lakutata PDF417'],
    CompactPDF417: ['lakutata compact', 'lakutata compact'],
    MicroPDF417: ['lakutata micro', 'lakutata micro'],
    Aztec: ['lakutata aztec', 'lakutata aztec'],
    AztecRune: ['123', '123'],
    MaxiCode: ['lakutata maxicode', 'lakutata maxicode']
}

/**
 * The width of the first run of dark pixels of a row of a gray image
 * @param image
 * @param row
 */
function firstBar(image: RawImage, row: number): number {
    let x: number = 0
    while (x < image.width && image.data[row * image.width + x] > 127) x++
    let width: number = 0
    while (x + width < image.width && image.data[row * image.width + x + width] <= 127) width++
    return width
}

describe('The generation of barcodes', (): void => {
    const container: Container = new Container()
    let barcode: Barcode

    before(async (): Promise<void> => {
        barcode = await container.get(Barcode)
    })

    after(async (): Promise<void> => {
        await container.destroy()
    })

    it('lists every format with the options of its symbol, in the order of BARCODE_FORMATS', (): void => {
        assert.deepStrictEqual(barcodeFormats.map((format) => format.name), [...BARCODE_FORMATS])
        const qr = barcodeFormats.find((format) => format.name === 'QRCode')!
        assert.deepStrictEqual({...qr}, {name: 'QRCode', reads: 'QRCode', errorCorrection: 'LMQH', versions: 40, gs1: true, eci: true, addOn: false, text: false})
        assert.strictEqual(barcodeFormats.find((format) => format.name === 'EAN13')!.addOn, true)
        assert.strictEqual(barcodeFormats.find((format) => format.name === 'PDF417')!.errorCorrection, '0-8')
        assert.ok(Object.isFrozen(barcodeFormats) && Object.isFrozen(barcodeFormats[0]))
    })

    for (const format of BARCODE_FORMATS) {
        it(`reads back ${format} as it generated it, from its PNG and from its pixels`, async (): Promise<void> => {
            const [content, text] = SAMPLES[format]
            const reads: string = barcodeFormats.find((info) => info.name === format)!.reads
            const png: Buffer = await barcode.generate(format, content)
            const raw: RawImage = await barcode.generate(format, content, {output: 'raw'})
            for (const image of [png, raw]) {
                const results: BarcodeResult[] = await barcode.read(image)
                assert.strictEqual(results.length, 1, `${format}: ${JSON.stringify(results)}`)
                assert.strictEqual(results[0].format, reads)
                assert.strictEqual(results[0].text, text)
            }
            //Looked for alone, and in an image made by generate() (pure)
            assert.strictEqual((await barcode.read(raw, {formats: [format], pure: true}))[0]?.text, text)
        })
    }

    it('reads back random contents of the matrix formats and of Code 128', async (): Promise<void> => {
        const characters: string = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -._~:/?#[]@!$&()*+,;=%éüñ中文日本語한국어'
        let seed: number = 12345
        const random = (limit: number): number => (seed = (seed * 1103515245 + 12345) % 2147483648) % limit
        for (const format of ['QRCode', 'DataMatrix', 'Aztec', 'PDF417', 'Code128'] as const) {
            for (let i = 0; i < 20; i++) {
                const length: number = 1 + random(format === 'Code128' ? 30 : 120)
                let content: string = ''
                for (let j = 0; j < length; j++) content += characters[random(format === 'Code128' ? 62 : characters.length)]
                const results: BarcodeResult[] = await barcode.read(await barcode.generate(format, content, {output: 'raw'}), {formats: [format]})
                assert.deepStrictEqual(results.map((result) => result.text), [content], `${format}: ${JSON.stringify(content)}`)
            }
        }
    })

    it('reads back the bytes of a binary content', async (): Promise<void> => {
        const bytes: Uint8Array = Uint8Array.from({length: 256}, (_value: unknown, index: number): number => index)
        for (const format of ['QRCode', 'DataMatrix', 'Aztec', 'PDF417'] as const) {
            const [result] = await barcode.read(await barcode.generate(format, bytes, {output: 'raw'}))
            assert.deepStrictEqual([...result.bytes], [...bytes], format)
        }
    })

    it('gives a PNG, an SVG or the pixels', async (): Promise<void> => {
        const png: Buffer = await barcode.generate('QRCode', 'lakutata')
        assert.ok(Buffer.isBuffer(png))
        assert.strictEqual(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
        const svg: string = await barcode.generate('QRCode', 'lakutata', {output: 'svg'})
        assert.match(svg, /^<\?xml[^]*<svg[^]*<\/svg>\s*$/)
        const raw: RawImage = await barcode.generate('QRCode', 'lakutata', {output: 'raw'})
        assert.strictEqual(raw.channels, 1)
        assert.strictEqual(raw.data.length, raw.width * raw.height)
    })

    it('makes the modules as many pixels wide as its scale', async (): Promise<void> => {
        for (const scale of [1, 2, 3, 5]) {
            const raw: RawImage = await barcode.generate('Code128', 'LKT', {output: 'raw', scale: scale, quietZone: false, showText: false})
            //The first bar of Code 128 (its start character) is 2 modules wide
            assert.strictEqual(firstBar(raw, 0), 2 * scale, `scale ${scale}`)
        }
    })

    it('adds the quiet zones of the standard, none, or a margin of modules', async (): Promise<void> => {
        const none: RawImage = await barcode.generate('QRCode', 'lakutata', {output: 'raw', scale: 1, quietZone: false})
        const standard: RawImage = await barcode.generate('QRCode', 'lakutata', {output: 'raw', scale: 1})
        const margin: RawImage = await barcode.generate('QRCode', 'lakutata', {output: 'raw', scale: 1, quietZone: 2})
        //Version 1: 21 modules, the quiet zone of QR Code is 4 modules
        assert.strictEqual(none.width, 21)
        assert.strictEqual(standard.width, 29)
        assert.strictEqual(margin.width, 25)
    })

    it('turns the code', async (): Promise<void> => {
        const straight: RawImage = await barcode.generate('Code128', 'LKT-1001', {output: 'raw'})
        const turned: RawImage = await barcode.generate('Code128', 'LKT-1001', {output: 'raw', rotate: 90})
        assert.deepStrictEqual([turned.width, turned.height], [straight.height, straight.width])
        const [result] = await barcode.read(turned)
        assert.strictEqual(result.text, 'LKT-1001')
        assert.strictEqual(result.orientation, 90)
    })

    it('colors its bars and its background, transparent too', async (): Promise<void> => {
        const colored: RawImage = await barcode.generate('QRCode', 'lakutata', {output: 'raw', foreground: '#1E3A8A', background: '#FFF7E0'})
        assert.strictEqual(colored.channels, 3)
        assert.deepStrictEqual([...colored.data.subarray(0, 3)], [0xFF, 0xF7, 0xE0])
        const transparent: RawImage = await barcode.generate('QRCode', 'lakutata', {output: 'raw', background: '#FFFFFF00'})
        assert.strictEqual(transparent.channels, 4)
        assert.strictEqual(transparent.data[3], 0)
        //Over white when it is read
        assert.strictEqual((await barcode.read(await barcode.generate('QRCode', 'lakutata', {background: '#FFFFFF00'})))[0].text, 'lakutata')
        assert.strictEqual((await barcode.read(colored))[0].text, 'lakutata')
    })

    it('shows the text of a linear code under its bars, or not, and makes its bars as high as asked', async (): Promise<void> => {
        const withText: RawImage = await barcode.generate('Code128', 'LKT', {output: 'raw', scale: 2})
        const withoutText: RawImage = await barcode.generate('Code128', 'LKT', {output: 'raw', scale: 2, showText: false})
        assert.ok(withText.height > withoutText.height)
        const high: RawImage = await barcode.generate('Code128', 'LKT', {output: 'raw', scale: 1, showText: false, height: 80, quietZone: false})
        assert.strictEqual(high.height, 80)
        //Ignored by a matrix code
        const qr: RawImage = await barcode.generate('QRCode', 'lakutata', {output: 'raw', showText: true, height: 80})
        assert.strictEqual(qr.width, qr.height)
    })

    it('chooses the error correction and the version of the matrix codes', async (): Promise<void> => {
        for (const level of ['L', 'M', 'Q', 'H'] as const) {
            const [result] = await barcode.read(await barcode.generate('QRCode', 'lakutata', {output: 'raw', errorCorrection: level}))
            assert.strictEqual(result.errorCorrectionLevel, level)
        }
        const [large] = await barcode.read(await barcode.generate('QRCode', 'lakutata', {output: 'raw', version: 10}))
        assert.strictEqual(large.version, '10')
        const [aztec] = await barcode.read(await barcode.generate('Aztec', 'lakutata', {output: 'raw', errorCorrection: 4}))
        assert.strictEqual(aztec.text, 'lakutata')
    })

    it('encodes GS1 data written with brackets or with parentheses', async (): Promise<void> => {
        for (const content of ['[01]09506000134352[17]261231[10]ABC123', '(01)09506000134352(17)261231(10)ABC123']) {
            for (const format of ['Code128', 'QRCode', 'DataMatrix'] as const) {
                const [result] = await barcode.read(await barcode.generate(format, content, {output: 'raw', gs1: true}))
                assert.strictEqual(result.text, '(01)09506000134352(17)261231(10)ABC123', `${format} ${content}`)
                assert.strictEqual(result.gs1, true)
            }
        }
        const [code128] = await barcode.read(await barcode.generate('Code128', '[01]09506000134352', {output: 'raw', gs1: true}))
        assert.strictEqual(code128.symbologyIdentifier, ']C1')
    })

    it('encodes text in the character set given by its ECI', async (): Promise<void> => {
        const [result] = await barcode.read(await barcode.generate('QRCode', 'Grüße 中文', {output: 'raw', eci: 26}))
        assert.strictEqual(result.text, 'Grüße 中文')
    })

    it('adds the add-on of an EAN or a UPC, read on its own', async (): Promise<void> => {
        for (const addOn of ['12', '12345']) {
            const [result] = await barcode.read(await barcode.generate('EAN13', '590123412345', {output: 'raw', addOn: addOn}))
            assert.strictEqual(result.text, '5901234123457')
            assert.strictEqual(result.addOn, addOn)
        }
        const [ignored] = await barcode.read(await barcode.generate('EAN13', '590123412345', {output: 'raw', addOn: '12'}), {addOn: 'ignore'})
        assert.strictEqual(ignored.addOn, undefined)
        assert.deepStrictEqual(await barcode.read(await barcode.generate('EAN13', '590123412345', {output: 'raw'}), {addOn: 'require'}), [])
    })

    it('refuses the options of the symbol a format does not take, with the reason', async (): Promise<void> => {
        const cases: [BarcodeFormat, Record<string, unknown>, RegExp][] = [
            ['Code128', {errorCorrection: 'H'}, /Code128 takes no errorCorrection/],
            ['QRCode', {errorCorrection: 5}, /one of the letters LMQH/],
            ['MicroQRCode', {errorCorrection: 'H'}, /one of the letters LMQ/],
            ['PDF417', {errorCorrection: 'M'}, /a level from 0 to 8/],
            ['QRCode', {version: 41}, /from 1 to 40/],
            ['EAN13', {version: 2}, /EAN13 takes no version/],
            ['Code39', {gs1: true}, /Code39 takes no GS1 data/],
            ['EAN13', {eci: 26}, /EAN13 takes no eci/],
            ['QRCode', {addOn: '12'}, /QRCode takes no addOn/]
        ]
        for (const [format, options, message] of cases) {
            await assert.rejects(barcode.generate(format, '1234567', options), (error: unknown): boolean => error instanceof BarcodeOptionException && message.test(error.message), `${format} ${JSON.stringify(options)}`)
        }
    })

    it('refuses a content the format cannot encode, with the reason of zint', async (): Promise<void> => {
        await assert.rejects(barcode.generate('EAN13', 'ABC'), BarcodeContentException)
        await assert.rejects(barcode.generate('EAN13', '12345678901234'), BarcodeContentException)
        await assert.rejects(barcode.generate('QRCode', 'x'.repeat(8000)), BarcodeContentException)
        await assert.rejects(barcode.generate('QRCode', 'x'.repeat(100), {version: 1}), BarcodeContentException)
        await assert.rejects(barcode.generate('DataBarExpanded', 'not GS1'), BarcodeContentException)
    })
})

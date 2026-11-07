import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createHash} from 'node:crypto'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {inflateSync} from 'node:zlib'
import {Container} from '@lakutata/core'
import {Barcode} from '@lakutata/barcode'
import {
    PrintImage,
    registerFont,
    render,
    ThermalCancelledException,
    ThermalContentException,
    ThermalFontException,
    ThermalOptionException
} from '../exports/Thermal.js'
import {native} from '../lib/Native.js'

const FIXTURES: string = fileURLToPath(new URL('../../../src/tests/fixtures/', import.meta.url))

/**
 * The fixtures' dots hashed, compared with src/tests/fixtures/golden.json (written again with
 * LAKUTATA_THERMAL_GOLDEN=write, the PNGs of a mismatch left in a temporary directory)
 */
const GOLDEN_FILE: string = path.join(FIXTURES, 'golden.json')

function hashOf(image: PrintImage): string {
    const hash = createHash('sha256')
    for (const page of image.pages) hash.update(`${page.width}x${page.height}:`).update(page.rows)
    return hash.digest('hex')
}

/**
 * The number of black dots of a page in a box
 */
function blackIn(image: PrintImage, x: number, y: number, width: number, height: number, page: number = 0): number {
    let black: number = 0
    for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) if (image.pages[page]!.dot(column, row)) black++
    return black
}

describe('The renderer', (): void => {
    it('converts the media to the dot grid of the printer, rounding down', async (): Promise<void> => {
        const html: string = '<p>x</p>'
        assert.strictEqual((await render(html, {paper: 58})).width, 384)
        assert.strictEqual((await render(html, {paper: '80mm'})).width, 576)
        assert.strictEqual((await render(html, {width: 72, dpi: 203})).width, 576)
        //180 dpi: 72 mm is 510.2 dots, the head 512: rounded down (never wider than the head)
        assert.strictEqual((await render(html, {width: '72mm', dpi: 180})).width, 510)
        assert.strictEqual((await render(html, {width: '512dots', dpi: 180})).width, 512)
        //300 dpi is 12 dots per millimetre (304.8 dpi): 2 inches are 609 dots
        assert.strictEqual((await render(html, {width: '2in', dpi: 300})).width, 609)
        const label: PrintImage = await render(html, {label: {width: 40, height: 30}, dpi: 300})
        assert.deepStrictEqual([label.width, label.height, label.pages.length, label.dpi, label.dotsPerMm], [480, 360, 1, 300, 12])
        //A wristband laid out along its length, turned: the width across the head, the lead blank at the top
        const band: PrintImage = await render('<b>Ward 3</b>', {label: {width: 25, height: 250}, dpi: 300, rotate: 90, page: {lead: 25.4}})
        assert.deepStrictEqual([band.width, band.height], [300, 3000])
        assert.strictEqual(blackIn(band, 0, 0, 300, 304), 0)
        assert.ok(blackIn(band, 0, 305, 300, 400) > 0)
    })

    it('refuses the media that are not one and complete', async (): Promise<void> => {
        const cases: object[] = [{}, {paper: 58, width: 72}, {paper: 76}, {label: {width: 25, height: 250}}, {width: 72}, {paper: 80, dpi: 300},
            {model: 'NONE'}, {paper: 58, rotate: 45}, {paper: 58, rotate: 90}, {label: {width: 25, height: 30}, dpi: 203, page: {lead: 30}},
            {width: 'wide', dpi: 203}, {paper: 58, page: {overflow: 'more'}}]
        for (const options of cases) await assert.rejects(render('<p>x</p>', options as never), ThermalOptionException, JSON.stringify(options))
        await assert.rejects(render(1 as never, {paper: 58}), ThermalOptionException)
    })

    it('renders the fixtures to the dots of their golden hashes, the same dots every time', async (): Promise<void> => {
        const golden: Record<string, string> = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'))
        const receipt: string = readFileSync(path.join(FIXTURES, 'receipt.html'), 'utf8')
        const features: string = readFileSync(path.join(FIXTURES, 'features.html'), 'utf8')
        const results: Record<string, PrintImage> = {
            'receipt-58': await render(receipt, {paper: 58}),
            'receipt-80': await render(receipt, {paper: 80}),
            'receipt-180dpi': await render(receipt, {width: 72, dpi: 180}),
            'features-58': await render(features, {paper: 58, baseDir: FIXTURES}),
            'features-80': await render(features, {paper: 80, baseDir: FIXTURES})
        }
        assert.strictEqual(hashOf(await render(receipt, {paper: 58})), hashOf(results['receipt-58']!))
        const hashes: Record<string, string> = Object.fromEntries(Object.entries(results).map(([name, image]): [string, string] => [name, hashOf(image)]))
        if (process.env.LAKUTATA_THERMAL_GOLDEN === 'write') {
            writeFileSync(GOLDEN_FILE, `${JSON.stringify(hashes, null, 2)}\n`)
            for (const [name, image] of Object.entries(results)) writeFileSync(path.join(FIXTURES, `${name}.png`), image.toPNG())
            return
        }
        const mismatched: string[] = Object.keys(hashes).filter((name: string): boolean => hashes[name] !== golden[name])
        if (mismatched.length) {
            const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-thermal-golden-'))
            for (const name of mismatched) writeFileSync(path.join(directory, `${name}.png`), results[name]!.toPNG())
            assert.fail(`The dots of ${mismatched.join(', ')} differ from their golden hashes (their PNGs in ${directory})`)
        }
    })

    it('switches the layout by the print width (@media), in millimetres', async (): Promise<void> => {
        const html: string = '<style>.wide{display:block}.narrow{display:none}@media (max-width: 50mm){.wide{display:none}.narrow{display:block}}</style><div class="wide" style="height:20mm;background:#000"></div><div class="narrow" style="height:10mm;background:#000"></div>'
        assert.strictEqual((await render(html, {paper: 58})).height, 80)
        assert.strictEqual((await render(html, {paper: 80})).height, 160)
    })

    it('draws the QR codes of qrcode: sources on whole dots, and reads them back', async (): Promise<void> => {
        const container: Container = new Container()
        const barcode: Barcode = await container.get(Barcode)
        try {
            const url: string = 'https://lakeside-cafe.example.com/r/20261107-0042'
            for (const options of [{paper: 58} as const, {paper: 80} as const, {width: 72, dpi: 180}]) {
                const image: PrintImage = await render(`<img style="width:30mm;height:30mm" src="qrcode:${encodeURIComponent(url)}#ec=M&quiet=2">`, options)
                const read = await barcode.read(image.toPNG())
                assert.deepStrictEqual(read.map((code): string => code.text), [url], JSON.stringify(options))
            }
        } finally {
            await container.destroy()
        }
    })

    it('breaks the lines as Unicode does, keeping the punctuation off the start of a line', (): void => {
        assert.deepStrictEqual(native.words('您好，世界！（大杯）', 'zh'), ['您', '好，', '世', '界！', '（大', '杯）'])
        assert.deepStrictEqual(native.words('Thank you, see you.', 'en'), ['Thank', ' ', 'you,', ' ', 'see', ' ', 'you.'])
        //A long word (a web address) breaks between its graphemes past 16 of them
        const words: string[] = native.words('https://lakeside-cafe.example.com/receipts', 'en')
        assert.ok(words.length > 3 && words.join('') === 'https://lakeside-cafe.example.com/receipts')
        //An order number keeps its hyphen and its digits together (no break before digits after a hyphen)
        assert.deepStrictEqual(native.words('20261107-0042', 'en'), ['20261107-0042'])
    })

    it('cuts long content into pages, or keeps the first page', async (): Promise<void> => {
        const html: string = '<div style="height:70mm;background:#000"></div>'
        const clipped: PrintImage = await render(html, {label: {width: 40, height: 30}, dpi: 203})
        assert.strictEqual(clipped.pages.length, 1)
        const paged: PrintImage = await render(html, {label: {width: 40, height: 30}, dpi: 203, page: {overflow: 'paginate'}})
        assert.strictEqual(paged.pages.length, 3)
        assert.ok(paged.pages.every((page): boolean => page.width === 320 && page.height === 240))
        //A roll of a fixed page length given by width
        const roll: PrintImage = await render(html, {width: 48, dpi: 203, page: {length: 50, overflow: 'paginate'}})
        assert.deepStrictEqual(roll.pages.map((page): number => page.height), [400, 400])
        await assert.rejects(render('<div style="height:3000mm"></div>', {paper: 80}), ThermalContentException)
        await assert.rejects(render('<div style="height:100mm"></div>', {paper: 80, maxLength: 50}), ThermalContentException)
    })

    it('writes the pages as 1-bit PNG', async (): Promise<void> => {
        const image: PrintImage = await render('<div style="width:1mm;height:1mm;background:#000"></div>', {paper: 58})
        const png: Buffer = image.toPNG()
        assert.deepStrictEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        assert.strictEqual(png.readUInt32BE(16), 384)
        assert.strictEqual(png.readUInt32BE(20), 8)
        assert.deepStrictEqual([png[24], png[25]], [1, 0])
        const data: Buffer = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)))
        //The first row: its filter byte, 8 black dots (0 in the PNG), the rest white
        assert.deepStrictEqual([...data.subarray(0, 3)], [0, 0x00, 0xFF])
        assert.throws((): Buffer => image.toPNG(1), ThermalOptionException)
    })

    it('reads the pictures of the page: inline SVG, data: URLs, the files of its base directory only', async (): Promise<void> => {
        const square: string = '<svg width="10" height="10" xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#000"/></svg>'
        const inline: PrintImage = await render(`<div>${square}</div>`, {paper: 58})
        assert.ok(blackIn(inline, 0, 0, 30, 30) > 400)
        const data: PrintImage = await render(`<img src="data:image/svg+xml,${encodeURIComponent(square)}">`, {paper: 58})
        assert.strictEqual(hashOf(data), hashOf(inline))
        const png: string = (await render('<div style="height:5mm;background:#000"></div>', {label: {width: 5, height: 5}, dpi: 203})).toPNG().toString('base64')
        assert.ok(blackIn(await render(`<img style="width:5mm" src="data:image/png;base64,${png}">`, {paper: 58}), 0, 0, 40, 40) > 1000)
        const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-thermal-'))
        try {
            mkdirSync(path.join(directory, 'images'))
            writeFileSync(path.join(directory, 'images', 'square.svg'), square)
            writeFileSync(path.join(directory, 'style.css'), 'div { height: 10mm; background: #000 }')
            assert.ok(blackIn(await render('<img src="images/square.svg">', {paper: 58, baseDir: directory}), 0, 0, 30, 30) > 400)
            assert.strictEqual((await render('<link rel="stylesheet" href="style.css"><div></div>', {paper: 58, baseDir: directory})).height, 80)
            await assert.rejects(render('<img src="images/square.svg">', {paper: 58}), ThermalContentException)
            await assert.rejects(render('<img src="../outside.svg">', {paper: 58, baseDir: path.join(directory, 'images')}), ThermalContentException)
            await assert.rejects(render('<img src="missing.png">', {paper: 58, baseDir: directory}), ThermalContentException)
            await assert.rejects(render('<img src="https://example.com/logo.png">', {paper: 58, baseDir: directory}), ThermalContentException)
            await assert.rejects(render('<img src="data:image/png;base64,AAAA">', {paper: 58}), ThermalContentException)
            await assert.rejects(render(`<img src="qrcode:${'x'.repeat(8000)}">`, {paper: 58}), ThermalContentException)
        } finally {
            rmSync(directory, {recursive: true, force: true})
        }
    })

    it('registers fonts: the generic families and the missing characters fall back to the bundled one', async (): Promise<void> => {
        await assert.rejects(registerFont({family: 'Broken', data: new Uint8Array([1, 2, 3])}), ThermalFontException)
        await assert.rejects(registerFont({family: 'Missing', file: '/nonexistent/font.ttf'}), ThermalFontException)
        await assert.rejects(registerFont({family: 'Both'} as never), ThermalOptionException)
        const regular: Buffer = readFileSync(path.join(FIXTURES, '..', '..', '..', 'vendor', 'noto', 'NotoSansSC-Regular.otf'))
        await registerFont({family: 'Copy', data: regular})
        const html: (family: string) => string = (family: string): string => `<p style="margin:0;font-family:${family};font-weight:bold">Thermal 热敏</p>`
        //A family lacking bold: emboldened, so darker than the regular face
        const bold: number = blackIn(await render(html('Copy'), {paper: 80}), 0, 0, 576, 60)
        const plain: number = blackIn(await render(html('Copy').replace('bold', 'normal'), {paper: 80}), 0, 0, 576, 60)
        assert.ok(bold > plain, `${bold} > ${plain}`)
        assert.strictEqual(hashOf(await render(html('serif'), {paper: 80})), hashOf(await render(html('\'Noto Sans SC\''), {paper: 80})))
        assert.strictEqual(hashOf(await render(html('Unknown, sans-serif'), {paper: 80})), hashOf(await render(html('\'Noto Sans SC\''), {paper: 80})))
    })

    it('is cancelled by its signal before it starts', async (): Promise<void> => {
        const controller: AbortController = new AbortController()
        controller.abort()
        await assert.rejects(render('<p>x</p>', {paper: 58, signal: controller.signal}), ThermalCancelledException)
    })

    it('renders a receipt in a few milliseconds', async (): Promise<void> => {
        const receipt: string = readFileSync(path.join(FIXTURES, 'receipt.html'), 'utf8')
        await render(receipt, {paper: 80})
        const started: number = performance.now()
        for (let i = 0; i < 20; i++) await render(receipt, {paper: 80})
        const each: number = (performance.now() - started) / 20
        assert.ok(each < 20, `${each.toFixed(2)} ms a receipt`)
    })
})

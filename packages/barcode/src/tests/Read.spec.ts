import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {readdirSync, readFileSync} from 'node:fs'
import {Container} from '@lakutata/core'
import {Barcode, BarcodeImageException, type BarcodeResult, type RawImage} from '../exports/Barcode.js'

const FIXTURES: URL = new URL('../../../src/tests/fixtures/', import.meta.url)

/**
 * The CRC-32 of PNG
 * @param bytes
 */
function crc32(bytes: Uint8Array): number {
    let crc: number = 0xFFFFFFFF
    for (const byte of bytes) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
}

/**
 * A chunk of PNG
 * @param type
 * @param data
 */
function pngChunk(type: string, data: Buffer): Buffer {
    const length: Buffer = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body: Buffer = Buffer.concat([Buffer.from(type), data])
    const crc: Buffer = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
}

/**
 * A PNG declaring a size, without its pixels
 * @param width
 * @param height
 */
function pngHeader(width: number, height: number): Buffer {
    const header: Buffer = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header.set([8, 0, 0, 0, 0], 8)
    return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('IDAT', Buffer.alloc(0)), pngChunk('IEND', Buffer.alloc(0))])
}

/**
 * Gray images side by side, on white, of the height of the highest
 * @param images
 */
function sideBySide(...images: RawImage[]): RawImage {
    const width: number = images.reduce((sum: number, image: RawImage): number => sum + image.width, 0)
    const height: number = Math.max(...images.map((image: RawImage): number => image.height))
    const data: Uint8Array = new Uint8Array(width * height).fill(255)
    let left: number = 0
    for (const image of images) {
        for (let y = 0; y < image.height; y++) data.set(image.data.subarray(y * image.width, (y + 1) * image.width), y * width + left)
        left += image.width
    }
    return {data: data, width: width, height: height, channels: 1}
}

describe('The reading of barcodes', (): void => {
    const container: Container = new Container()
    let barcode: Barcode

    before(async (): Promise<void> => {
        barcode = await container.get(Barcode)
    })

    after(async (): Promise<void> => {
        await container.destroy()
    })

    it('reads the images in PNG, JPEG, GIF, BMP, WebP (lossy and lossless) and TGA', async (): Promise<void> => {
        const files: string[] = readdirSync(FIXTURES).filter((file: string): boolean => file.startsWith('qrcode.') || file.startsWith('qrcode-'))
        assert.deepStrictEqual(files.map((file: string): string => file.replace(/^qrcode-?/, '')).sort(), ['.bmp', '.gif', '.jpeg', '.png', '.tga', '.webp', 'lossless.webp'])
        for (const file of files) {
            const results: BarcodeResult[] = await barcode.read(readFileSync(new URL(file, FIXTURES)))
            assert.deepStrictEqual(results.map((result: BarcodeResult): string => `${result.format} ${result.text}`), ['QRCode https://lakutata.com/fixtures'], file)
        }
    })

    it('reads the pixels in gray, RGB and RGBA', async (): Promise<void> => {
        const gray: RawImage = await barcode.generate('DataMatrix', 'lakutata', {output: 'raw'})
        const rgb: Uint8Array = new Uint8Array(gray.data.length * 3)
        const rgba: Uint8Array = new Uint8Array(gray.data.length * 4)
        gray.data.forEach((value: number, index: number): void => {
            rgb.set([value, value, value], index * 3)
            rgba.set([value, value, value, 255], index * 4)
        })
        for (const image of [gray, {...gray, data: rgb, channels: 3 as const}, {...gray, data: rgba, channels: 4 as const}]) {
            assert.strictEqual((await barcode.read(image))[0]?.text, 'lakutata', `${image.channels} channels`)
        }
    })

    it('gives the position of every code of the image, at most as many as asked', async (): Promise<void> => {
        const image: RawImage = sideBySide(await barcode.generate('QRCode', 'first', {output: 'raw'}), await barcode.generate('QRCode', 'second', {output: 'raw'}))
        const results: BarcodeResult[] = (await barcode.read(image)).sort((a: BarcodeResult, b: BarcodeResult): number => a.position.topLeft.x - b.position.topLeft.x)
        assert.deepStrictEqual(results.map((result: BarcodeResult): string => result.text), ['first', 'second'])
        assert.ok(results[0].position.topRight.x < results[1].position.topLeft.x)
        assert.strictEqual((await barcode.read(image, {maxSymbols: 1})).length, 1)
    })

    it('looks for the formats asked for only', async (): Promise<void> => {
        const image: RawImage = sideBySide(await barcode.generate('QRCode', 'lakutata', {output: 'raw'}), await barcode.generate('EAN13', '590123412345', {output: 'raw'}))
        assert.deepStrictEqual((await barcode.read(image)).map((result: BarcodeResult): string => result.format).sort(), ['EAN13', 'QRCode'])
        assert.deepStrictEqual((await barcode.read(image, {formats: ['EAN13']})).map((result: BarcodeResult): string => result.format), ['EAN13'])
        //A UPC-A is an EAN-13 starting with 0: read as a UPC-A when it is asked for without EAN-13
        const upc: RawImage = await barcode.generate('UPCA', '01234567890', {output: 'raw'})
        assert.strictEqual((await barcode.read(upc))[0].format, 'EAN13')
        assert.strictEqual((await barcode.read(upc, {formats: ['UPCA']}))[0].format, 'UPCA')
    })

    it('reads the codes in light on dark, unless told not to', async (): Promise<void> => {
        const image: RawImage = await barcode.generate('QRCode', 'lakutata', {output: 'raw'})
        const inverted: RawImage = {...image, data: image.data.map((value: number): number => 255 - value)}
        const [result] = await barcode.read(inverted)
        assert.strictEqual(result.text, 'lakutata')
        assert.strictEqual(result.inverted, true)
        assert.deepStrictEqual(await barcode.read(inverted, {tryInvert: false}), [])
    })

    it('gives no code for an image without one', async (): Promise<void> => {
        assert.deepStrictEqual(await barcode.read({data: new Uint8Array(200 * 100).fill(255), width: 200, height: 100, channels: 1}), [])
        let seed: number = 7
        const noise: Uint8Array = Uint8Array.from({length: 300 * 300}, (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) % 256)
        assert.deepStrictEqual(await barcode.read({data: noise, width: 300, height: 300, channels: 1}), [])
    })

    it('refuses the pixels that are not width × height × channels bytes', async (): Promise<void> => {
        await assert.rejects(barcode.read({data: new Uint8Array(99), width: 10, height: 10, channels: 1}), BarcodeImageException)
        await assert.rejects(barcode.read({data: new Uint8Array(300), width: 10, height: 10, channels: 4}), BarcodeImageException)
    })

    it('refuses the images it cannot decode, and the ones of more than 50 million pixels before decoding them', async (): Promise<void> => {
        const png: Buffer = readFileSync(new URL('qrcode.png', FIXTURES))
        for (const image of [Buffer.alloc(0), Buffer.from('not an image'), png.subarray(0, png.length / 2)]) {
            await assert.rejects(barcode.read(image), BarcodeImageException)
        }
        await assert.rejects(barcode.read(pngHeader(60000, 60000)), (error: unknown): boolean => error instanceof BarcodeImageException && /50000000 pixels/.test(error.message))
        await assert.rejects(barcode.read({data: new Uint8Array(1), width: 10000, height: 10000, channels: 1}), BarcodeImageException)
    })

    it('reads a damaged image or refuses it, without failing otherwise', async (): Promise<void> => {
        let seed: number = 99
        const random = (limit: number): number => (seed = (seed * 1103515245 + 12345) % 2147483648) % limit
        for (const file of ['qrcode.png', 'qrcode.jpeg', 'qrcode.gif', 'qrcode.bmp', 'qrcode.webp', 'qrcode.tga']) {
            const original: Buffer = readFileSync(new URL(file, FIXTURES))
            for (let i = 0; i < 40; i++) {
                const damaged: Buffer = Buffer.from(original)
                for (let j = 0, changes = 1 + random(8); j < changes; j++) damaged[random(damaged.length)] = random(256)
                try {
                    const results: BarcodeResult[] = await barcode.read(damaged)
                    assert.ok(Array.isArray(results))
                } catch (error) {
                    assert.ok(error instanceof BarcodeImageException, `${file}: ${error}`)
                }
            }
        }
    })
})

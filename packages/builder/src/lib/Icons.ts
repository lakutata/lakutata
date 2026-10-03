import {existsSync, readFileSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {deflateSync, inflateSync} from 'node:zlib'

/**
 * An image: its pixels, red, green, blue and alpha (8 bits each), by rows
 */
export type Image = {
    width: number
    height: number
    pixels: Buffer
}

/**
 * The signature of the PNG files
 */
const PNG_SIGNATURE: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * The table of the CRC-32 of the chunks of PNG
 */
const CRC_TABLE: Uint32Array = ((): Uint32Array => {
    const table: Uint32Array = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c: number = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
    }
    return table
})()

/**
 * The CRC-32 of a chunk of PNG (its type and its data)
 * @param data
 */
function Crc32(data: Buffer): number {
    let crc: number = 0xffffffff
    for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}

/**
 * The predictor of Paeth (the filter 4 of PNG)
 * @param a the byte on the left
 * @param b the byte above
 * @param c the byte above on the left
 */
function Paeth(a: number, b: number, c: number): number {
    const p: number = a + b - c
    const pa: number = Math.abs(p - a), pb: number = Math.abs(p - b), pc: number = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * Decode a PNG file (not interlaced): its pixels in RGBA, whatever its colors (gray, RGB, palette, with alpha) and its
 * depth (1 to 16 bits)
 * @param data
 * @param file its name, in the errors
 */
export function DecodePng(data: Buffer, file: string = 'the image'): Image {
    if (data.length < 8 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${file} is not a PNG image`)
    let offset: number = 8
    let width: number = 0, height: number = 0, depth: number = 0, type: number = 0, interlace: number = 0
    let palette: Buffer | undefined
    let transparency: Buffer | undefined
    const compressed: Buffer[] = []
    while (offset + 8 <= data.length) {
        const length: number = data.readUInt32BE(offset)
        const name: string = data.toString('latin1', offset + 4, offset + 8)
        const chunk: Buffer = data.subarray(offset + 8, offset + 8 + length)
        offset += 12 + length
        if (name === 'IHDR') {
            width = chunk.readUInt32BE(0)
            height = chunk.readUInt32BE(4)
            depth = chunk[8]
            type = chunk[9]
            interlace = chunk[12]
        } else if (name === 'PLTE') palette = chunk
        else if (name === 'tRNS') transparency = chunk
        else if (name === 'IDAT') compressed.push(chunk)
        else if (name === 'IEND') break
    }
    if (!width || !height) throw new Error(`${file} has no header (IHDR)`)
    if (interlace) throw new Error(`${file} is interlaced: save it without interlacing`)
    const channels: number = ({0: 1, 2: 3, 3: 1, 4: 2, 6: 4} as Record<number, number>)[type]
    if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new Error(`${file} has colors this tool does not read (type ${type}, ${depth} bits)`)
    if (type === 3 && !palette) throw new Error(`${file} has no palette (PLTE)`)
    const raw: Buffer = inflateSync(Buffer.concat(compressed))
    const bitsPerPixel: number = channels * depth
    const stride: number = Math.ceil(width * bitsPerPixel / 8)
    //The distance of the byte on the left: one pixel, at least one byte
    const left: number = Math.max(1, bitsPerPixel >> 3)
    const rows: Buffer = Buffer.alloc(stride * height)
    for (let y = 0; y < height; y++) {
        const filter: number = raw[y * (stride + 1)]
        const source: Buffer = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
        const row: Buffer = rows.subarray(y * stride, (y + 1) * stride)
        const above: Buffer | undefined = y ? rows.subarray((y - 1) * stride, y * stride) : undefined
        for (let x = 0; x < stride; x++) {
            const a: number = x >= left ? row[x - left] : 0
            const b: number = above ? above[x] : 0
            const c: number = above && x >= left ? above[x - left] : 0
            const predicted: number = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? Paeth(a, b, c) : -1
            if (predicted < 0) throw new Error(`${file} has an unknown filter (${filter})`)
            row[x] = (source[x] + predicted) & 0xff
        }
    }
    //A sample of a pixel, as it is written, and scaled to 8 bits
    const value = (row: Buffer, index: number): number => {
        if (depth === 8) return row[index]
        if (depth === 16) return row.readUInt16BE(index * 2)
        return row[(index * depth) >> 3] >> (8 - depth - ((index * depth) & 7)) & ((1 << depth) - 1)
    }
    const sample = (row: Buffer, index: number): number => {
        if (depth === 8 || type === 3) return value(row, index)
        if (depth === 16) return row[index * 2]
        return Math.round(value(row, index) * 255 / ((1 << depth) - 1))
    }
    //The color made transparent by tRNS, of the gray and RGB images
    const key = (index: number): number => transparency && transparency.length >= (index + 1) * 2 ? transparency.readUInt16BE(index * 2) : -1
    const pixels: Buffer = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) {
        const row: Buffer = rows.subarray(y * stride, (y + 1) * stride)
        for (let x = 0; x < width; x++) {
            const target: number = (y * width + x) * 4
            const raw16 = (channel: number): number => value(row, x * channels + channel)
            if (type === 3) {
                const index: number = sample(row, x)
                palette!.copy(pixels, target, index * 3, index * 3 + 3)
                pixels[target + 3] = transparency && index < transparency.length ? transparency[index] : 255
            } else if (type === 0 || type === 4) {
                const gray: number = sample(row, x * channels)
                pixels[target] = pixels[target + 1] = pixels[target + 2] = gray
                pixels[target + 3] = type === 4 ? sample(row, x * channels + 1) : raw16(0) === key(0) ? 0 : 255
            } else {
                for (let channel = 0; channel < 3; channel++) pixels[target + channel] = sample(row, x * channels + channel)
                pixels[target + 3] = type === 6 ? sample(row, x * channels + 3) : raw16(0) === key(0) && raw16(1) === key(1) && raw16(2) === key(2) ? 0 : 255
            }
        }
    }
    return {width: width, height: height, pixels: pixels}
}

/**
 * Encode an image into a PNG file (RGBA, 8 bits)
 * @param image
 */
export function EncodePng(image: Image): Buffer {
    const chunk = (name: string, data: Buffer): Buffer => {
        const typed: Buffer = Buffer.concat([Buffer.from(name, 'latin1'), data])
        const length: Buffer = Buffer.alloc(4)
        length.writeUInt32BE(data.length)
        const crc: Buffer = Buffer.alloc(4)
        crc.writeUInt32BE(Crc32(typed))
        return Buffer.concat([length, typed, crc])
    }
    const header: Buffer = Buffer.alloc(13)
    header.writeUInt32BE(image.width, 0)
    header.writeUInt32BE(image.height, 4)
    header[8] = 8
    header[9] = 6
    const stride: number = image.width * 4
    const raw: Buffer = Buffer.alloc((stride + 1) * image.height)
    for (let y = 0; y < image.height; y++) {
        //The filter Sub (1): the icons compress better
        raw[y * (stride + 1)] = 1
        for (let x = 0; x < stride; x++) {
            const value: number = image.pixels[y * stride + x]
            raw[y * (stride + 1) + 1 + x] = (value - (x >= 4 ? image.pixels[y * stride + x - 4] : 0)) & 0xff
        }
    }
    return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))])
}

/**
 * Resize an image (a square into a square): each pixel the average of the ones it covers, weighted by their alpha
 * (premultiplied, the transparent edges keep their colors)
 * @param image
 * @param size
 */
export function Resize(image: Image, size: number): Image {
    if (image.width === size && image.height === size) return image
    //Separable: the columns, then the rows
    const pass = (source: Float64Array, width: number, height: number, target: number, horizontal: boolean): Float64Array => {
        const length: number = horizontal ? width : height
        const scale: number = length / target
        const output: Float64Array = new Float64Array((horizontal ? target * height : width * target) * 4)
        for (let i = 0; i < target; i++) {
            const start: number = i * scale, end: number = (i + 1) * scale
            //The weights of the source pixels the target pixel covers
            const weights: [number, number][] = []
            for (let j = Math.floor(start); j < Math.min(length, Math.ceil(end)); j++) {
                const weight: number = Math.min(end, j + 1) - Math.max(start, j)
                if (weight > 0) weights.push([j, weight])
            }
            const total: number = weights.reduce((sum: number, [, weight]: [number, number]): number => sum + weight, 0)
            for (let k = 0; k < (horizontal ? height : width); k++) {
                for (let channel = 0; channel < 4; channel++) {
                    let sum: number = 0
                    for (const [j, weight] of weights) sum += source[((horizontal ? k * width + j : j * width + k) * 4) + channel] * weight
                    output[((horizontal ? k * target + i : i * width + k) * 4) + channel] = sum / total
                }
            }
        }
        return output
    }
    const premultiplied: Float64Array = new Float64Array(image.width * image.height * 4)
    for (let i = 0; i < image.width * image.height; i++) {
        const alpha: number = image.pixels[i * 4 + 3] / 255
        for (let channel = 0; channel < 3; channel++) premultiplied[i * 4 + channel] = image.pixels[i * 4 + channel] * alpha
        premultiplied[i * 4 + 3] = image.pixels[i * 4 + 3]
    }
    const resized: Float64Array = pass(pass(premultiplied, image.width, image.height, size, true), size, image.height, size, false)
    const pixels: Buffer = Buffer.alloc(size * size * 4)
    for (let i = 0; i < size * size; i++) {
        const alpha: number = resized[i * 4 + 3]
        for (let channel = 0; channel < 3; channel++) pixels[i * 4 + channel] = alpha > 0 ? Math.min(255, Math.round(resized[i * 4 + channel] * 255 / alpha)) : 0
        pixels[i * 4 + 3] = Math.min(255, Math.round(alpha))
    }
    return {width: size, height: size, pixels: pixels}
}

/**
 * The sizes of the icons of Windows (ico)
 */
export const ICO_SIZES: number[] = [16, 20, 24, 32, 40, 48, 64, 128, 256]

/**
 * The icon of Windows (ico) of an image, in its sizes: the bitmaps of the ones smaller than 256 (the format every tool
 * reads: the resources of the executables, NSIS, Windows Installer), the PNG of 256
 * @param image
 */
export function IcoFile(image: Image): Buffer {
    const images: Buffer[] = ICO_SIZES.map((size: number): Buffer => {
        const resized: Image = Resize(image, size)
        if (size >= 256) return EncodePng(resized)
        //BITMAPINFOHEADER, its height the one of the colors and of the mask; the rows from the bottom, BGRA, then the mask
        const header: Buffer = Buffer.alloc(40)
        header.writeUInt32LE(40, 0)
        header.writeInt32LE(size, 4)
        header.writeInt32LE(size * 2, 8)
        header.writeUInt16LE(1, 12)
        header.writeUInt16LE(32, 14)
        const colors: Buffer = Buffer.alloc(size * size * 4)
        const maskStride: number = Math.ceil(size / 32) * 4
        const mask: Buffer = Buffer.alloc(maskStride * size)
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const from: number = (y * size + x) * 4
                const to: number = ((size - 1 - y) * size + x) * 4
                colors[to] = resized.pixels[from + 2]
                colors[to + 1] = resized.pixels[from + 1]
                colors[to + 2] = resized.pixels[from]
                colors[to + 3] = resized.pixels[from + 3]
                if (!resized.pixels[from + 3]) mask[(size - 1 - y) * maskStride + (x >> 3)] |= 0x80 >> (x & 7)
            }
        }
        return Buffer.concat([header, colors, mask])
    })
    const directory: Buffer = Buffer.alloc(6 + 16 * images.length)
    directory.writeUInt16LE(1, 2)
    directory.writeUInt16LE(images.length, 4)
    let offset: number = directory.length
    images.forEach((data: Buffer, index: number): void => {
        const entry: number = 6 + index * 16
        const size: number = ICO_SIZES[index]
        directory[entry] = size >= 256 ? 0 : size
        directory[entry + 1] = size >= 256 ? 0 : size
        directory.writeUInt16LE(1, entry + 4)
        directory.writeUInt16LE(32, entry + 6)
        directory.writeUInt32LE(data.length, entry + 8)
        directory.writeUInt32LE(offset, entry + 12)
        offset += data.length
    })
    return Buffer.concat([directory, ...images])
}

/**
 * The types of the icons of macOS (icns) of PNG, by their sizes in pixels (the Retina ones are the doubles of the others)
 */
const ICNS_TYPES: [string, number][] = [['icp4', 16], ['icp5', 32], ['ic11', 32], ['icp6', 64], ['ic12', 64], ['ic07', 128], ['ic08', 256], ['ic13', 256], ['ic09', 512], ['ic14', 512], ['ic10', 1024]]

/**
 * The icon of macOS (icns) of an image: its PNG in the sizes of macOS, but the ones larger than it
 * @param image
 */
export function IcnsFile(image: Image): Buffer {
    const encoded: Map<number, Buffer> = new Map()
    const entries: Buffer[] = []
    for (const [type, size] of ICNS_TYPES) {
        if (size > image.width) continue
        if (!encoded.has(size)) encoded.set(size, EncodePng(Resize(image, size)))
        const data: Buffer = encoded.get(size)!
        const header: Buffer = Buffer.alloc(8)
        header.write(type, 0, 'latin1')
        header.writeUInt32BE(data.length + 8, 4)
        entries.push(header, data)
    }
    const header: Buffer = Buffer.alloc(8)
    header.write('icns', 0, 'latin1')
    header.writeUInt32BE(8 + entries.reduce((sum: number, entry: Buffer): number => sum + entry.length, 0), 4)
    return Buffer.concat([header, ...entries])
}

/**
 * The sizes of the icons of Linux (the hicolor theme)
 */
export const LINUX_SIZES: number[] = [16, 24, 32, 48, 64, 128, 256, 512]

/**
 * Write the icons of Linux of an image into a directory: its PNG in the sizes of the hicolor theme (<size>x<size>.png),
 * but the ones larger than it
 * @param image
 * @param directory
 */
export async function WriteLinuxIcons(image: Image, directory: string): Promise<string[]> {
    await mkdir(directory, {recursive: true})
    const files: string[] = []
    for (const size of LINUX_SIZES.filter((size: number): boolean => size <= image.width)) {
        const file: string = path.join(directory, `${size}x${size}.png`)
        await writeFile(file, EncodePng(Resize(image, size)))
        files.push(file)
    }
    return files
}

/**
 * Give an executable of Windows the icon (ico), as its icon groups (the one of node.exe), its signature removed (it does
 * not match it anymore)
 * @param file
 * @param ico
 */
export async function SetExecutableIcon(file: string, ico: Buffer): Promise<void> {
    const {NtExecutable, NtExecutableResource, Data, Resource} = await import('resedit')
    const executable = NtExecutable.from(await readFile(file), {ignoreCert: true})
    const resource = NtExecutableResource.from(executable)
    const icons = Data.IconFile.from(ico).icons.map((item): typeof item.data => item.data)
    const groups = Resource.IconGroupEntry.fromEntries(resource.entries)
    for (const {id, lang} of groups.length ? groups : [{id: 1, lang: 1033}]) Resource.IconGroupEntry.replaceIconsForResource(resource.entries, id, lang, icons)
    resource.outputResource(executable)
    await writeFile(file, Buffer.from(executable.generate()))
}

/**
 * The icon of the application (lakutata.icon of its package.json): a square PNG image, 256 pixels at least (1024 for
 * the Retina screens of macOS), undefined without icon
 * @param project
 * @param manifest
 */
export function ApplicationIcon(project: string, manifest: Record<string, any>): { file: string, image: Image } | undefined {
    const declared: unknown = manifest.lakutata?.icon
    if (declared === undefined) return undefined
    if (typeof declared !== 'string' || !declared) throw new Error('The icon of the application (lakutata.icon of its package.json) must be a PNG image of the project')
    const file: string = path.resolve(project, declared)
    if (!existsSync(file)) throw new Error(`The icon of the application ${declared} (lakutata.icon) does not exist`)
    const image: Image = DecodePng(readFileSync(file), declared)
    if (image.width !== image.height) throw new Error(`The icon of the application ${declared} must be square (it is ${image.width}x${image.height})`)
    if (image.width < 256) throw new Error(`The icon of the application ${declared} must be 256 pixels at least (it is ${image.width}): its icons are made from it`)
    return {file: file, image: image}
}

//Decoders of the printer commands for the tests: the bytes the encoders write read back into pages of dots (rows of
//bits, 1 black), and the other commands they hold
import assert from 'node:assert'

export interface DecodedPage {
    width: number
    height: number
    rows: Buffer
}

export interface EscPosDecoded {
    initialized: boolean
    //The vertical motion unit set by GS P (dots per inch), 0 when not set
    motionUnit: number
    pages: DecodedPage[]
    //The feeds in motion units, by page
    feeds: number[]
    cuts: ('full' | 'partial')[]
    drawer?: {pin: number, on: number, off: number}
}

/**
 * ESC/POS: the raster commands (GS v 0, GS ( L fn 112 and 50, ESC * 33 in 24-dot bands) joined into pages; a cut ends a
 * page
 */
export function decodeEscPos(bytes: Buffer): EscPosDecoded {
    const result: EscPosDecoded = {initialized: false, motionUnit: 0, pages: [], feeds: [], cuts: []}
    let width: number = 0
    let rows: Buffer[] = []
    let feed: number = 0
    let pending: DecodedPage | undefined
    const endPage = (): void => {
        if (!rows.length) return
        const data: Buffer = Buffer.concat(rows)
        result.pages.push({width, height: data.length / ((width + 7) >> 3), rows: data})
        result.feeds.push(feed)
        rows = []
        feed = 0
    }
    let i: number = 0
    while (i < bytes.length) {
        const byte: number = bytes[i]!
        if (byte === 0x1B && bytes[i + 1] === 0x40) {
            result.initialized = true
            i += 2
        } else if (byte === 0x1D && bytes[i + 1] === 0x50) {
            result.motionUnit = bytes[i + 3]!
            i += 4
        } else if (byte === 0x1D && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30) {
            assert.strictEqual(bytes[i + 3], 0, 'GS v 0 at its normal size')
            const perRow: number = bytes[i + 4]! | bytes[i + 5]! << 8
            const count: number = bytes[i + 6]! | bytes[i + 7]! << 8
            width = width || perRow * 8
            rows.push(bytes.subarray(i + 8, i + 8 + perRow * count))
            i += 8 + perRow * count
        } else if (byte === 0x1D && bytes[i + 1] === 0x28 && bytes[i + 2] === 0x4C) {
            const length: number = bytes[i + 3]! | bytes[i + 4]! << 8
            const fn: number = bytes[i + 6]!
            if (fn === 0x70) {
                assert.deepStrictEqual([...bytes.subarray(i + 5, i + 11)], [0x30, 0x70, 0x30, 0x01, 0x01, 0x31], 'GS ( L fn 112, monochrome, single size')
                const dots: number = bytes[i + 11]! | bytes[i + 12]! << 8
                const count: number = bytes[i + 13]! | bytes[i + 14]! << 8
                assert.strictEqual(length, 10 + ((dots + 7) >> 3) * count)
                width = dots
                pending = {width: dots, height: count, rows: bytes.subarray(i + 15, i + 5 + length)}
            } else {
                assert.strictEqual(fn, 0x32, 'GS ( L fn 50 prints the graphics stored')
                assert.ok(pending, 'GS ( L fn 50 after fn 112')
                rows.push(pending!.rows)
                pending = undefined
            }
            i += 5 + length
        } else if (byte === 0x1B && bytes[i + 1] === 0x33) {
            assert.strictEqual(bytes[i + 2], 24, 'ESC 3 24 before ESC * 33')
            i += 3
        } else if (byte === 0x1B && bytes[i + 1] === 0x2A) {
            assert.strictEqual(bytes[i + 2], 33, 'ESC * 33')
            const columns: number = bytes[i + 3]! | bytes[i + 4]! << 8
            width = columns
            const perRow: number = (columns + 7) >> 3
            const band: Buffer = Buffer.alloc(perRow * 24)
            for (let x = 0; x < columns; x++) {
                for (let y = 0; y < 24; y++) {
                    if (bytes[i + 5 + x * 3 + (y >> 3)]! & (0x80 >> (y & 7))) band[y * perRow + (x >> 3)]! |= 0x80 >> (x & 7)
                }
            }
            rows.push(band)
            assert.strictEqual(bytes[i + 5 + columns * 3], 0x0A, 'a line feed after each band')
            i += 6 + columns * 3
        } else if (byte === 0x1B && bytes[i + 1] === 0x32) {
            i += 2
        } else if (byte === 0x1B && bytes[i + 1] === 0x4A) {
            feed += bytes[i + 2]!
            i += 3
        } else if (byte === 0x1D && bytes[i + 1] === 0x56) {
            result.cuts.push(bytes[i + 2] === 0x41 ? 'full' : 'partial')
            assert.ok([0x41, 0x42].includes(bytes[i + 2]!) && bytes[i + 3] === 0, 'GS V 65/66 0')
            endPage()
            i += 4
        } else if (byte === 0x1B && bytes[i + 1] === 0x70) {
            result.drawer = {pin: bytes[i + 2] === 0 ? 2 : 5, on: bytes[i + 3]! * 2, off: bytes[i + 4]! * 2}
            i += 5
        } else {
            assert.fail(`An unknown ESC/POS command at byte ${i}: ${byte.toString(16)}`)
        }
    }
    endPage()
    return result
}

/**
 * The ESC * pages trimmed to a height (their last band filled to 24 rows)
 */
export function trimmed(page: DecodedPage, height: number): DecodedPage {
    return {width: page.width, height, rows: page.rows.subarray(0, ((page.width + 7) >> 3) * height)}
}

export interface TsplDecoded {
    commands: string[]
    pages: DecodedPage[]
}

/**
 * TSPL: its lines, each BITMAP a page (its data inverted back: 1 is white in TSPL)
 */
export function decodeTspl(bytes: Buffer): TsplDecoded {
    const result: TsplDecoded = {commands: [], pages: []}
    let i: number = 0
    while (i < bytes.length) {
        const end: number = bytes.indexOf('\r\n', i, 'latin1')
        const line: string = bytes.subarray(i, end < 0 ? bytes.length : end).toString('latin1')
        if (line.startsWith('BITMAP ')) {
            const header: RegExpExecArray = /^BITMAP (\d+),(\d+),(\d+),(\d+),(\d+),/.exec(line)!
            assert.ok(header, 'BITMAP x,y,width,height,mode,')
            const perRow: number = Number(header[3])
            const height: number = Number(header[4])
            const start: number = i + header[0].length
            const data: Buffer = Buffer.from(bytes.subarray(start, start + perRow * height))
            for (let j = 0; j < data.length; j++) data[j] = ~data[j]! & 0xFF
            result.pages.push({width: perRow * 8, height, rows: data})
            result.commands.push(header[0].slice(0, -1))
            i = start + perRow * height
            assert.strictEqual(bytes.subarray(i, i + 2).toString('latin1'), '\r\n')
            i += 2
            continue
        }
        result.commands.push(line)
        i = end < 0 ? bytes.length : end + 2
    }
    return result
}

/**
 * ZPL: each ^XA…^XZ a page, its ^GFA field expanded (hexadecimal, and the ASCII compression: G–Y and g–z counts, ",",
 * "!" and ":")
 */
export function decodeZpl(bytes: Buffer): {pages: (DecodedPage & {labelWidth: number, labelLength: number})[], commands: string[]} {
    const text: string = bytes.toString('latin1')
    const pages: (DecodedPage & {labelWidth: number, labelLength: number})[] = []
    const commands: string[] = []
    for (const label of text.matchAll(/\^XA([\s\S]*?)\^XZ/g)) {
        const body: string = label[1]!
        commands.push(body.replace(/\^GFA,[^^]*/, '^GFA'))
        const graphic: RegExpExecArray = /\^GFA,(\d+),(\d+),(\d+),([^^]*)/.exec(body)!
        assert.ok(graphic, 'a ^GFA field')
        const total: number = Number(graphic[1])
        const perRow: number = Number(graphic[3])
        const digits: number = perRow * 2
        const data: string = graphic[4]!
        const rows: string[] = []
        let row: string = ''
        let count: number = 0
        for (const c of data) {
            if (c >= 'G' && c <= 'Y') count += c.charCodeAt(0) - 0x46
            else if (c >= 'g' && c <= 'z') count += (c.charCodeAt(0) - 0x66) * 20
            else if (c === ',') row = row.padEnd(digits, '0')
            else if (c === '!') row = row.padEnd(digits, 'F')
            else if (c === ':') row = rows[rows.length - 1]!
            else if (/[0-9A-F]/.test(c)) {
                row += c.repeat(count || 1)
                count = 0
            } else assert.fail(`An unknown character of ^GF data: ${c}`)
            if (row.length >= digits) {
                assert.strictEqual(row.length, digits, 'a row of the ^GF data ends at its width')
                rows.push(row)
                row = ''
            }
        }
        const buffer: Buffer = Buffer.from(rows.join(''), 'hex')
        assert.strictEqual(buffer.length, total, 'the ^GF data is its total')
        pages.push({width: perRow * 8, height: rows.length, rows: buffer, labelWidth: Number(/\^PW(\d+)/.exec(body)![1]), labelLength: Number(/\^LL(\d+)/.exec(body)![1])})
    }
    return {pages, commands}
}

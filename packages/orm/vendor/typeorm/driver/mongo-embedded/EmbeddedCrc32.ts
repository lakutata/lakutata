import * as zlib from "zlib"

/**
 * lakutata: the table of the CRC-32 of zlib (ISO-HDLC, the reflected polynomial 0xedb88320), made at its first use.
 */
let table: Uint32Array | undefined

/**
 * lakutata: the CRC-32 of zlib computed with a table, for the versions of Node.js without zlib.crc32 (before 22.2 and
 * 20.15: Node.js 18 and 19 of NW.js and of the phones). It gives what zlib.crc32 gives.
 *
 * @param data The bytes.
 * @param value The CRC-32 of the bytes before them, to continue it.
 */
export function tableCrc32(data: Uint8Array, value: number = 0): number {
    if (!table) {
        table = new Uint32Array(256)
        for (let n = 0; n < 256; n++) {
            let c = n
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
            table[n] = c >>> 0
        }
    }
    let crc = (value ^ 0xffffffff) >>> 0
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}

/**
 * lakutata: zlib.crc32 where Node.js has it, up to about 20 times faster than the table on large inputs.
 */
const native = (zlib as { crc32?: (data: Uint8Array, value?: number) => number }).crc32

/**
 * lakutata: the CRC-32 of zlib of the bytes, continuing a value: zlib.crc32 where Node.js has it, else the table.
 *
 * @param data The bytes.
 * @param value The CRC-32 of the bytes before them, to continue it.
 */
export const crc32: (data: Uint8Array, value?: number) => number =
    typeof native === "function" ? native : tableCrc32

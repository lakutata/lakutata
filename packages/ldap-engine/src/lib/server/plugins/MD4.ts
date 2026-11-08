/**
 * Rotate a 32-bit word to the left
 * @param value The word.
 * @param bits The bits.
 */
function rotate(value: number, bits: number): number {
    return (value << bits) | (value >>> (32 - bits))
}

/**
 * MD4 (RFC 1320), for the NT hash of Samba: node:crypto has it only with the legacy provider of OpenSSL 3, which Bun
 * and Electron do not have either
 * @param data The bytes.
 */
export function md4(data: Buffer): Buffer {
    const length: number = data.length
    const padded: Buffer = Buffer.alloc(((length + 8) >> 6) * 64 + 64)
    data.copy(padded)
    padded[length] = 0x80
    //The length in bits, little-endian
    padded.writeUInt32LE((length * 8) >>> 0, padded.length - 8)
    padded.writeUInt32LE(Math.floor(length / 0x20000000), padded.length - 4)
    let a: number = 0x67452301
    let b: number = 0xefcdab89
    let c: number = 0x98badcfe
    let d: number = 0x10325476
    const x: number[] = new Array(16)
    const f = (u: number, v: number, w: number): number => (u & v) | (~u & w)
    const g = (u: number, v: number, w: number): number => (u & v) | (u & w) | (v & w)
    const h = (u: number, v: number, w: number): number => u ^ v ^ w
    for (let offset: number = 0; offset < padded.length; offset += 64) {
        for (let index: number = 0; index < 16; index++) x[index] = padded.readUInt32LE(offset + index * 4)
        const [aa, bb, cc, dd] = [a, b, c, d]
        //Round 1
        for (const k of [0, 4, 8, 12]) {
            a = rotate((a + f(b, c, d) + x[k]) | 0, 3)
            d = rotate((d + f(a, b, c) + x[k + 1]) | 0, 7)
            c = rotate((c + f(d, a, b) + x[k + 2]) | 0, 11)
            b = rotate((b + f(c, d, a) + x[k + 3]) | 0, 19)
        }
        //Round 2
        for (const k of [0, 1, 2, 3]) {
            a = rotate((a + g(b, c, d) + x[k] + 0x5a827999) | 0, 3)
            d = rotate((d + g(a, b, c) + x[k + 4] + 0x5a827999) | 0, 5)
            c = rotate((c + g(d, a, b) + x[k + 8] + 0x5a827999) | 0, 9)
            b = rotate((b + g(c, d, a) + x[k + 12] + 0x5a827999) | 0, 13)
        }
        //Round 3
        for (const k of [0, 2, 1, 3]) {
            a = rotate((a + h(b, c, d) + x[k] + 0x6ed9eba1) | 0, 3)
            d = rotate((d + h(a, b, c) + x[k + 8] + 0x6ed9eba1) | 0, 9)
            c = rotate((c + h(d, a, b) + x[k + 4] + 0x6ed9eba1) | 0, 11)
            b = rotate((b + h(c, d, a) + x[k + 12] + 0x6ed9eba1) | 0, 15)
        }
        a = (a + aa) | 0
        b = (b + bb) | 0
        c = (c + cc) | 0
        d = (d + dd) | 0
    }
    const digest: Buffer = Buffer.alloc(16)
    digest.writeInt32LE(a, 0)
    digest.writeInt32LE(b, 4)
    digest.writeInt32LE(c, 8)
    digest.writeInt32LE(d, 12)
    return digest
}

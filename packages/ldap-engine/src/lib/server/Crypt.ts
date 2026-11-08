import {createHash, type Hash} from 'node:crypto'

//The alphabet of crypt(3)
const ITOA64: string = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Three bytes as the characters of crypt(3), the low bits first
 * @param high The first byte.
 * @param middle The second byte.
 * @param low The third byte.
 * @param count How many characters.
 */
function to64(high: number, middle: number, low: number, count: number): string {
    let value: number = (high << 16) | (middle << 8) | low
    let text: string = ''
    for (let index: number = 0; index < count; index++) {
        text += ITOA64[value & 0x3f]
        value >>>= 6
    }
    return text
}

/**
 * The MD5-based crypt of FreeBSD (`$1$`), as Poul-Henning Kamp wrote it
 * @param password The password.
 * @param setting The hash or its start (`$1$salt`).
 * @returns The hash, undefined when the setting is not one.
 */
export function md5Crypt(password: Buffer, setting: string): string | undefined {
    const match: RegExpExecArray | null = /^\$1\$([^$]{0,8})/.exec(setting)
    if (!match) return undefined
    const salt: Buffer = Buffer.from(match[1], 'latin1')
    const alternate: Buffer = createHash('md5').update(password).update(salt).update(password).digest()
    const context: Hash = createHash('md5').update(password).update('$1$').update(salt)
    for (let left: number = password.length; left > 0; left -= 16) context.update(alternate.subarray(0, Math.min(16, left)))
    for (let bits: number = password.length; bits; bits >>>= 1) context.update(bits & 1 ? Buffer.alloc(1) : password.subarray(0, 1))
    let digest: Buffer = context.digest()
    for (let round: number = 0; round < 1000; round++) {
        const step: Hash = createHash('md5')
        step.update(round & 1 ? password : digest)
        if (round % 3) step.update(salt)
        if (round % 7) step.update(password)
        step.update(round & 1 ? digest : password)
        digest = step.digest()
    }
    const d: Buffer = digest
    return `$1$${match[1]}$${to64(d[0], d[6], d[12], 4)}${to64(d[1], d[7], d[13], 4)}${to64(d[2], d[8], d[14], 4)}${to64(d[3], d[9], d[15], 4)}${to64(d[4], d[10], d[5], 4)}${to64(0, 0, d[11], 2)}`
}

//The order the bytes of the SHA-256 and SHA-512 crypts are written in, three at a time
const SHA256_ORDER: number[][] = [[0, 10, 20], [21, 1, 11], [12, 22, 2], [3, 13, 23], [24, 4, 14], [15, 25, 5], [6, 16, 26], [27, 7, 17], [18, 28, 8], [9, 19, 29]]
const SHA512_ORDER: number[][] = [[0, 21, 42], [22, 43, 1], [44, 2, 23], [3, 24, 45], [25, 46, 4], [47, 5, 26], [6, 27, 48], [28, 49, 7], [50, 8, 29], [9, 30, 51], [31, 52, 10], [53, 11, 32], [12, 33, 54], [34, 55, 13], [56, 14, 35], [15, 36, 57], [37, 58, 16], [59, 17, 38], [18, 39, 60], [40, 61, 19], [62, 20, 41]]

/**
 * Bytes repeated to a length, from the digest of their repetition (the P and S sequences of the specification)
 * @param digest The digest.
 * @param length The length.
 */
function repeated(digest: Buffer, length: number): Buffer {
    const result: Buffer = Buffer.alloc(length)
    for (let offset: number = 0; offset < length; offset += digest.length) digest.copy(result, offset, 0, Math.min(digest.length, length - offset))
    return result
}

/**
 * The SHA-256 (`$5$`) and SHA-512 (`$6$`) crypts of Ulrich Drepper's specification ("Unix crypt using SHA-256 and
 * SHA-512"), with their `rounds=` (5000 by default)
 * @param password The password.
 * @param setting The hash or its start (`$6$rounds=10000$salt`).
 * @returns The hash, undefined when the setting is not one.
 */
export function shaCrypt(password: Buffer, setting: string): string | undefined {
    const match: RegExpExecArray | null = /^\$([56])\$(?:rounds=(\d+)\$)?([^$]{0,16})/.exec(setting)
    if (!match) return undefined
    const algorithm: string = match[1] === '5' ? 'sha256' : 'sha512'
    const size: number = match[1] === '5' ? 32 : 64
    const rounds: number = match[2] === undefined ? 5000 : Math.min(999999999, Math.max(1000, Number(match[2])))
    const salt: Buffer = Buffer.from(match[3], 'latin1')
    const hash = (): Hash => createHash(algorithm)
    const b: Buffer = hash().update(password).update(salt).update(password).digest()
    const context: Hash = hash().update(password).update(salt)
    let left: number = password.length
    for (; left > size; left -= size) context.update(b)
    context.update(b.subarray(0, left))
    for (let bits: number = password.length; bits > 0; bits >>>= 1) context.update(bits & 1 ? b : password)
    const a: Buffer = context.digest()
    const dp: Hash = hash()
    for (let index: number = 0; index < password.length; index++) dp.update(password)
    const p: Buffer = repeated(dp.digest(), password.length)
    const ds: Hash = hash()
    for (let index: number = 0; index < 16 + a[0]; index++) ds.update(salt)
    const s: Buffer = repeated(ds.digest(), salt.length)
    let c: Buffer = a
    for (let round: number = 0; round < rounds; round++) {
        const step: Hash = hash()
        step.update(round & 1 ? p : c)
        if (round % 3) step.update(s)
        if (round % 7) step.update(p)
        step.update(round & 1 ? c : p)
        c = step.digest()
    }
    let encoded: string = (match[1] === '5' ? SHA256_ORDER : SHA512_ORDER).map(([high, middle, low]: number[]): string => to64(c[high], c[middle], c[low], 4)).join('')
    encoded += match[1] === '5' ? to64(0, c[31], c[30], 3) : to64(0, 0, c[63], 2)
    return `$${match[1]}$${match[2] === undefined ? '' : `rounds=${rounds}$`}${match[3]}$${encoded}`
}

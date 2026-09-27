/**
 * Derived from the upstream index.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 *
 * The bcrypt password hashing (Blowfish based), compatible with the other bcrypt implementations ($2a$, $2b$, $2y$).
 */
import {randomBytes} from 'node:crypto'
import {
    BASE64_CODE,
    BASE64_INDEX,
    BCRYPT_SALT_LEN,
    BLOWFISH_NUM_ROUNDS,
    C_ORIG,
    GENSALT_DEFAULT_LOG2_ROUNDS,
    MAX_EXECUTION_TIME,
    P_ORIG,
    S_ORIG
} from './constants.js'

/**
 * A progress callback: the ratio of the rounds done (0 to 1), at most once per 100 ms
 */
export type ProgressCallback = (progress: number) => void

/**
 * Bytes: an array of byte values, or a typed array
 */
type Bytes = ArrayLike<number>

/**
 * Continues after yielding to the event loop
 */
const nextTick: (callback: () => void) => void = setImmediate

/**
 * Synchronously generates a salt.
 * @param rounds Number of rounds to use, defaults to 10 if omitted (from 4 to 31)
 * @returns Resulting salt
 */
export function genSaltSync(rounds?: number): string {
    rounds = rounds || GENSALT_DEFAULT_LOG2_ROUNDS
    if (typeof rounds !== 'number') throw Error('Illegal arguments: ' + typeof rounds + ', undefined')
    if (rounds < 4) {
        rounds = 4
    } else if (rounds > 31) {
        rounds = 31
    }
    const salt: string[] = []
    salt.push('$2b$')
    if (rounds < 10) salt.push('0')
    salt.push(rounds.toString())
    salt.push('$')
    salt.push(base64Encode(randomBytes(BCRYPT_SALT_LEN), BCRYPT_SALT_LEN))
    return salt.join('')
}

/**
 * Asynchronously generates a salt.
 * @param rounds Number of rounds to use, defaults to 10 if omitted
 * @returns Resulting salt
 */
export function genSalt(rounds?: number): Promise<string> {
    if (typeof rounds === 'undefined') {
        rounds = GENSALT_DEFAULT_LOG2_ROUNDS
    } else if (typeof rounds !== 'number') {
        throw Error('illegal arguments: ' + typeof rounds)
    }
    const saltRounds: number = rounds
    return new Promise((resolve: (salt: string) => void, reject: (error: unknown) => void): void => nextTick((): void => {
        //Pretty thin, but salting is fast enough
        try {
            resolve(genSaltSync(saltRounds))
        } catch (error) {
            reject(error)
        }
    }))
}

/**
 * Synchronously generates a hash for the given password.
 * @param password Password to hash
 * @param salt Salt length to generate or salt to use, default to 10
 * @returns Resulting hash
 */
export function hashSync(password: string, salt: number | string = GENSALT_DEFAULT_LOG2_ROUNDS): string {
    if (typeof salt === 'number') salt = genSaltSync(salt)
    if (typeof password !== 'string' || typeof salt !== 'string') throw Error('Illegal arguments: ' + typeof password + ', ' + typeof salt)
    return hashPassword(password, salt)
}

/**
 * Asynchronously generates a hash for the given password.
 * @param password Password to hash
 * @param salt Salt length to generate or salt to use
 * @param progressCallback Callback successively called with the percentage of rounds completed (0.0 - 1.0), maximally
 *  once per `MAX_EXECUTION_TIME = 100` ms.
 * @returns Resulting hash
 */
export async function hash(password: string, salt: number | string, progressCallback?: ProgressCallback): Promise<string> {
    if (typeof password === 'string' && typeof salt === 'number') salt = await genSalt(salt)
    if (typeof password !== 'string' || typeof salt !== 'string') {
        const error: Error = Error('Illegal arguments: ' + typeof password + ', ' + typeof salt)
        await new Promise((resolve: (value: void) => void): void => nextTick(resolve))
        throw error
    }
    return await hashPasswordAsync(password, salt, progressCallback)
}

/**
 * Compares two strings of the same length in constant time.
 * @param known Must be of the correct length
 * @param unknown Must be the same length as `known`
 */
function safeStringCompare(known: string, unknown: string): boolean {
    let diff: number = known.length ^ unknown.length
    for (let i: number = 0; i < known.length; ++i) {
        diff |= known.charCodeAt(i) ^ unknown.charCodeAt(i)
    }
    return diff === 0
}

/**
 * Synchronously tests a password against a hash.
 * @param password Password to compare
 * @param hash Hash to test against
 * @returns true if matching, otherwise false
 */
export function compareSync(password: string, hash: string): boolean {
    if (typeof password !== 'string' || typeof hash !== 'string') throw Error('Illegal arguments: ' + typeof password + ', ' + typeof hash)
    if (hash.length !== 60) return false
    return safeStringCompare(hashSync(password, hash.substring(0, hash.length - 31)), hash)
}

/**
 * Asynchronously tests a password against a hash.
 * @param password Password to compare
 * @param hashValue Hash to test against
 * @param progressCallback Callback successively called with the percentage of rounds completed (0.0 - 1.0), maximally
 *  once per `MAX_EXECUTION_TIME = 100` ms.
 * @returns true if matching, otherwise false
 */
export async function compare(password: string, hashValue: string, progressCallback?: ProgressCallback): Promise<boolean> {
    if (typeof password !== 'string' || typeof hashValue !== 'string') {
        const error: Error = Error('Illegal arguments: ' + typeof password + ', ' + typeof hashValue)
        await new Promise((resolve: (value: void) => void): void => nextTick(resolve))
        throw error
    }
    if (hashValue.length !== 60) {
        await new Promise((resolve: (value: void) => void): void => nextTick(resolve))
        return false
    }
    return safeStringCompare(await hash(password, hashValue.substring(0, 29), progressCallback), hashValue)
}

/**
 * Gets the number of rounds used to encrypt the specified hash.
 * @param hash Hash to extract the used number of rounds from
 * @returns Number of rounds used
 */
export function getRounds(hash: string): number {
    if (typeof hash !== 'string') throw Error('Illegal arguments: ' + typeof hash)
    return parseInt(hash.split('$')[2], 10)
}

/**
 * Gets the salt portion from a hash. Does not validate the hash.
 * @param hash Hash to extract the salt from
 * @returns Extracted salt part
 */
export function getSalt(hash: string): string {
    if (typeof hash !== 'string') throw Error('Illegal arguments: ' + typeof hash)
    if (hash.length !== 60) throw Error('Illegal hash length: ' + hash.length + ' != 60')
    return hash.substring(0, 29)
}

/**
 * Tests if a password will be truncated when hashed, that is its length is greater than 72 bytes when converted to
 * UTF-8.
 * @param password The password to test
 * @returns `true` if truncated, otherwise `false`
 */
export function truncates(password: string): boolean {
    if (typeof password !== 'string') throw Error('Illegal arguments: ' + typeof password)
    return utf8Length(password) > 72
}

/**
 * Calculates the byte length of a string encoded as UTF8.
 * @param string
 */
function utf8Length(string: string): number {
    let length: number = 0
    for (let i: number = 0; i < string.length; ++i) {
        const c: number = string.charCodeAt(i)
        if (c < 128) {
            length += 1
        } else if (c < 2048) {
            length += 2
        } else if ((c & 0xfc00) === 0xd800 && (string.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
            ++i
            length += 4
        } else {
            length += 3
        }
    }
    return length
}

/**
 * Converts a string to an array of UTF8 bytes.
 * @param string
 */
function utf8Array(string: string): number[] {
    let offset: number = 0
    const buffer: number[] = new Array(utf8Length(string))
    for (let i: number = 0, k: number = string.length; i < k; ++i) {
        let c1: number = string.charCodeAt(i)
        let c2: number
        if (c1 < 128) {
            buffer[offset++] = c1
        } else if (c1 < 2048) {
            buffer[offset++] = (c1 >> 6) | 192
            buffer[offset++] = (c1 & 63) | 128
        } else if ((c1 & 0xfc00) === 0xd800 && ((c2 = string.charCodeAt(i + 1)) & 0xfc00) === 0xdc00) {
            c1 = 0x10000 + ((c1 & 0x03ff) << 10) + (c2 & 0x03ff)
            ++i
            buffer[offset++] = (c1 >> 18) | 240
            buffer[offset++] = ((c1 >> 12) & 63) | 128
            buffer[offset++] = ((c1 >> 6) & 63) | 128
            buffer[offset++] = (c1 & 63) | 128
        } else {
            buffer[offset++] = (c1 >> 12) | 224
            buffer[offset++] = ((c1 >> 6) & 63) | 128
            buffer[offset++] = (c1 & 63) | 128
        }
    }
    return buffer
}

/**
 * Encodes a byte array to base64 with up to len bytes of input, using the bcrypt alphabet.
 * @param b Byte array
 * @param len Maximum input length
 */
function base64Encode(b: Bytes, len: number): string {
    let off: number = 0
    const rs: string[] = []
    if (len <= 0 || len > b.length) throw Error('Illegal len: ' + len)
    while (off < len) {
        let c1: number = b[off++] & 0xff
        rs.push(BASE64_CODE[(c1 >> 2) & 0x3f])
        c1 = (c1 & 0x03) << 4
        if (off >= len) {
            rs.push(BASE64_CODE[c1 & 0x3f])
            break
        }
        let c2: number = b[off++] & 0xff
        c1 |= (c2 >> 4) & 0x0f
        rs.push(BASE64_CODE[c1 & 0x3f])
        c1 = (c2 & 0x0f) << 2
        if (off >= len) {
            rs.push(BASE64_CODE[c1 & 0x3f])
            break
        }
        c2 = b[off++] & 0xff
        c1 |= (c2 >> 6) & 0x03
        rs.push(BASE64_CODE[c1 & 0x3f])
        rs.push(BASE64_CODE[c2 & 0x3f])
    }
    return rs.join('')
}

/**
 * Decodes a base64 encoded string (bcrypt alphabet) to up to len bytes of output.
 * @param s String to decode
 * @param len Maximum output length
 */
function base64Decode(s: string, len: number): number[] {
    let off: number = 0
    const slen: number = s.length
    let olen: number = 0
    const rs: string[] = []
    if (len <= 0) throw Error('Illegal len: ' + len)
    while (off < slen - 1 && olen < len) {
        let code: number = s.charCodeAt(off++)
        const c1: number = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1
        code = s.charCodeAt(off++)
        const c2: number = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1
        if (c1 == -1 || c2 == -1) break
        let o: number = (c1 << 2) >>> 0
        o |= (c2 & 0x30) >> 4
        rs.push(String.fromCharCode(o))
        if (++olen >= len || off >= slen) break
        code = s.charCodeAt(off++)
        const c3: number = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1
        if (c3 == -1) break
        o = ((c2 & 0x0f) << 4) >>> 0
        o |= (c3 & 0x3c) >> 2
        rs.push(String.fromCharCode(o))
        if (++olen >= len || off >= slen) break
        code = s.charCodeAt(off++)
        const c4: number = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1
        o = ((c3 & 0x03) << 6) >>> 0
        o |= c4
        rs.push(String.fromCharCode(o))
        ++olen
    }
    const res: number[] = []
    for (off = 0; off < olen; off++) res.push(rs[off].charCodeAt(0))
    return res
}

/**
 * Blowfish encryption of the pair of words at off (the bottleneck: the loop is unrolled)
 * @param lr
 * @param off
 * @param P
 * @param S
 */
function encipher(lr: Int32Array | number[], off: number, P: Int32Array, S: Int32Array): Int32Array | number[] {
    let n: number
    let l: number = lr[off]
    let r: number = lr[off + 1]
    l ^= P[0]
    //Iteration 0
    n = S[l >>> 24]
    n += S[0x100 | ((l >> 16) & 0xff)]
    n ^= S[0x200 | ((l >> 8) & 0xff)]
    n += S[0x300 | (l & 0xff)]
    r ^= n ^ P[1]
    n = S[r >>> 24]
    n += S[0x100 | ((r >> 16) & 0xff)]
    n ^= S[0x200 | ((r >> 8) & 0xff)]
    n += S[0x300 | (r & 0xff)]
    l ^= n ^ P[2]
    //Iteration 1
    n = S[l >>> 24]
    n += S[0x100 | ((l >> 16) & 0xff)]
    n ^= S[0x200 | ((l >> 8) & 0xff)]
    n += S[0x300 | (l & 0xff)]
    r ^= n ^ P[3]
    n = S[r >>> 24]
    n += S[0x100 | ((r >> 16) & 0xff)]
    n ^= S[0x200 | ((r >> 8) & 0xff)]
    n += S[0x300 | (r & 0xff)]
    l ^= n ^ P[4]
    //Iteration 2
    n = S[l >>> 24]
    n += S[0x100 | ((l >> 16) & 0xff)]
    n ^= S[0x200 | ((l >> 8) & 0xff)]
    n += S[0x300 | (l & 0xff)]
    r ^= n ^ P[5]
    n = S[r >>> 24]
    n += S[0x100 | ((r >> 16) & 0xff)]
    n ^= S[0x200 | ((r >> 8) & 0xff)]
    n += S[0x300 | (r & 0xff)]
    l ^= n ^ P[6]
    //Iteration 3
    n = S[l >>> 24]
    n += S[0x100 | ((l >> 16) & 0xff)]
    n ^= S[0x200 | ((l >> 8) & 0xff)]
    n += S[0x300 | (l & 0xff)]
    r ^= n ^ P[7]
    n = S[r >>> 24]
    n += S[0x100 | ((r >> 16) & 0xff)]
    n ^= S[0x200 | ((r >> 8) & 0xff)]
    n += S[0x300 | (r & 0xff)]
    l ^= n ^ P[8]
    //Iteration 4
    n = S[l >>> 24]
    n += S[0x100 | ((l >> 16) & 0xff)]
    n ^= S[0x200 | ((l >> 8) & 0xff)]
    n += S[0x300 | (l & 0xff)]
    r ^= n ^ P[9]
    n = S[r >>> 24]
    n += S[0x100 | ((r >> 16) & 0xff)]
    n ^= S[0x200 | ((r >> 8) & 0xff)]
    n += S[0x300 | (r & 0xff)]
    l ^= n ^ P[10]
    //Iteration 5
    n = S[l >>> 24]
    n += S[0x100 | ((l >> 16) & 0xff)]
    n ^= S[0x200 | ((l >> 8) & 0xff)]
    n += S[0x300 | (l & 0xff)]
    r ^= n ^ P[11]
    n = S[r >>> 24]
    n += S[0x100 | ((r >> 16) & 0xff)]
    n ^= S[0x200 | ((r >> 8) & 0xff)]
    n += S[0x300 | (r & 0xff)]
    l ^= n ^ P[12]
    //Iteration 6
    n = S[l >>> 24]
    n += S[0x100 | ((l >> 16) & 0xff)]
    n ^= S[0x200 | ((l >> 8) & 0xff)]
    n += S[0x300 | (l & 0xff)]
    r ^= n ^ P[13]
    n = S[r >>> 24]
    n += S[0x100 | ((r >> 16) & 0xff)]
    n ^= S[0x200 | ((r >> 8) & 0xff)]
    n += S[0x300 | (r & 0xff)]
    l ^= n ^ P[14]
    //Iteration 7
    n = S[l >>> 24]
    n += S[0x100 | ((l >> 16) & 0xff)]
    n ^= S[0x200 | ((l >> 8) & 0xff)]
    n += S[0x300 | (l & 0xff)]
    r ^= n ^ P[15]
    n = S[r >>> 24]
    n += S[0x100 | ((r >> 16) & 0xff)]
    n ^= S[0x200 | ((r >> 8) & 0xff)]
    n += S[0x300 | (r & 0xff)]
    l ^= n ^ P[16]
    lr[off] = r ^ P[BLOWFISH_NUM_ROUNDS + 1]
    lr[off + 1] = l
    return lr
}

/**
 * The next word of a cyclic byte stream
 * @param data
 * @param offp
 */
function streamToWord(data: Bytes, offp: number): { key: number, offp: number } {
    let word: number = 0
    for (let i: number = 0; i < 4; ++i) {
        word = (word << 8) | (data[offp] & 0xff)
        offp = (offp + 1) % data.length
    }
    return {key: word, offp}
}

/**
 * Blowfish key schedule
 * @param key
 * @param P
 * @param S
 */
function blowfishKey(key: Bytes, P: Int32Array, S: Int32Array): void {
    let offset: number = 0
    let lr: Int32Array | number[] = [0, 0]
    const plen: number = P.length
    const slen: number = S.length
    for (let i: number = 0; i < plen; i++) {
        const sw: { key: number, offp: number } = streamToWord(key, offset)
        offset = sw.offp
        P[i] = P[i] ^ sw.key
    }
    for (let i: number = 0; i < plen; i += 2) {
        lr = encipher(lr, 0, P, S)
        P[i] = lr[0]
        P[i + 1] = lr[1]
    }
    for (let i: number = 0; i < slen; i += 2) {
        lr = encipher(lr, 0, P, S)
        S[i] = lr[0]
        S[i + 1] = lr[1]
    }
}

/**
 * Expensive key schedule Blowfish.
 * @param data
 * @param key
 * @param P
 * @param S
 */
function expensiveKey(data: Bytes, key: Bytes, P: Int32Array, S: Int32Array): void {
    let offp: number = 0
    let lr: Int32Array | number[] = [0, 0]
    const plen: number = P.length
    const slen: number = S.length
    let sw: { key: number, offp: number }
    for (let i: number = 0; i < plen; i++) {
        sw = streamToWord(key, offp)
        offp = sw.offp
        P[i] = P[i] ^ sw.key
    }
    offp = 0
    for (let i: number = 0; i < plen; i += 2) {
        sw = streamToWord(data, offp)
        offp = sw.offp
        lr[0] ^= sw.key
        sw = streamToWord(data, offp)
        offp = sw.offp
        lr[1] ^= sw.key
        lr = encipher(lr, 0, P, S)
        P[i] = lr[0]
        P[i + 1] = lr[1]
    }
    for (let i: number = 0; i < slen; i += 2) {
        sw = streamToWord(data, offp)
        offp = sw.offp
        lr[0] ^= sw.key
        sw = streamToWord(data, offp)
        offp = sw.offp
        lr[1] ^= sw.key
        lr = encipher(lr, 0, P, S)
        S[i] = lr[0]
        S[i + 1] = lr[1]
    }
}

/**
 * The state of a crypt: the Blowfish state, and the rounds done
 */
interface CryptState {
    b: Bytes
    salt: Bytes
    rounds: number
    P: Int32Array
    S: Int32Array
    i: number
}

/**
 * Starts crypting bytes (validates the rounds and the salt)
 * @param b Bytes to crypt
 * @param salt Salt bytes to use
 * @param rounds Number of rounds (log2)
 */
function startCrypt(b: Bytes, salt: Bytes, rounds: number): CryptState {
    if (rounds < 4 || rounds > 31) throw Error('Illegal number of rounds (4-31): ' + rounds)
    if (salt.length !== BCRYPT_SALT_LEN) throw Error('Illegal salt length: ' + salt.length + ' != ' + BCRYPT_SALT_LEN)
    const state: CryptState = {b, salt, rounds: (1 << rounds) >>> 0, P: new Int32Array(P_ORIG), S: new Int32Array(S_ORIG), i: 0}
    expensiveKey(salt, b, state.P, state.S)
    return state
}

/**
 * Runs rounds of a crypt, for at most a time (Infinity: all the rounds)
 * @param state
 * @param maxTime
 */
function runRounds(state: CryptState, maxTime: number): void {
    const start: number = Date.now()
    while (state.i < state.rounds) {
        state.i = state.i + 1
        blowfishKey(state.b, state.P, state.S)
        blowfishKey(state.salt, state.P, state.S)
        if (Date.now() - start > maxTime) break
    }
}

/**
 * Finishes a crypt: the bytes of the encrypted magic value
 * @param state
 */
function finishCrypt(state: CryptState): number[] {
    const cdata: number[] = C_ORIG.slice()
    const clen: number = cdata.length
    for (let i: number = 0; i < 64; i++) {
        for (let j: number = 0; j < clen >> 1; j++) encipher(cdata, j << 1, state.P, state.S)
    }
    const ret: number[] = []
    for (let i: number = 0; i < clen; i++) {
        ret.push(((cdata[i] >> 24) & 0xff) >>> 0)
        ret.push(((cdata[i] >> 16) & 0xff) >>> 0)
        ret.push(((cdata[i] >> 8) & 0xff) >>> 0)
        ret.push((cdata[i] & 0xff) >>> 0)
    }
    return ret
}

/**
 * The parts of a salt for hashing
 */
interface SaltParts {
    minor: string
    rounds: number
    passwordBytes: number[]
    saltBytes: number[]
}

/**
 * Parses a salt, and prepares the password bytes
 * @param password
 * @param salt
 */
function parseSalt(password: string, salt: string): SaltParts {
    if (typeof password !== 'string' || typeof salt !== 'string') throw Error('Invalid string / salt: Not a string')
    //Validate the salt
    let minor: string
    let offset: number
    if (salt.charAt(0) !== '$' || salt.charAt(1) !== '2') throw Error('Invalid salt version: ' + salt.substring(0, 2))
    if (salt.charAt(2) === '$') {
        minor = String.fromCharCode(0)
        offset = 3
    } else {
        minor = salt.charAt(2)
        if ((minor !== 'a' && minor !== 'b' && minor !== 'y') || salt.charAt(3) !== '$') throw Error('Invalid salt revision: ' + salt.substring(2, 4))
        offset = 4
    }
    //Extract number of rounds
    if (salt.charAt(offset + 2) > '$') throw Error('Missing salt rounds')
    const r1: number = parseInt(salt.substring(offset, offset + 1), 10) * 10
    const r2: number = parseInt(salt.substring(offset + 1, offset + 2), 10)
    const rounds: number = r1 + r2
    const realSalt: string = salt.substring(offset + 3, offset + 25)
    password += minor >= 'a' ? '\x00' : ''
    return {minor, rounds, passwordBytes: utf8Array(password), saltBytes: base64Decode(realSalt, BCRYPT_SALT_LEN)}
}

/**
 * The hash string of the crypted bytes
 * @param parts
 * @param bytes
 */
function formatHash(parts: SaltParts, bytes: number[]): string {
    const res: string[] = []
    res.push('$2')
    if (parts.minor >= 'a') res.push(parts.minor)
    res.push('$')
    if (parts.rounds < 10) res.push('0')
    res.push(parts.rounds.toString())
    res.push('$')
    res.push(base64Encode(parts.saltBytes, parts.saltBytes.length))
    res.push(base64Encode(bytes, C_ORIG.length * 4 - 1))
    return res.join('')
}

/**
 * Hashes a password synchronously.
 * @param password Password to hash
 * @param salt Salt to use
 */
function hashPassword(password: string, salt: string): string {
    const parts: SaltParts = parseSalt(password, salt)
    const state: CryptState = startCrypt(parts.passwordBytes, parts.saltBytes, parts.rounds)
    runRounds(state, Infinity)
    return formatHash(parts, finishCrypt(state))
}

/**
 * Hashes a password asynchronously: the rounds run at most 100 ms at a time, yielding to the event loop in between.
 * @param password Password to hash
 * @param salt Salt to use
 * @param progressCallback
 */
async function hashPasswordAsync(password: string, salt: string, progressCallback?: ProgressCallback): Promise<string> {
    let parts: SaltParts
    let state: CryptState
    try {
        parts = parseSalt(password, salt)
        state = startCrypt(parts.passwordBytes, parts.saltBytes, parts.rounds)
    } catch (error) {
        //The errors are reported asynchronously
        await new Promise((resolve: (value: void) => void): void => nextTick(resolve))
        throw error
    }
    for (; ;) {
        if (progressCallback) progressCallback(state.i / state.rounds)
        if (state.i >= state.rounds) break
        runRounds(state, MAX_EXECUTION_TIME)
        await new Promise((resolve: (value: void) => void): void => nextTick(resolve))
    }
    return formatHash(parts, finishCrypt(state))
}

/**
 * Encodes a byte array to base64 with up to len bytes of input, using the custom bcrypt alphabet.
 * @param bytes Byte array
 * @param length Maximum input length
 */
export function encodeBase64(bytes: Bytes, length: number): string {
    return base64Encode(bytes, length)
}

/**
 * Decodes a base64 encoded string to up to len bytes of output, using the custom bcrypt alphabet.
 * @param string String to decode
 * @param length Maximum output length
 */
export function decodeBase64(string: string, length: number): number[] {
    return base64Decode(string, length)
}

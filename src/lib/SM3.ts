function rotateLeft(x: number, n: number): number {
    return ((x << n) | (x >>> (32 - n))) | 0
}

class Hasher {
    [x: string]: any

    constructor(options: any) {
        this.unitSize = 4
        this.unitOrder = 0
        this.blockSize = 16
        this.blockSizeInBytes = this.blockSize * this.unitSize
        this.options = options || {}
        this.reset()
    }

    reset(): void {
        this.state = {}
        this.state.message = ''
        this.state.length = 0
    }

    getState(): Object {
        return JSON.parse(JSON.stringify(this.state))
    }

    setState(state: Object): void {
        this.state = state
    }

    update(message: string): void {
        this.state.message += message
        this.state.length += message.length
        this.process()
    }

    process(): void {
    }

    finalize(): string {
        return ''
    }

    getStateHash(size?: number): string {
        return ''
    }

    addPaddingPKCS7(length: number): void {
        this.state.message += new Array(length + 1).join(String.fromCharCode(length))
    }

    addPaddingISO7816(length: number): void {
        this.state.message += '\x80' + new Array(length).join('\x00')
    }

    addPaddingZero(length: number): void {
        this.state.message += new Array(length + 1).join('\x00')
    }
}

class Hasher32be extends Hasher {
    constructor(options?: any) {
        super(options)
        this.unitOrder = 1
        this.blockUnits = []
    }

    process(): void {
        while (this.state.message.length >= this.blockSizeInBytes) {
            this.blockUnits = []
            for (let b = 0; b < this.blockSizeInBytes; b += 4) {
                this.blockUnits.push(
                    (this.state.message.charCodeAt(b) << 24) |
                    (this.state.message.charCodeAt(b + 1) << 16) |
                    (this.state.message.charCodeAt(b + 2) << 8) |
                    this.state.message.charCodeAt(b + 3)
                )
            }
            this.state.message = this.state.message.substr(this.blockSizeInBytes)
            this.processBlock(this.blockUnits)
        }
    }

    processBlock(M: number[]): void {
    }

    getStateHash(size?: number): string {
        size = size || this.state.hash.length
        let hash = ''
        for (let i = 0; i < size!; i++) {
            hash +=
                String.fromCharCode((this.state.hash[i] >> 24) & 0xff) +
                String.fromCharCode((this.state.hash[i] >> 16) & 0xff) +
                String.fromCharCode((this.state.hash[i] >> 8) & 0xff) +
                String.fromCharCode(this.state.hash[i] & 0xff)
        }
        return hash
    }

    addLengthBits(): void {
        this.state.message +=
            '\x00\x00\x00' +
            String.fromCharCode((this.state.length >> 29) & 0xff) +
            String.fromCharCode((this.state.length >> 21) & 0xff) +
            String.fromCharCode((this.state.length >> 13) & 0xff) +
            String.fromCharCode((this.state.length >> 5) & 0xff) +
            String.fromCharCode((this.state.length << 3) & 0xff)
    }
}

export class Sm3 extends Hasher32be {
    constructor(options?: { rounds?: number; length?: number }) {
        options = options || {}
        options.length = options.length || 256
        options.rounds = options.rounds || 64
        super(options)
        this.W = new Array(132)
    }

    reset() {
        super.reset()
        this.state.hash = [
            0x7380166f | 0,
            0x4914b2b9 | 0,
            0x172442d7 | 0,
            0xda8a0600 | 0,
            0xa96f30bc | 0,
            0x163138aa | 0,
            0xe38dee4d | 0,
            0xb0fb0e4e | 0
        ]
    }

    static p0(x: number): number {
        return x ^ rotateLeft(x, 9) ^ rotateLeft(x, 17)
    }

    static p1(x: number): number {
        return x ^ rotateLeft(x, 15) ^ rotateLeft(x, 23)
    }

    static tj(i: number): number {
        return i < 16 ? 0x79cc4519 : 0x7a879d8a
    }

    static ffj(i: number, a: number, b: number, c: number): number {
        return i < 16 ? a ^ b ^ c : (a & b) | (a & c) | (b & c)
    }

    static ggj(i: number, e: number, f: number, g: number): number {
        return i < 16 ? e ^ f ^ g : (e & f) | (~e & g)
    }

    processBlock(block: number[]): void {
        // Working variables
        let a = this.state.hash[0] | 0
        let b = this.state.hash[1] | 0
        let c = this.state.hash[2] | 0
        let d = this.state.hash[3] | 0
        let e = this.state.hash[4] | 0
        let f = this.state.hash[5] | 0
        let g = this.state.hash[6] | 0
        let h = this.state.hash[7] | 0
        // Expand message
        for (let i = 0; i < 132; i++) {
            if (i < 16) {
                this.W[i] = block[i] | 0
            } else if (i < 68) {
                this.W[i] =
                    Sm3.p1(
                        this.W[i - 16] ^
                        this.W[i - 9] ^
                        rotateLeft(this.W[i - 3], 15)
                    ) ^
                    rotateLeft(this.W[i - 13], 7) ^
                    this.W[i - 6]
            } else {
                this.W[i] = this.W[i - 68] ^ this.W[i - 64]
            }
        }
        // Calculate hash
        for (let i = 0; i < this.options.rounds; i++) {
            const ss1 = rotateLeft(
                (rotateLeft(a, 12) + e + rotateLeft(Sm3.tj(i), i % 32)) | 0,
                7
            )
            const ss2 = ss1 ^ rotateLeft(a, 12)
            const tt1 = (
                Sm3.ffj(i, a, b, c) + d + ss2 + this.W[i + 68]
            ) | 0
            const tt2 = (
                Sm3.ggj(i, e, f, g) + h + ss1 + this.W[i]
            ) | 0

            d = c
            c = rotateLeft(b, 9)
            b = a
            a = tt1
            h = g
            g = rotateLeft(f, 19)
            f = e
            e = Sm3.p0(tt2)
        }

        this.state.hash[0] = this.state.hash[0] ^ a
        this.state.hash[1] = this.state.hash[1] ^ b
        this.state.hash[2] = this.state.hash[2] ^ c
        this.state.hash[3] = this.state.hash[3] ^ d
        this.state.hash[4] = this.state.hash[4] ^ e
        this.state.hash[5] = this.state.hash[5] ^ f
        this.state.hash[6] = this.state.hash[6] ^ g
        this.state.hash[7] = this.state.hash[7] ^ h
    }

    /**
     * Finalize hash and return result
     *
     * @returns {string}
     */
    finalize(): string {
        this.addPaddingISO7816(
            this.state.message.length < 56
                ? 56 - this.state.message.length | 0
                : 120 - this.state.message.length | 0
        )
        this.addLengthBits()
        this.process()
        return this.getStateHash((this.options.length / 32) | 0)
    }
}

export class SM3Hmac {
    oPad: string
    hasher: any

    constructor(key: string, hasher: any) {
        if (key.length > hasher.blockSizeInBytes) {
            hasher.update(key)
            key = hasher.finalize()
            hasher.reset()
        }
        for (let i = key.length; i < hasher.blockSizeInBytes; i++) {
            key += '\x00'
        }
        this.oPad = ''
        for (let i = 0; i < key.length; i++) {
            hasher.update(String.fromCharCode(0x36 ^ key.charCodeAt(i)))
            this.oPad += String.fromCharCode(0x5c ^ key.charCodeAt(i))
        }
        this.hasher = hasher
    }

    update(message: string) {
        this.hasher.update(message)
    }

    finalize() {
        const hash = this.hasher.finalize()
        this.hasher.reset()
        this.hasher.update(this.oPad)
        this.hasher.update(hash)
        return this.hasher.finalize()
    }
}

export function SM3ToHex(raw: string): string {
    let str = ''
    for (let i = 0, l = raw.length; i < l; i++) {
        str += (raw.charCodeAt(i) < 16 ? '0' : '') + raw.charCodeAt(i).toString(16)
    }
    return str
}

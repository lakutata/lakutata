import 'reflect-metadata'
import {AlgorithmInitializer, SymmetricEncryption} from '../../base/abstracts/SymmetricEncryption.js'
import {createCipheriv, createDecipheriv} from 'browserify-cipher'

export class AES256 extends SymmetricEncryption {

    protected readonly ivLength: number = 16

    protected readonly keyLength: number = 32

    constructor(key: Buffer, iv?: Buffer)
    constructor(key: string, iv?: string)
    constructor(key: Buffer | string, iv?: Buffer | string) {
        super()
        if (!arguments.length) return
        const allowNullIV: boolean = iv === undefined
        const algorithm: string = `aes-256-${allowNullIV ? 'ecb' : 'cbc'}`
        this.initCipher(algorithm, allowNullIV, key, iv)
    }

    protected algorithmNotFoundInitializer(): AlgorithmInitializer {
        return {
            blockSize: 16,
            cipherCreator: () => createCipheriv(this.algorithm, this.key, this.allowNullIV ? null : this.iv),
            decipherCreator: () => createDecipheriv(this.algorithm, this.key, this.allowNullIV ? null : this.iv)
        }
    }
}

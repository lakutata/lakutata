import {AlgorithmInitializer, SymmetricEncryption} from '../../base/abstracts/SymmetricEncryption'
import {createCipheriv, createDecipheriv} from 'browserify-cipher'

export class TripleDES extends SymmetricEncryption {

    protected readonly ivLength: number = 8

    protected readonly keyLength: number = 24

    constructor(key: Buffer, iv?: Buffer)
    constructor(key: string, iv?: string)
    constructor(key: Buffer | string, iv?: Buffer | string) {
        super()
        if (!arguments.length) return
        const allowNullIV: boolean = iv === undefined
        const algorithm: string = `des-ede3-${allowNullIV ? 'ecb' : 'cbc'}`
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

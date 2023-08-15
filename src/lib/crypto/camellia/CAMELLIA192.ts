import 'reflect-metadata'
import {SymmetricEncryption} from '../../base/abstracts/SymmetricEncryption.js'

export class CAMELLIA192 extends SymmetricEncryption {

    protected readonly ivLength: number = 16

    protected readonly keyLength: number = 24

    constructor(key: Buffer, iv?: Buffer)
    constructor(key: string, iv?: string)
    constructor(key: Buffer | string, iv?: Buffer | string) {
        super()
        if (!arguments.length) return
        const allowNullIV: boolean = iv === undefined
        const algorithm: string = `camellia-192-${allowNullIV ? 'ecb' : 'cbc'}`
        this.initCipher(algorithm, allowNullIV, key, iv)
    }
}

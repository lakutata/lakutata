import {SymmetricEncryption} from '../../base/abstracts/SymmetricEncryption.js'

export class DES extends SymmetricEncryption {

    protected readonly ivLength: number = 8

    protected readonly keyLength: number = 16

    constructor(key: Buffer, iv?: Buffer)
    constructor(key: string, iv?: string)
    constructor(key: Buffer | string, iv?: Buffer | string) {
        super()
        if (!arguments.length) return
        const allowNullIV: boolean = iv === undefined
        const algorithm: string = `des-ede-${allowNullIV ? 'ecb' : 'cbc'}`
        this.initCipher(algorithm, allowNullIV, key, iv)
    }
}

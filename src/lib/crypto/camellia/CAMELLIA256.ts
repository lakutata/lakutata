import {SymmetricEncryption} from '../../base/abstracts/SymmetricEncryption'

export class CAMELLIA256 extends SymmetricEncryption {

    protected readonly ivLength: number = 16

    protected readonly keyLength: number = 32

    constructor(key: Buffer, iv?: Buffer)
    constructor(key: string, iv?: string)
    constructor(key: Buffer | string, iv?: Buffer | string) {
        super()
        if (!arguments.length) return
        const allowNullIV: boolean = iv === undefined
        const algorithm: string = `camellia-256-${allowNullIV ? 'ecb' : 'cbc'}`
        this.initCipher(algorithm, allowNullIV, key, iv)
    }
}

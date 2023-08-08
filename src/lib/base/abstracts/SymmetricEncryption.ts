import {Cipher, createCipheriv, createDecipheriv, Decipher, getCiphers, randomBytes, getCipherInfo} from 'crypto'
import {InvalidSymmetricCipherKeyLengthException} from '../../../exceptions/InvalidSymmetricCipherKeyLengthException.js'
import {InvalidSymmetricCipherIVLengthException} from '../../../exceptions/InvalidSymmetricCipherIVLengthException.js'
import {IConstructor} from '../../../interfaces/IConstructor.js'
import {ConvertToStream} from '../../../Utilities.js'

const SUPPORT_CIPHERS: string[] = getCiphers().map((value: string) => value.toUpperCase())

interface SymmetricEncryptionValidateKeyLengthResult {
    isValid: boolean
    exceptBytes: number
    receivedBytes: number
}

interface SymmetricEncryptionValidateIVLengthResult {
    isValid: boolean
    exceptBytes: number
    receivedBytes: number
}

/**
 * 同步加密抽象类
 */
export abstract class SymmetricEncryption {

    /**
     * 加解密算法
     * @protected
     */
    protected algorithm: string

    /**
     * 加密分组大小
     * @protected
     */
    protected blockSize: number = 16

    /**
     * 加解密秘钥
     * @protected
     */
    protected key: Buffer

    /**
     * 加解密向量
     * @protected
     */
    protected iv: Buffer

    /**
     * 是否使用空向量(ECB模式)
     * 允许则为ECB模式，否则为CBC模式
     * @protected
     */
    protected allowNullIV: boolean

    /**
     * 加解密秘钥长度，以Bytes为单位
     * @protected
     */
    protected abstract readonly keyLength: number

    /**
     * 加解密向量长度，以Bytes为单位
     * @protected
     */
    protected abstract readonly ivLength: number

    /**
     * 加密器
     * @constructor
     */
    public get Cipher(): Cipher {
        return createCipheriv(this.algorithm, this.key, this.allowNullIV ? null : this.iv)
    }

    /**
     * 解密器
     * @constructor
     */
    public get Decipher(): Decipher {
        return createDecipheriv(this.algorithm, this.key, this.allowNullIV ? null : this.iv)
    }

    /**
     * 初始化加密器
     * @param algorithm
     * @param allowNullIV
     * @param key
     * @param iv
     * @protected
     */
    protected initCipher(algorithm: string, allowNullIV: boolean, key?: Buffer | string, iv?: Buffer | string): void {
        const bytesKey: Buffer | undefined = key === undefined ? undefined : ((typeof key === 'string') ? Buffer.from(key, 'hex') : key)
        const bytesIV: Buffer | undefined = iv === undefined ? undefined : ((typeof iv === 'string') ? Buffer.from(iv, 'hex') : iv)
        this.key = bytesKey ? bytesKey : randomBytes(this.keyLength)
        this.iv = bytesIV ? bytesIV : randomBytes(this.ivLength)
        this.algorithm = algorithm
        this.allowNullIV = allowNullIV
        const blockSize: number | undefined = getCipherInfo(this.algorithm)?.blockSize
        this.blockSize = blockSize ? blockSize : this.blockSize
        const validateKeyLengthResult: SymmetricEncryptionValidateKeyLengthResult = this.validateKeyLength(this.key)
        if (!validateKeyLengthResult.isValid) throw new InvalidSymmetricCipherKeyLengthException(
            'The key length should be {exceptBytes} bytes ({exceptBits}-bits), but the received key length is {receivedBytes} bytes ({receivedBits}-bits)',
            {
                exceptBytes: validateKeyLengthResult.exceptBytes,
                exceptBits: validateKeyLengthResult.exceptBytes * 8,
                receivedBytes: validateKeyLengthResult.receivedBytes,
                receivedBits: validateKeyLengthResult.receivedBytes * 8
            })
        const validateIVLengthResult: SymmetricEncryptionValidateIVLengthResult = this.validateIVLength(this.iv)
        if (!validateIVLengthResult.isValid) throw new InvalidSymmetricCipherIVLengthException(
            'The IV length should be {exceptBytes} bytes ({exceptBits}-bits), but the received IV length is {receivedBytes} bytes ({receivedBits}-bits)', {
                exceptBytes: validateIVLengthResult.exceptBytes,
                exceptBits: validateIVLengthResult.exceptBytes * 8,
                receivedBytes: validateIVLengthResult.receivedBytes,
                receivedBits: validateIVLengthResult.receivedBytes * 8
            })
    }

    /**
     * 运行环境是否需要降级使用该加密算法
     * @protected
     */
    protected isFallbackNeeded(): boolean {
        //todo
        return !SUPPORT_CIPHERS.includes(this.algorithm.toUpperCase())
    }

    /**
     * 验证key的长度
     * @param key
     * @protected
     */
    protected validateKeyLength(key: Buffer): SymmetricEncryptionValidateKeyLengthResult {
        return {
            isValid: key.length === this.keyLength,
            exceptBytes: this.keyLength,
            receivedBytes: key.length
        }
    }

    /**
     * 验证iv向量的长度
     * @param iv
     * @protected
     */
    protected validateIVLength(iv: Buffer): SymmetricEncryptionValidateIVLengthResult {
        return {
            isValid: iv.length === this.ivLength,
            exceptBytes: this.ivLength,
            receivedBytes: iv.length
        }
    }

    /**
     * 加密消息
     * @param message
     */
    public encrypt(message: string): string {
        const cipher: Cipher = this.Cipher
        return `${cipher.update(message, 'utf-8', 'hex')}${cipher.final('hex')}`
    }

    /**
     * 异步加密消息
     * @param message
     */
    public async encryptAsync(message: string): Promise<string> {
        return new Promise((resolve, reject): void => {
            let cache: Buffer = Buffer.from([])
            ConvertToStream(message).pipe(this.Cipher)
                .on('data', (chunk: Buffer) => cache = Buffer.concat([cache, chunk]))
                .once('error', reject)
                .once('end', () => resolve(cache.toString('hex')))
        })
    }

    /**
     * 解密消息
     * @param encryptedMessage
     */
    public decrypt(encryptedMessage: string): string {
        const decipher: Decipher = this.Decipher
        return `${decipher.update(encryptedMessage, 'hex', 'utf-8')}${decipher.final('utf-8')}`
    }

    /**
     * 异步解密消息
     * @param encryptedMessage
     */
    public async decryptAsync(encryptedMessage: string): Promise<string> {
        return new Promise((resolve, reject): void => {
            const decipher: Decipher = this.Decipher
            decipher.once('error', reject)
            let chunkCache: string = ''
            let decryptedMessage: string = ''
            ConvertToStream(encryptedMessage)
                .on('data', (chunk: string) => {
                    chunkCache += chunk
                    if (chunkCache.length >= this.blockSize) {
                        decryptedMessage += decipher.update(chunkCache, 'hex', 'utf-8')
                        chunkCache = ''
                    }
                })
                .once('error', reject)
                .once('end', () => resolve(`${decryptedMessage}${decipher.final('utf-8')}`))
        })
    }

    /**
     * 生成随机秘钥，BASE64字符串格式
     */
    public static generateKey<T extends SymmetricEncryption>(this: IConstructor<T>): string {
        return randomBytes(new this().keyLength).toString('hex')
    }

    /**
     * 生成随机向量，BASE64字符串格式
     */
    public static generateIV<T extends SymmetricEncryption>(this: IConstructor<T>): string {
        return randomBytes(new this().ivLength).toString('hex')
    }
}
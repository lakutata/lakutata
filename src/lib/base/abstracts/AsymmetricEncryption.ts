import {IConstructor} from '../../../interfaces/IConstructor.js'
import {NoAsymmetricEncryptPublicKeyException} from '../../../exceptions/NoAsymmetricEncryptPublicKeyException.js'
import {NoAsymmetricEncryptPrivateKeyException} from '../../../exceptions/NoAsymmetricEncryptPrivateKeyException.js'
import {
    InvalidAsymmetricEncryptPrivateKeyException
} from '../../../exceptions/InvalidAsymmetricEncryptPrivateKeyException.js'
import {
    InvalidAsymmetricEncryptPublicKeyException
} from '../../../exceptions/InvalidAsymmetricEncryptPublicKeyException.js'
import {As, IsPath, NonceStr} from '../../../Utilities.js'
import {InvalidAsymmetricEncryptKeyPairException} from '../../../exceptions/InvalidAsymmetricEncryptKeyPairException.js'
import {PathLike, Stats} from 'fs'
import {stat, readFile} from 'fs/promises'
import {AsymmetricEncryptException} from '../../../exceptions/AsymmetricEncryptException.js'
import {AsymmetricDecryptException} from '../../../exceptions/AsymmetricDecryptException.js'
import {AsymmetricSignException} from '../../../exceptions/AsymmetricSignException.js'
import {AsymmetricVerifyException} from '../../../exceptions/AsymmetricVerifyException.js'

/**
 * 公钥操作方法对象接口
 */
export interface AsymmetricEncryptionPublic {
    /**
     * 加密数据
     * @param message
     */
    encrypt(message: string): string

    /**
     * 验证签名
     * @param message
     * @param sign
     */
    verify(message: string, sign: string): boolean
}

/**
 * 私钥操作方法对象接口
 */
export interface AsymmetricEncryptionPrivate {
    /**
     * 解密数据
     * @param encryptedMessage
     */
    decrypt(encryptedMessage: string): string

    /**
     * 数据签名
     * @param message
     */
    sign(message: string): string
}

export interface AsymmetricEncryptionKeyPair {
    /**
     * 公钥字符串
     */
    publicKey: string
    /**
     * 私钥字符串
     */
    privateKey: string
}

/**
 * 解析获取秘钥内容
 * 输入为文件时执行文件读取获取
 * 输入为秘钥字符串时则直接返回
 * @param inp
 */
async function getKeyContent(inp: string | PathLike): Promise<string> {
    let keyString: string = As<string>(inp)
    if (IsPath(inp)) {
        try {
            const fileStat: Stats = await stat(inp)
            if (fileStat.isFile()) keyString = await readFile(inp, {encoding: 'utf-8'})
        } catch (e) {
            keyString = As<string>(inp)
        }
    }
    return keyString
}

export abstract class AsymmetricEncryption {

    protected readonly privateKey: any

    protected readonly publicKey: any

    constructor(keyPair?: Partial<AsymmetricEncryptionKeyPair>) {
        if (keyPair) {
            if (keyPair.privateKey) {
                try {
                    this.privateKey = this.createPrivateKey(keyPair.privateKey)
                } catch (e) {
                    throw new InvalidAsymmetricEncryptPrivateKeyException(<Error>e)
                }
            }
            if (keyPair.publicKey) {
                try {
                    this.publicKey = this.createPublicKey(keyPair.publicKey)
                } catch (e) {
                    throw new InvalidAsymmetricEncryptPublicKeyException(<Error>e)
                }
            }
        }
    }

    /**
     * 创建私钥对象
     * @param privateKeyString
     * @protected
     */
    protected abstract createPrivateKey(privateKeyString: string): any

    /**
     * 创建公钥对象
     * @param publicKeyString
     * @protected
     */
    protected abstract createPublicKey(publicKeyString: string): any

    /**
     * 加密数据，供内部调用
     * @param message
     * @protected
     */
    protected _encrypt(message: string): string {
        try {
            return this.encrypt(message)
        } catch (e) {
            throw new AsymmetricEncryptException(<Error>e)
        }
    }

    /**
     * 加密数据
     * @param message
     * @protected
     */
    protected abstract encrypt(message: string): string

    /**
     * 解密数据，供内部调用
     * @param encryptedMessage
     * @protected
     */
    protected _decrypt(encryptedMessage: string): string {
        try {
            return this.decrypt(encryptedMessage)
        } catch (e) {
            throw new AsymmetricDecryptException(<Error>e)
        }
    }

    /**
     * 解密数据
     * @param encryptedMessage
     * @protected
     */
    protected abstract decrypt(encryptedMessage: string): string

    /**
     * 数据签名，供内部调用
     * @param message
     * @protected
     */
    protected _sign(message: string): string {
        try {
            return this.sign(message)
        } catch (e) {
            throw new AsymmetricSignException(<Error>e)
        }
    }

    /**
     * 数据签名
     * @param message
     * @protected
     */
    protected abstract sign(message: string): string

    /**
     * 验证签名，供内部调用
     * @param message
     * @param sign
     * @protected
     */
    protected _verify(message: string, sign: string): boolean {
        try {
            return this.verify(message, sign)
        } catch (e) {
            throw new AsymmetricVerifyException(<Error>e)
        }
    }

    /**
     * 验证签名
     * @param message
     * @param sign
     * @protected
     */
    protected abstract verify(message: string, sign: string): boolean

    /**
     * 生成密钥对
     * @param options
     * @protected
     */
    protected abstract generateKeyPair(options?: object): Promise<AsymmetricEncryptionKeyPair>

    /**
     * 公钥操作方法对象
     */
    public get public(): AsymmetricEncryptionPublic {
        if (!this.publicKey) throw new NoAsymmetricEncryptPublicKeyException('Public key not found')
        return {
            encrypt: (message: string): string => this._encrypt(message),
            verify: (message: string, sign: string): boolean => this._verify(message, sign)
        }
    }

    /**
     * 私钥操作方法对象
     */
    public get private(): AsymmetricEncryptionPrivate {
        if (!this.privateKey) throw new NoAsymmetricEncryptPrivateKeyException('Private key not found')
        return {
            decrypt: (encryptedMessage: string): string => this._decrypt(encryptedMessage),
            sign: (message: string): string => this._sign(message)
        }
    }

    /**
     * 生成密钥对
     */
    public static async generateKeyPair<T extends AsymmetricEncryption>(this: IConstructor<T>, options?: object): Promise<AsymmetricEncryptionKeyPair> {
        return await new this().generateKeyPair(options)
    }

    /**
     * 加载密钥对并返回不对称加密类实例
     */
    public static async loadKeyPair<T extends AsymmetricEncryption>(this: IConstructor<T>, keyPair: AsymmetricEncryptionKeyPair): Promise<T> {
        const instance: T = new this(keyPair)
        const nonceStr: string = NonceStr()
        const signature: string = instance.sign(nonceStr)
        if (!instance.verify(nonceStr, signature)) throw new InvalidAsymmetricEncryptKeyPairException('Invalid key pair')
        return instance
    }

    /**
     * 加载公钥并返回公钥操作方法对象
     */
    public static async loadPublicKey(filename: PathLike): Promise<AsymmetricEncryptionPublic>
    public static async loadPublicKey(keyContent: string): Promise<AsymmetricEncryptionPublic>
    public static async loadPublicKey<T extends AsymmetricEncryption>(this: IConstructor<T>, inp: PathLike | string): Promise<AsymmetricEncryptionPublic> {
        const instance: T = new this({publicKey: await getKeyContent(inp)})
        return instance.public
    }

    /**
     * 加载私钥并返回私钥操作方法对象
     */
    public static async loadPrivateKey(filename: PathLike): Promise<AsymmetricEncryptionPrivate>
    public static async loadPrivateKey(keyContent: string): Promise<AsymmetricEncryptionPrivate>
    public static async loadPrivateKey<T extends AsymmetricEncryption>(this: IConstructor<T>, inp: string | PathLike): Promise<AsymmetricEncryptionPrivate> {
        const instance: T = new this({privateKey: await getKeyContent(inp)})
        return instance.private
    }
}

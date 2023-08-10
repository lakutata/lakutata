import {IConstructor} from '../../../interfaces/IConstructor.js'
import {NoAsymmetricEncryptPublicKeyException} from '../../../exceptions/NoAsymmetricEncryptPublicKeyException.js'
import {NoAsymmetricEncryptPrivateKeyException} from '../../../exceptions/NoAsymmetricEncryptPrivateKeyException.js'
import {
    InvalidAsymmetricEncryptPrivateKeyException
} from '../../../exceptions/InvalidAsymmetricEncryptPrivateKeyException.js'
import {
    InvalidAsymmetricEncryptPublicKeyException
} from '../../../exceptions/InvalidAsymmetricEncryptPublicKeyException.js'
import {NonceStr} from '../../../Utilities.js'
import {InvalidAsymmetricEncryptKeyPairException} from '../../../exceptions/InvalidAsymmetricEncryptKeyPairException.js'

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
     * 加密数据
     * @param message
     * @protected
     */
    protected abstract encrypt(message: string): string

    /**
     * 解密数据
     * @param encryptedMessage
     * @protected
     */
    protected abstract decrypt(encryptedMessage: string): string

    /**
     * 数据签名
     * @param message
     * @protected
     */
    protected abstract sign(message: string): string

    /**
     * 生成密钥对
     * @param options
     * @protected
     */
    protected abstract generateKeyPair(options?: object): Promise<AsymmetricEncryptionKeyPair>

    /**
     * 验证签名
     * @param message
     * @param sign
     * @protected
     */
    protected abstract verify(message: string, sign: string): boolean

    /**
     * 公钥操作方法对象
     */
    public get public(): AsymmetricEncryptionPublic {
        if (!this.publicKey) throw new NoAsymmetricEncryptPublicKeyException('Public key not found')
        return {
            encrypt: (message: string): string => this.encrypt(message),
            verify: (message: string, sign: string): boolean => this.verify(message, sign)
        }
    }

    /**
     * 私钥操作方法对象
     */
    public get private(): AsymmetricEncryptionPrivate {
        if (!this.privateKey) throw new NoAsymmetricEncryptPrivateKeyException('Private key not found')
        return {
            decrypt: (encryptedMessage: string): string => this.decrypt(encryptedMessage),
            sign: (message: string): string => this.sign(message)
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
     * 加载PEM格式证书并返回公钥操作方法对象
     */
    public static async loadPEM(): Promise<AsymmetricEncryptionPublic> {
        //todo
        throw new Error('not implemented')
    }

    /**
     * 加载PFX格式证书并返回公钥操作方法对象
     */
    public static async loadPFX(): Promise<AsymmetricEncryptionPublic> {
        //todo
        throw new Error('not implemented')
    }

    /**
     * 加载CRT格式证书并返回公钥操作方法对象
     */
    public static async loadCRT(): Promise<AsymmetricEncryptionPublic> {
        //todo
        throw new Error('not implemented')
    }

    /**
     * 加载私钥并返回私钥操作方法对象
     */
    public static async loadPrivateKey(): Promise<AsymmetricEncryptionPrivate> {
        //todo
        throw new Error('not implemented')
    }
}

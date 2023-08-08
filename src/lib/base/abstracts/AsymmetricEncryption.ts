import {verify, publicEncrypt} from 'crypto'
import {IConstructor} from '../../../interfaces/IConstructor.js'

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

export abstract class AsymmetricEncryption {

    /**
     * 公钥操作方法对象
     */
    public get public(): AsymmetricEncryptionPublic {
        //todo
        throw new Error('not implemented')
    }

    /**
     * 私钥操作方法对象
     */
    public get private(): AsymmetricEncryptionPrivate {
        //todo
        throw new Error('not implemented')
    }

    /**
     * 加密数据
     * @param message
     */
    public encrypt(message: string): string {
        throw new Error('not implemented')
    }

    /**
     * 解密数据
     * @param encryptedMessage
     */
    public decrypt(encryptedMessage: string): string {
        throw new Error('not implemented')
    }

    /**
     * 生成密钥对
     */
    public static generateKeyPair<T extends AsymmetricEncryption>(this: IConstructor<T>) {
        throw new Error('not implemented')
    }
}

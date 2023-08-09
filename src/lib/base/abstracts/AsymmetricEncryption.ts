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

/**
 * const crypto = require('crypto');
 *
 * // 生成 RSA 密钥对
 * const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
 *   modulusLength: 2048,
 * });
 *
 * // 原始数据
 * const plaintext = 'Hello, RSA!';
 *
 * // 加密数据
 * const encrypted = crypto.publicEncrypt(publicKey, Buffer.from(plaintext));
 * console.log('Encrypted:', encrypted.toString('base64'));
 *
 * // 解密数据
 * const decrypted = crypto.privateDecrypt(privateKey, encrypted);
 * console.log('Decrypted:', decrypted.toString());
 *
 * // 签名数据
 * const sign = crypto.sign('sha256', Buffer.from(plaintext), privateKey);
 * console.log('Signature:', sign.toString('base64'));
 *
 * // 验证签名
 * const verify = crypto.verify('sha256', Buffer.from(plaintext), publicKey, sign);
 * console.log('Signature Verified:', verify);
 */

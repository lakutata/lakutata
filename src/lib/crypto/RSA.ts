import {AsymmetricEncryption, AsymmetricEncryptionKeyPair} from '../base/abstracts/AsymmetricEncryption.js'
import {createPrivateKey, createPublicKey, generateKeyPair, privateDecrypt, publicEncrypt, sign, verify} from 'crypto'
import {As} from '../../Utilities.js'

export interface RSAKeyPairOptions {
    /**
     * 密钥长度，以bit为单位
     * @default 1024
     */
    modulusLength?: number
    /**
     * 公钥指数
     * @default 0x10001
     */
    publicExponent?: number | undefined
    publicKeyEncoding?: {
        /**
         * @default pkcs1
         */
        type?: 'pkcs1' | 'spki'
        /**
         * @default pem
         */
        format?: 'pem' | 'der'
    }
    privateKeyEncoding?: {
        /**
         * @default pem
         */
        format?: 'pem' | 'der'
        /**
         * @default undefined
         */
        cipher?: string | undefined
        /**
         * @default undefined
         */
        passphrase?: string | undefined
        /**
         * @default pkcs1
         */
        type?: 'pkcs1' | 'pkcs8';
    }
}

export class RSA extends AsymmetricEncryption {

    protected createPrivateKey(privateKeyString: string): any {
        return createPrivateKey(privateKeyString)
    }

    protected createPublicKey(publicKeyString: string): any {
        return createPublicKey(publicKeyString)
    }

    protected decrypt(encryptedMessage: string): string {
        return privateDecrypt(this.privateKey, Buffer.from(encryptedMessage, 'base64')).toString()
    }

    protected encrypt(message: string): string {
        return publicEncrypt(this.publicKey, Buffer.from(message)).toString('base64')
    }

    protected async generateKeyPair(options?: RSAKeyPairOptions): Promise<AsymmetricEncryptionKeyPair> {
        return new Promise((resolve, reject) => {
            options = options ? options : {}
            options.modulusLength = options.modulusLength ? options.modulusLength : 1024
            options.publicExponent = options.publicExponent ? options.publicExponent : 0x10001
            options.publicKeyEncoding = options.publicKeyEncoding ? options.publicKeyEncoding : {}
            options.publicKeyEncoding.type = options.publicKeyEncoding.type ? options.publicKeyEncoding.type : 'pkcs1'
            options.publicKeyEncoding.format = options.publicKeyEncoding.format ? options.publicKeyEncoding.format : 'pem'
            options.privateKeyEncoding = options.privateKeyEncoding ? options.privateKeyEncoding : {}
            options.privateKeyEncoding.format = options.privateKeyEncoding.format ? options.privateKeyEncoding.format : 'pem'
            options.privateKeyEncoding.type = options.privateKeyEncoding.type ? options.privateKeyEncoding.type : 'pkcs1'
            options.privateKeyEncoding.cipher = options.privateKeyEncoding.cipher ? options.privateKeyEncoding.cipher : undefined
            options.privateKeyEncoding.passphrase = options.privateKeyEncoding.passphrase ? options.privateKeyEncoding.passphrase : undefined
            return generateKeyPair('rsa', As<any>(options), (err: Error | null, publicKey: string | Buffer, privateKey: string | Buffer): void => {
                if (err) return reject(err)
                return resolve({
                    publicKey: typeof publicKey === 'string' ? publicKey : publicKey.toString('base64'),
                    privateKey: typeof privateKey === 'string' ? privateKey : privateKey.toString('base64')
                })
            })
        })
    }

    protected sign(message: string): string {
        return sign('sha256', Buffer.from(message), this.privateKey).toString('base64')
    }

    protected verify(message: string, sign: string): boolean {
        return verify('sha256', Buffer.from(message), this.publicKey, Buffer.from(sign, 'base64'))
    }

    public static async generateKeyPair(options?: RSAKeyPairOptions): Promise<AsymmetricEncryptionKeyPair> {
        return super.generateKeyPair(options)
    }

}

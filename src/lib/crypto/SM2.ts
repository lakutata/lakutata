import {
    AsymmetricEncryption,
    AsymmetricEncryptionKeyPair, AsymmetricEncryptionPrivate,
    AsymmetricEncryptionPublic
} from '../base/abstracts/AsymmetricEncryption'
import {sm2} from 'sm-crypto-v2'
import {As} from '../../Helper'
import {PathLike} from 'fs'
import {IConstructor} from '../../interfaces/IConstructor'

async function initRNGPool(constructor: IConstructor<SM2>): Promise<void> {
    const metadataKey: string = '__$$RNGPoolInitialized'
    if (Reflect.getOwnMetadata(metadataKey, constructor)) return
    await sm2.initRNGPool()
    Reflect.defineMetadata(metadataKey, true, constructor)
}

export interface SM2KeyPairOptions {
    /**
     * 是否将公钥长度进行压缩，从默认公钥的130位压缩至66位
     * @default false
     */
    compressPublicKey?: boolean
}

export interface SM2Options {
    /**
     * 加密模式
     * 0 - C1C2C3
     * 1 - C1C3C2
     * @default 1
     */
    cipherMode?: 0 | 1
    /**
     * 是否在签名或验签当中使用SM3杂凑
     * @default true
     */
    signatureSM3Hash?: boolean
    /**
     * 在签名或验签当中使用的用户标识
     * @default undefined
     */
    signatureUserId?: string
}

export class SM2 extends AsymmetricEncryption {

    protected options: SM2Options = {
        cipherMode: 1,
        signatureSM3Hash: true,
        signatureUserId: undefined
    }

    protected createPrivateKey(privateKeyString: string): string {
        return privateKeyString
    }

    protected createPublicKey(publicKeyString: string): string {
        return publicKeyString
    }

    protected decrypt(encryptedMessage: string): string {
        return sm2.doDecrypt(Buffer.from(encryptedMessage, 'base64').toString('hex'), this.privateKey, this.options.cipherMode, {output: 'string'})
    }

    protected encrypt(message: string): string {
        return Buffer.from(sm2.doEncrypt(message, this.publicKey, this.options.cipherMode), 'hex').toString('base64')
    }

    protected async generateKeyPair(options?: SM2KeyPairOptions): Promise<AsymmetricEncryptionKeyPair> {
        const keyPair = sm2.generateKeyPairHex()
        let publicKey = keyPair.publicKey
        const privateKey = keyPair.privateKey
        if (options?.compressPublicKey) publicKey = sm2.compressPublicKeyHex(publicKey)
        return {
            publicKey: publicKey,
            privateKey: privateKey
        }
    }

    protected sign(message: string): string {
        return Buffer.from(sm2.doSignature(message, this.privateKey, {
            hash: this.options.signatureSM3Hash,
            publicKey: this.publicKey ? this.publicKey : undefined,
            userId: this.options.signatureUserId
        }), 'hex').toString('base64')
    }

    protected verify(message: string, sign: string): boolean {
        return sm2.doVerifySignature(message, Buffer.from(sign, 'base64').toString('hex'), this.publicKey, {
            hash: this.options.signatureSM3Hash,
            userId: this.options.signatureUserId
        })
    }

    public static async generateKeyPair(options?: SM2KeyPairOptions): Promise<AsymmetricEncryptionKeyPair> {
        await initRNGPool(this)
        return super.generateKeyPair(options)
    }

    public static async loadKeyPair<T extends AsymmetricEncryption = SM2>(keyPair: AsymmetricEncryptionKeyPair, options?: SM2Options): Promise<T> {
        await initRNGPool(this)
        return As<T>(super.loadKeyPair<SM2>(keyPair, options))
    }

    public static async loadPublicKey(inp: PathLike | string, options?: SM2Options): Promise<AsymmetricEncryptionPublic> {
        await initRNGPool(this)
        return super.loadPublicKey(inp, options)
    }

    public static async loadPrivateKey(inp: string | PathLike, options?: SM2Options): Promise<AsymmetricEncryptionPrivate> {
        await initRNGPool(this)
        return super.loadPrivateKey(inp, options)
    }
}

import {
    AsymmetricEncryption,
    AsymmetricEncryptionKeyPair, AsymmetricEncryptionPrivate,
    AsymmetricEncryptionPublic
} from '../base/abstracts/AsymmetricEncryption.js'
import {sm2} from 'sm-crypto-v2'
import {As} from '../../Utilities.js'
import {PathLike} from 'fs'
import {IConstructor} from '../../interfaces/IConstructor.js'

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

export class SM2 extends AsymmetricEncryption {

    protected createPrivateKey(privateKeyString: string): string {
        return privateKeyString
    }

    protected createPublicKey(publicKeyString: string): string {
        return publicKeyString
    }

    protected decrypt(encryptedMessage: string): string {
        return sm2.doDecrypt(encryptedMessage, this.privateKey, 0, {output: 'string'})
    }

    protected encrypt(message: string): string {
        return sm2.doEncrypt(message, this.publicKey, 0)
    }

    protected async generateKeyPair(options?: object): Promise<AsymmetricEncryptionKeyPair> {
        const {publicKey, privateKey} = sm2.generateKeyPairHex()
        return {
            publicKey: publicKey,
            privateKey: privateKey
        }
    }

    protected sign(message: string): string {
        return sm2.doSignature(message, this.privateKey)
    }

    protected verify(message: string, sign: string): boolean {
        return sm2.doVerifySignature(message, sign, this.publicKey)
    }

    public static async loadKeyPair<T extends AsymmetricEncryption = SM2>(keyPair: AsymmetricEncryptionKeyPair): Promise<T> {
        await initRNGPool(this)
        return As<T>(super.loadKeyPair<SM2>(keyPair))
    }

    public static async loadPublicKey(inp: PathLike | string): Promise<AsymmetricEncryptionPublic> {
        await initRNGPool(this)
        return super.loadPublicKey(inp)
    }

    public static async loadPrivateKey(inp: string | PathLike): Promise<AsymmetricEncryptionPrivate> {
        await initRNGPool(this)
        return super.loadPrivateKey(inp)
    }

    public static async generateKeyPair(options?: SM2KeyPairOptions): Promise<AsymmetricEncryptionKeyPair> {
        await initRNGPool(this)
        return super.generateKeyPair(options)
    }
}

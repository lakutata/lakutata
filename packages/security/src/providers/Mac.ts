import {DTO, Provider} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {HMAC, type HMACAlgorithm, VerifyHMAC} from '../functions/HMAC.js'
import {InvalidSignatureException} from '../exceptions/InvalidSignatureException.js'

/**
 * The signatures of the data (HMAC), with key rotation: the first key signs, every key verifies
 */
export class Mac extends Provider {

    /**
     * The keys: the first signs, all verify (put a new key first, and keep the previous ones until their signatures expire)
     */
    @Configurable(DTO.Array().items(DTO.String().min(16)).min(1).required())
    public readonly keys: string[]

    /**
     * The hash algorithm
     */
    @Configurable(DTO.String().valid('sha256', 'sha384', 'sha512').optional().default('sha256'))
    public readonly algorithm: HMACAlgorithm

    /**
     * The signature of data (base64url)
     * @param data
     */
    public sign(data: string | Uint8Array): string {
        return HMAC(data, this.keys[0], this.algorithm)
    }

    /**
     * Whether a signature is a signature of data by one of the keys
     * @param data
     * @param signature
     */
    public verify(data: string | Uint8Array, signature: string): boolean {
        //Every key is tried, to not reveal which one signed
        let valid: boolean = false
        for (const key of this.keys) valid = VerifyHMAC(data, signature, key, this.algorithm) || valid
        return valid
    }

    /**
     * A message with its signature: `message.signature`
     * @param message
     */
    public signMessage(message: string): string {
        return `${message}.${this.sign(message)}`
    }

    /**
     * The message of a signed message
     * @param signedMessage
     * @throws InvalidSignatureException when the signature is not valid (the message was changed, or signed by another key)
     */
    public unsignMessage(signedMessage: string): string {
        const index: number = signedMessage.lastIndexOf('.')
        if (index >= 0) {
            const message: string = signedMessage.slice(0, index)
            if (this.verify(message, signedMessage.slice(index + 1))) return message
        }
        throw new InvalidSignatureException('The signature of the message is not valid')
    }
}

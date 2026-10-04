import {DTO, Provider} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {HMAC, type HMACAlgorithm, VerifyHMAC} from '../functions/HMAC.js'
import {InvalidSignatureException} from '../exceptions/InvalidSignatureException.js'

/**
 * The message signing provider: signs data with an HMAC (SHA-256 by default) and verifies the signatures, with key
 * rotation (the first key signs, every key verifies). Use it to detect tampering with the data that goes through a
 * client: signed cookies, links, webhook payloads, tokens. A signature proves the data was signed by a holder of a key;
 * it does not hide the data (use {@link Crypt}) and is not a password hash (use {@link PasswordHash}).
 *
 * Declare it in the `providers` of the application (`{class: Mac, keys: [...]}`) and get it with `@Inject` or
 * `getObject()`; it is scoped, like every provider. The signatures are base64url strings without padding (43
 * characters with SHA-256, 64 with SHA-384, 86 with SHA-512) and never expire by themselves: put a time in the signed
 * data to limit their validity. Verification takes a constant time and tries every key, so it does not reveal which
 * key failed.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {GenerateKey, InvalidSignatureException, Mac} from 'lakutata/security'
 *
 * Application
 *     .run(() => ({
 *         id: 'links.app',
 *         name: 'Links',
 *         providers: {
 *             //The keys come from the environment: the new key first, the previous one kept to verify
 *             mac: {class: Mac, keys: [process.env.MAC_KEY ?? GenerateKey(), process.env.MAC_PREVIOUS_KEY ?? GenerateKey()]}
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const mac: Mac = await app.getObject('mac')
 *         //'user:42.<signature>'
 *         const token: string = mac.signMessage('user:42')
 *         try {
 *             console.log(mac.unsignMessage(token))
 *         } catch (error) {
 *             if (error instanceof InvalidSignatureException) console.log('Tampered token')
 *         }
 *         //A detached signature, sent alongside the body
 *         const signature: string = mac.sign('{"order":42}')
 *         console.log(mac.verify('{"order":42}', signature))
 *     })
 * ```
 */
export class Mac extends Provider {

    /**
     * The secret keys, at least one, each a string of at least 16 characters used as its UTF-8 bytes (it is not decoded
     * from base64). The first key signs, every key verifies: to rotate, put the new key first and keep the previous ones
     * while their signatures are still presented. Use random keys, such as the output of {@link GenerateKey}, not
     * passwords. Required.
     */
    @Configurable(DTO.Array().items(DTO.String().min(16)).min(1).required())
    public readonly keys: string[]

    /**
     * The hash function of the HMAC: `'sha256'`, `'sha384'` or `'sha512'`. Changing it invalidates every signature made
     * before.
     * @default 'sha256'
     */
    @Configurable(DTO.String().valid('sha256', 'sha384', 'sha512').optional().default('sha256'))
    public readonly algorithm: HMACAlgorithm

    /**
     * Sign data with the first key.
     * @param data The data to sign: a string (signed as its UTF-8 bytes) or bytes.
     * @returns The HMAC of the data, base64url encoded without padding.
     */
    public sign(data: string | Uint8Array): string {
        return HMAC(data, this.keys[0], this.algorithm)
    }

    /**
     * Check a detached signature made by {@link Mac.sign} with any of the keys, in a time that does not depend on the
     * signature or on the key that matches.
     * @param data The signed data, exactly as it was signed (same string or same bytes).
     * @param signature The signature to check, base64url as {@link Mac.sign} returns it.
     * @returns `true` when one of the keys signed the data; `false` otherwise (never throws on a malformed signature).
     */
    public verify(data: string | Uint8Array, signature: string): boolean {
        //Every key is tried, to not reveal which one signed
        let valid: boolean = false
        for (const key of this.keys) valid = VerifyHMAC(data, signature, key, this.algorithm) || valid
        return valid
    }

    /**
     * Sign a message and append the signature: `<message>.<signature>`. The message is not encrypted: anyone can read
     * it, only a key holder can change it.
     * @param message The message to sign; it may contain dots (the signature follows the last one).
     * @returns The signed message, to read back with {@link Mac.unsignMessage}.
     */
    public signMessage(message: string): string {
        return `${message}.${this.sign(message)}`
    }

    /**
     * Check a message signed by {@link Mac.signMessage} with any of the keys, and return it without its signature.
     * @param signedMessage The signed message, `<message>.<signature>`.
     * @returns The original message.
     * @throws {InvalidSignatureException} When the signed message has no dot, or its signature is not valid (the message
     * or the signature was changed, or none of the keys signed it).
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

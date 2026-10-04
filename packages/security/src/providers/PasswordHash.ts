import * as bcrypt from '../lib/bcrypt/index.js'
import {DTO, Provider} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {PasswordTooLongException} from '../exceptions/PasswordTooLongException.js'

/**
 * The largest password bcrypt hashes entirely, in UTF-8 bytes (it ignores the following bytes)
 */
const MAX_PASSWORD_BYTES: number = 72

/**
 * A bcrypt hash: its variant, its cost (4 to 31), then its salt and its digest in bcrypt's base64 alphabet
 */
const BCRYPT_HASH: RegExp = /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/

/**
 * The password hashing provider: hashes passwords with bcrypt (a new random 16-byte salt per hash, the `$2b$` variant)
 * and checks a password against a stored hash. Use it for user passwords: bcrypt is deliberately slow, so a stolen hash
 * is costly to brute-force. Do not use it to hash tokens or keys (use {@link HMAC}) or to encrypt (use {@link Crypt}).
 *
 * Declare it in the `providers` of the application (`{class: PasswordHash, saltRounds: 12}`) and get it with `@Inject`
 * or `getObject()`; it is scoped, like every provider. A hash is a 60-character string (`$2b$10$` then the salt and the
 * digest) holding its own salt and cost, so it is stored as is, in one column, and {@link PasswordHash.validate} needs
 * nothing else; hashes of another cost (or the `$2a$`/`$2y$` variants of other bcrypt libraries) still validate.
 *
 * bcrypt only reads the first 72 bytes of a password (UTF-8): {@link PasswordHash.hash} rejects a longer password with
 * {@link PasswordTooLongException} rather than hashing its prefix, and {@link PasswordHash.validate} gives `false` for
 * it. bcrypt runs in JavaScript on the main thread, in
 * slices of at most 100 ms between which the other requests proceed; a hash or a validation costs about 60 ms of CPU
 * at cost 10 on a current CPU, doubling with each extra round.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {PasswordHash, PasswordTooLongException} from 'lakutata/provider/passwordHash'
 *
 * Application
 *     .run(() => ({
 *         id: 'auth.app',
 *         name: 'Auth',
 *         providers: {
 *             //Each extra round doubles the cost of a hash
 *             passwordHash: {class: PasswordHash, saltRounds: 12}
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const passwordHash: PasswordHash = await app.getObject('passwordHash')
 *         try {
 *             //Stored as is: the hash holds its salt and its cost
 *             const hash: string = await passwordHash.hash('correct horse battery staple')
 *             console.log(await passwordHash.validate('correct horse battery staple', hash))
 *             console.log(await passwordHash.validate('wrong password', hash))
 *         } catch (error) {
 *             if (error instanceof PasswordTooLongException) console.log('Choose a password of 72 bytes at most')
 *         }
 *     })
 * ```
 */
export class PasswordHash extends Provider {

    /**
     * The bcrypt cost of the new hashes, as a base-2 logarithm: a hash runs 2^saltRounds iterations, so each extra round
     * doubles the time of {@link PasswordHash.hash} (and of {@link PasswordHash.validate} on the hashes it makes). An
     * integer from 4 (bcrypt's minimum) to 31. Raise it as far as the login latency allows (12 is a common choice); the
     * existing hashes keep the cost they were made with.
     * @default 10
     */
    @Configurable(DTO.Number().integer().min(4).max(31).optional().default(10))
    public readonly saltRounds: number

    /**
     * A new random bcrypt salt with the configured cost (`$2b$10$` and 22 characters), different at each read.
     * @deprecated Not needed: {@link PasswordHash.hash} generates a salt for each hash, and the hash holds it for
     * {@link PasswordHash.validate}.
     */
    public get salt(): string {
        return bcrypt.genSaltSync(this.saltRounds)
    }

    /**
     * Hash a password with bcrypt, a new random salt and the configured {@link PasswordHash.saltRounds}. Two hashes of
     * the same password differ: compare them with {@link PasswordHash.validate}, never with `===`.
     * @param password The password, as typed by the user: at most 72 bytes once encoded in UTF-8 (72 ASCII
     * characters, fewer with accented letters or emoji). An empty password is hashed too: reject it beforehand if needed.
     * @returns The 60-character bcrypt hash (`$2b$<cost>$<salt><digest>`, bcrypt's own base64 alphabet), to store as is.
     * @throws {PasswordTooLongException} When the password is longer than 72 bytes in UTF-8.
     */
    public async hash(password: string): Promise<string> {
        //bcrypt ignores the bytes beyond the 72nd: a longer password would match any password sharing its 72 first bytes
        if (bcrypt.truncates(password)) throw new PasswordTooLongException('The password is longer than {max} bytes', {max: MAX_PASSWORD_BYTES})
        return await bcrypt.hash(password, this.saltRounds)
    }

    /**
     * Check a password against a hash made by {@link PasswordHash.hash} (or by another bcrypt library: `$2a$`, `$2b$`,
     * `$2y$`), with the salt and the cost the hash holds; the final comparison takes a constant time.
     * @param password The password to check. A password longer than 72 bytes in UTF-8 gives `false`:
     * {@link PasswordHash.hash} refuses it, so no hash can be its own.
     * @param hash The stored bcrypt hash. A value which is not a bcrypt hash (not 60 characters long, a wrong prefix,
     * cost or alphabet) gives `false`.
     * @returns `true` when the password matches the hash.
     */
    public async validate(password: string, hash: string): Promise<boolean> {
        //Never thrown on a malformed hash: a hash is data read from storage
        if (typeof hash !== 'string' || !BCRYPT_HASH.test(hash)) return false
        //bcrypt would compare the first 72 bytes only: a longer password matches no hash made by hash()
        if (bcrypt.truncates(password)) return false
        return await bcrypt.compare(password, hash)
    }

}

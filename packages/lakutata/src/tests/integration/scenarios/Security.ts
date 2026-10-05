import assert from 'node:assert'
import {Application} from '../../../exports/Lakutata.js'
import {BuildEntrypoints, Controller, type ActionInvocation, type HTTPContext, type Next} from '../../../exports/EntrypointComponent.js'
import {ExpressHTTPEntrypoint, JSONEnvelope} from '../../../exports/ExpressAdapter.js'
import {POST} from '../../../exports/CTRLDecorators.js'
import {Inject} from '../../../exports/DIDecorators.js'
import {
    Crypt,
    DecryptByKey,
    DecryptByPassword,
    DecryptionFailedException,
    EncryptByKey,
    EncryptByPassword,
    GenerateSecret,
    HMAC,
    InvalidSignatureException,
    Mac,
    PasswordTooLongException,
    TimingSafeEqual,
    VerifyHMAC
} from '../../../exports/Security.js'
import {PasswordHash} from '../../../exports/PasswordHashProvider.js'
import {FreePort, RunChecks} from '../support/Scenario.js'

/**
 * The key of the webhooks, shared with their sender
 */
const WEBHOOK_KEY: string = GenerateSecret()

/**
 * The webhooks are signed: HMAC of their body in the header x-signature
 */
async function VerifyWebhook(invocation: ActionInvocation, next: Next): Promise<unknown> {
    const context: HTTPContext = invocation.context as HTTPContext
    const signature: unknown = context.request.headers['x-signature']
    if (typeof signature !== 'string' || !VerifyHMAC(JSON.stringify(context.data), signature, WEBHOOK_KEY)) throw new InvalidSignatureException('The signature of the webhook is not valid')
    return await next()
}

class WebhookController extends Controller {
    @Inject('crypt')
    protected readonly crypt: Crypt

    @POST('/webhooks/payment')
    public async payment(input: { order: number, amount: number }): Promise<{ order: number, receipt: string }> {
        //The receipt is encrypted for the storage
        return {order: input.order, receipt: this.crypt.encrypt(JSON.stringify(input))}
    }
}

const [port, oldKey, newKey] = [await FreePort(), GenerateSecret(), GenerateSecret()]

Application
    .run(() => ({
        id: 'integration.security',
        name: 'IntegrationSecurity',
        components: {
            log: {level: 'warn'},
            entrypoint: BuildEntrypoints({
                controllers: [WebhookController],
                middlewares: [VerifyWebhook],
                http: ExpressHTTPEntrypoint({port: port, host: '127.0.0.1', respond: JSONEnvelope({errorStatus: 200})})
            })
        },
        providers: {
            //The keys rotated: the first one encrypts and signs, all of them decrypt and verify
            crypt: {class: Crypt, keys: [newKey, oldKey]},
            oldCrypt: {class: Crypt, keys: [oldKey]},
            mac: {class: Mac, keys: [newKey, oldKey], algorithm: 'sha512'},
            oldMac: {class: Mac, keys: [oldKey]},
            passwordHash: {class: PasswordHash, saltRounds: 4}
        },
        bootstrap: ['entrypoint']
    }))
    .onLaunched((app: Application): Promise<void> => RunChecks(app, async (check): Promise<void> => {
        const webhook = async (body: Record<string, unknown>, signature?: string): Promise<any> => await (await fetch(`http://127.0.0.1:${port}/webhooks/payment`, {
            method: 'POST',
            headers: {'content-type': 'application/json', ...(signature ? {'x-signature': signature} : {})},
            body: JSON.stringify(body)
        })).json()

        await check('the keys generated are random and of their size', (): void => {
            assert.strictEqual(Buffer.from(GenerateSecret(), 'base64url').length, 32)
            assert.strictEqual(Buffer.from(GenerateSecret(64), 'base64url').length, 64)
            assert.notStrictEqual(GenerateSecret(), GenerateSecret())
        })

        await check('the data are signed and verified by HMAC, constant in time', (): void => {
            const signature: string = HMAC('payload', WEBHOOK_KEY)
            assert.strictEqual(signature, HMAC('payload', WEBHOOK_KEY))
            assert.ok(VerifyHMAC('payload', signature, WEBHOOK_KEY))
            assert.ok(!VerifyHMAC('payload!', signature, WEBHOOK_KEY))
            assert.ok(!VerifyHMAC('payload', signature, GenerateSecret()))
            assert.notStrictEqual(HMAC('payload', WEBHOOK_KEY, 'sha512'), signature)
            assert.ok(TimingSafeEqual('abc', 'abc'))
            assert.ok(!TimingSafeEqual('abc', 'abd'))
            assert.ok(!TimingSafeEqual('abc', 'abcd'))
        })

        await check('a middleware accepts the webhooks signed only', async (): Promise<void> => {
            const body: Record<string, unknown> = {order: 7, amount: 42}
            const accepted = await webhook(body, HMAC(JSON.stringify(body), WEBHOOK_KEY))
            assert.strictEqual(accepted.errno, null, JSON.stringify(accepted))
            assert.strictEqual(accepted.data.order, 7)
            assert.strictEqual((await webhook(body, HMAC(JSON.stringify({...body, amount: 4200}), WEBHOOK_KEY))).errno, 'E_INVALID_SIGNATURE')
            assert.strictEqual((await webhook(body)).errno, 'E_INVALID_SIGNATURE')
        })

        await check('the Crypt provider encrypts with its first key, decrypts with all its keys', async (): Promise<void> => {
            const crypt: Crypt = await app.getObject<Crypt>('crypt')
            const oldCrypt: Crypt = await app.getObject<Crypt>('oldCrypt')
            const encrypted: string = crypt.encrypt('secret')
            assert.notStrictEqual(encrypted, crypt.encrypt('secret'))
            assert.strictEqual(crypt.decryptString(encrypted), 'secret')
            //The data encrypted with the previous key are still decrypted
            assert.strictEqual(crypt.decryptString(oldCrypt.encrypt('old secret')), 'old secret')
            //The previous key alone does not decrypt the new data
            assert.throws((): unknown => oldCrypt.decrypt(encrypted), DecryptionFailedException)
            assert.throws((): unknown => crypt.decrypt(`${encrypted.slice(0, -4)}AAAA`), DecryptionFailedException)
        })

        await check('the receipts encrypted by the action are decrypted by the provider', async (): Promise<void> => {
            const body: Record<string, unknown> = {order: 8, amount: 1}
            const receipt: string = (await webhook(body, HMAC(JSON.stringify(body), WEBHOOK_KEY))).data.receipt
            assert.deepStrictEqual(JSON.parse((await app.getObject<Crypt>('crypt')).decryptString(receipt)), body)
        })

        await check('the Mac provider signs with its first key, verifies with all its keys, unsigns the messages signed', async (): Promise<void> => {
            const mac: Mac = await app.getObject<Mac>('mac')
            const oldMac: Mac = await app.getObject<Mac>('oldMac')
            assert.ok(mac.verify('data', mac.sign('data')))
            assert.ok(!mac.verify('data!', mac.sign('data')))
            const signed: string = mac.signMessage('user:42')
            assert.strictEqual(mac.unsignMessage(signed), 'user:42')
            assert.throws((): unknown => mac.unsignMessage(signed.replace('user:42', 'user:43')), InvalidSignatureException)
            assert.throws((): unknown => mac.unsignMessage('user:42'), InvalidSignatureException)
            //Rotation, with the algorithm of each provider
            assert.ok(new Set([mac.sign('data').length, oldMac.sign('data').length]).size === 2)
            assert.throws((): unknown => mac.unsignMessage(oldMac.signMessage('user:42')), InvalidSignatureException)
        })

        await check('the data are encrypted by key (keys rotated) and by password', async (): Promise<void> => {
            const encrypted: string = EncryptByKey('by key', oldKey)
            assert.strictEqual(DecryptByKey(encrypted, [newKey, oldKey]).toString(), 'by key')
            assert.throws((): unknown => DecryptByKey(encrypted, newKey), DecryptionFailedException)
            const byPassword: string = await EncryptByPassword('by password', 'correct horse')
            assert.strictEqual((await DecryptByPassword(byPassword, 'correct horse')).toString(), 'by password')
            await assert.rejects(DecryptByPassword(byPassword, 'wrong horse'), DecryptionFailedException)
        })

        await check('the passwords are hashed with their rounds, the passwords bcrypt would truncate rejected', async (): Promise<void> => {
            const passwordHash: PasswordHash = await app.getObject<PasswordHash>('passwordHash')
            const hash: string = await passwordHash.hash('correct horse')
            assert.match(hash, /^\$2[aby]\$04\$/)
            assert.ok(await passwordHash.validate('correct horse', hash))
            assert.ok(!await passwordHash.validate('correct horse!', hash))
            await assert.rejects(passwordHash.hash('x'.repeat(73)), PasswordTooLongException)
        })
    }))
    .onFatalException((error: Error): number => {
        console.error(error)
        return 1
    })

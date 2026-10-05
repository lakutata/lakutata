import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {
    Crypt,
    decryptByKey,
    decryptByPassword,
    DecryptionFailedException,
    encryptByKey,
    encryptByPassword,
    generateSecret,
    hmac,
    InvalidSignatureException,
    Mac,
    constantTimeEqual,
    verifyHMAC
} from '../exports/Security.js'

const OLD_KEY: string = generateSecret()
const NEW_KEY: string = generateSecret()

/**
 * The encrypted data with one byte changed
 * @param encrypted
 * @param index
 */
function tamper(encrypted: string, index: number): string {
    const buffer: Buffer = Buffer.from(encrypted, 'base64url')
    buffer[index] ^= 1
    return buffer.toString('base64url')
}

describe('Security functions', (): void => {

    it('compare in constant time', (): void => {
        assert.ok(constantTimeEqual('secret', 'secret'))
        assert.ok(constantTimeEqual(Buffer.from('secret'), 'secret'))
        assert.ok(!constantTimeEqual('secret', 'secreT'))
        assert.ok(!constantTimeEqual('secret', 'secret-longer'))
        assert.ok(constantTimeEqual('', ''))
    })

    it('generate random keys', (): void => {
        assert.match(generateSecret(), /^[\w-]{43}$/)
        assert.strictEqual(Buffer.from(generateSecret(64), 'base64url').length, 64)
        assert.notStrictEqual(generateSecret(), generateSecret())
    })

    it('sign and verify data', (): void => {
        const signature: string = hmac('data', OLD_KEY)
        assert.strictEqual(signature, hmac(Buffer.from('data'), OLD_KEY))
        assert.ok(verifyHMAC('data', signature, OLD_KEY))
        assert.ok(!verifyHMAC('Data', signature, OLD_KEY))
        assert.ok(!verifyHMAC('data', signature, NEW_KEY))
        assert.ok(!verifyHMAC('data', signature, OLD_KEY, 'sha512'))
        assert.strictEqual(Buffer.from(hmac('data', OLD_KEY, 'sha512'), 'base64url').length, 64)
    })

    it('encrypt and decrypt with keys', (): void => {
        const encrypted: string = encryptByKey('données secrètes', OLD_KEY)
        assert.notStrictEqual(encrypted, encryptByKey('données secrètes', OLD_KEY))
        assert.strictEqual(decryptByKey(encrypted, OLD_KEY).toString(), 'données secrètes')
        //Key rotation: the keys are tried in order
        assert.strictEqual(decryptByKey(encrypted, [NEW_KEY, OLD_KEY]).toString(), 'données secrètes')
        assert.throws((): unknown => decryptByKey(encrypted, NEW_KEY), DecryptionFailedException)
        //Any change is detected: the header, the tag and the ciphertext
        for (const index of [0, 5, 20, 35, 50]) assert.throws((): unknown => decryptByKey(tamper(encrypted, index), OLD_KEY), {errno: 'E_DECRYPTION_FAILED'})
        assert.throws((): unknown => decryptByKey('not encrypted', OLD_KEY), DecryptionFailedException)
        assert.deepStrictEqual(decryptByKey(encryptByKey(Buffer.from([0, 1, 2]), OLD_KEY), OLD_KEY), Buffer.from([0, 1, 2]))
        assert.strictEqual(decryptByKey(encryptByKey('', OLD_KEY), OLD_KEY).toString(), '')
    })

    it('refuse an empty key', (): void => {
        for (const empty of ['', new Uint8Array(0)]) {
            assert.throws((): unknown => hmac('data', empty), {name: 'RangeError', message: 'The key is empty'})
            assert.throws((): unknown => verifyHMAC('data', hmac('data', OLD_KEY), empty), RangeError)
            assert.throws((): unknown => encryptByKey('data', empty), RangeError)
            assert.throws((): unknown => decryptByKey(encryptByKey('data', OLD_KEY), empty), RangeError)
            //Among the keys too, even after the one decrypting
            assert.throws((): unknown => decryptByKey(encryptByKey('data', OLD_KEY), [OLD_KEY, empty]), RangeError)
        }
    })

    it('encrypt and decrypt with passwords', async (): Promise<void> => {
        const encrypted: string = await encryptByPassword('secret', 'correct horse battery staple')
        assert.strictEqual((await decryptByPassword(encrypted, 'correct horse battery staple')).toString(), 'secret')
        await assert.rejects(decryptByPassword(encrypted, 'wrong password'), DecryptionFailedException)
        await assert.rejects(decryptByPassword(tamper(encrypted, 40), 'correct horse battery staple'), DecryptionFailedException)
        //The versions are not mixed
        assert.throws((): unknown => decryptByKey(encrypted, 'correct horse battery staple'), DecryptionFailedException)
        await assert.rejects(decryptByPassword(encryptByKey('secret', 'correct horse battery staple'), 'correct horse battery staple'), DecryptionFailedException)
    })
})

describe('Security providers', (): void => {

    it('sign messages with key rotation', async (): Promise<void> => {
        const container: Container = new Container()
        const oldMac: Mac = await container.set(Mac, {keys: [OLD_KEY]})
        const rotatedMac: Mac = await container.set(Mac, {keys: [NEW_KEY, OLD_KEY]})
        const newMac: Mac = await container.set(Mac, {keys: [NEW_KEY]})
        assert.strictEqual(oldMac.algorithm, 'sha256')
        const signed: string = oldMac.signMessage('user.42')
        assert.strictEqual(oldMac.unsignMessage(signed), 'user.42')
        assert.strictEqual(rotatedMac.unsignMessage(signed), 'user.42')
        assert.throws((): unknown => newMac.unsignMessage(signed), InvalidSignatureException)
        //The first key signs
        assert.strictEqual(rotatedMac.sign('data'), newMac.sign('data'))
        assert.ok(rotatedMac.verify('data', oldMac.sign('data')))
        assert.throws((): unknown => oldMac.unsignMessage('user.43' + signed.slice(signed.lastIndexOf('.'))), {errno: 'E_INVALID_SIGNATURE'})
        assert.throws((): unknown => oldMac.unsignMessage('no signature'), InvalidSignatureException)
        const sha512: Mac = await container.set(Mac, {keys: [OLD_KEY], algorithm: 'sha512'})
        assert.ok(!oldMac.verify('data', sha512.sign('data')))
        await container.destroy()
    })

    it('encrypt data with key rotation', async (): Promise<void> => {
        const container: Container = new Container()
        const oldCrypt: Crypt = await container.set(Crypt, {keys: [OLD_KEY]})
        const rotatedCrypt: Crypt = await container.set(Crypt, {keys: [NEW_KEY, OLD_KEY]})
        const newCrypt: Crypt = await container.set(Crypt, {keys: [NEW_KEY]})
        const encrypted: string = oldCrypt.encrypt('secret')
        assert.strictEqual(rotatedCrypt.decryptString(encrypted), 'secret')
        assert.throws((): unknown => newCrypt.decrypt(encrypted), DecryptionFailedException)
        //The first key encrypts
        assert.strictEqual(newCrypt.decryptString(rotatedCrypt.encrypt('secret')), 'secret')
        assert.deepStrictEqual(oldCrypt.decrypt(oldCrypt.encrypt(Buffer.from([1, 2]))), Buffer.from([1, 2]))
        await container.destroy()
    })

    it('require keys of 16 characters at least', async (): Promise<void> => {
        const container: Container = new Container()
        await assert.rejects(container.set(Mac))
        await assert.rejects(container.set(Mac, {keys: []}))
        await assert.rejects(container.set(Crypt, {keys: ['too short']}))
        await assert.rejects(container.set(Mac, {keys: [OLD_KEY], algorithm: 'md5'}))
        await container.destroy()
    })
})

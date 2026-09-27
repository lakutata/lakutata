import {describe, it} from 'node:test'
import assert from 'node:assert'
import * as bcrypt from '../lib/bcrypt/index.js'
import {Container} from '@lakutata/core'
import {PasswordHash, PasswordTooLongException} from '../exports/Security.js'

describe('PasswordHash', (): void => {

    it('hashes and validates passwords', async (): Promise<void> => {
        const container: Container = new Container()
        const passwordHash: PasswordHash = await container.set(PasswordHash, {saltRounds: 4})
        assert.strictEqual(passwordHash.saltRounds, 4)
        const hash: string = await passwordHash.hash('secret')
        assert.match(hash, /^\$2[aby]\$04\$/)
        assert.ok(await passwordHash.validate('secret', hash))
        assert.ok(!(await passwordHash.validate('wrong', hash)))
        await container.destroy()
    })

    it('hashes every password with a new salt', async (): Promise<void> => {
        const container: Container = new Container()
        const passwordHash: PasswordHash = await container.set(PasswordHash, {saltRounds: 4})
        const first: string = await passwordHash.hash('secret')
        const second: string = await passwordHash.hash('secret')
        assert.notStrictEqual(first, second)
        assert.notStrictEqual(bcrypt.getSalt(first), bcrypt.getSalt(second))
        assert.ok(await passwordHash.validate('secret', first) && await passwordHash.validate('secret', second))
        //The hashes of a shared salt (before the fix) are still validated
        const shared: string = bcrypt.genSaltSync(4)
        assert.ok(await passwordHash.validate('secret', bcrypt.hashSync('secret', shared)))
        //A hash of other rounds is validated with its own rounds
        assert.ok(await passwordHash.validate('secret', bcrypt.hashSync('secret', 5)))
        //Deprecated: a new salt on every read
        assert.notStrictEqual(passwordHash.salt, passwordHash.salt)
        assert.strictEqual(bcrypt.getRounds(passwordHash.salt), 4)
        await container.destroy()
    })

    it('rejects the passwords longer than 72 bytes', async (): Promise<void> => {
        const container: Container = new Container()
        const passwordHash: PasswordHash = await container.set(PasswordHash, {saltRounds: 4})
        assert.ok(await passwordHash.validate('x'.repeat(72), await passwordHash.hash('x'.repeat(72))))
        await assert.rejects(passwordHash.hash('x'.repeat(73)), PasswordTooLongException)
        //Bytes, not characters: 25 characters of 3 bytes
        await assert.rejects(passwordHash.hash('密'.repeat(25)), {errno: 'E_PASSWORD_TOO_LONG', message: 'The password is longer than 72 bytes'})
        await container.destroy()
    })

    it('defaults to 10 salt rounds, and validates the rounds', async (): Promise<void> => {
        const container: Container = new Container()
        assert.strictEqual((await container.set(PasswordHash)).saltRounds, 10)
        await assert.rejects(container.set(PasswordHash, {saltRounds: 0}))
        await assert.rejects(container.set(PasswordHash, {saltRounds: 32}))
        await container.destroy()
    })
})

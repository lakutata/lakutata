import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {PasswordHash} from '../exports/Security.js'

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

    it('defaults to 10 salt rounds, and validates the rounds', async (): Promise<void> => {
        const container: Container = new Container()
        assert.strictEqual((await container.set(PasswordHash)).saltRounds, 10)
        await assert.rejects(container.set(PasswordHash, {saltRounds: 0}))
        await container.destroy()
    })
})

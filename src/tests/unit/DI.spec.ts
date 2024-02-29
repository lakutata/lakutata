import {describe, it} from 'node:test'
import {Container} from '../../lib/core/Container.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import assert from 'node:assert'

class RegistrationTestClass extends BaseObject {
    public foo(): string {
        return 'bar'
    }
}

describe('DI Test', async function (): Promise<void> {
    const container: Container = new Container()

    await it('add named(symbol) registration', async (): Promise<void> => {
        const symbol: symbol = Symbol('test')
        await container.load({[symbol]: RegistrationTestClass})
        const registration: RegistrationTestClass = await container.get<RegistrationTestClass>(symbol)
        assert.equal(registration.foo(), 'bar')
    })
    await it('add named(string) registration', async (): Promise<void> => {
        await container.load({test: RegistrationTestClass})
        const registration: RegistrationTestClass = await container.get<RegistrationTestClass>('test')
        assert.equal(registration.foo(), 'bar')
    })
    await it('add unnamed(constructor) registration', async (): Promise<void> => {
        //TODO
    })
})

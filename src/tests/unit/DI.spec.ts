import {describe, it} from 'node:test'
import {Container} from '../../lib/core/Container.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import assert from 'node:assert'
import {Autoload} from '../../decorators/di/Autoload.js'

const instanceSet: Set<BaseObject> = new Set()

class RegistrationTestClass extends BaseObject {

    protected async init(): Promise<void> {
    }

    protected async __init(): Promise<void> {
        instanceSet.add(this)
    }

    protected async destroy(): Promise<void> {
    }

    protected async __destroy(): Promise<void> {
        instanceSet.delete(this)
    }

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
    await it('get autoload registration', async (): Promise<void> => {
        @Autoload()
        class AutoloadRegistrationTestClass extends RegistrationTestClass {
            public foo(): string {
                return 'autoload'
            }
        }

        const registration: AutoloadRegistrationTestClass = await container.get<AutoloadRegistrationTestClass>(AutoloadRegistrationTestClass)
        assert.equal(registration.foo(), 'autoload')
    })
    await it('create sub container', async (): Promise<void> => {
        const subContainer: Container = container.createScope()
        assert.notEqual(subContainer, container)
        await it('get root container registration in sub container', async (): Promise<void> => {
            const registration: RegistrationTestClass = await subContainer.get<RegistrationTestClass>('test')
            assert.equal(registration.foo(), 'bar')
        })
        await it('add registration to sub container', async (): Promise<void> => {
            await subContainer.load({
                subTest: class extends RegistrationTestClass {
                    public foo(): string {
                        return 'sub-bar'
                    }
                }
            })
            const registration: RegistrationTestClass = await subContainer.get<RegistrationTestClass>('subTest')
            assert.equal(registration.foo(), 'sub-bar')
        })
        await it('root container should not allowed access registrations inside sub container', async (): Promise<void> => {
            assert.equal(container.has('subTest'), false)
        })
    })

    await it('all registration instance should be destroyed after root container destroyed', async (): Promise<void> => {
        await container.destroy()
        assert.equal(instanceSet.size, 0)
    })

})

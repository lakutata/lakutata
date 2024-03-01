import {describe, it} from 'node:test'
import {BaseObject} from '../../lib/base/BaseObject.js'
import assert from 'node:assert'
import {Container} from '../../lib/core/Container.js'
import {MethodNotFoundException} from '../../exceptions/MethodNotFoundException.js'

let initialized: boolean = false
let destroyed: boolean = false
const TORIRC_SYMBOL: symbol = Symbol('TORIRC')

class TestObject extends BaseObject {
    protected async init(): Promise<void> {
        initialized = true
    }

    protected async destroy(): Promise<void> {
        destroyed = true
    }

    protected test(): string {
        return 'test'
    }

    public async getTestObjectInRootContainer(): Promise<TestObjectRegisteredInRootContainer[]> {
        return [
            await this.getObject(TestObjectRegisteredInRootContainer),
            await this.getObject('TORIRC'),
            await this.getObject(TORIRC_SYMBOL)
        ]
    }
}

class TestObjectRegisteredInRootContainer extends BaseObject {
}

describe('BaseObject Test', async function (): Promise<void> {
    const rootContainer: Container = new Container()
    await rootContainer.load([
        TestObjectRegisteredInRootContainer,
        {id: 'TORIRC', class: TestObjectRegisteredInRootContainer},
        {id: TORIRC_SYMBOL, class: TestObjectRegisteredInRootContainer}
    ])
    await it('get class name by static getter className', async (): Promise<void> => {
        assert.equal(TestObject.className, TestObject.name)
    })
    const instance: TestObject = await rootContainer.build(TestObject)
    await it('get class name by instance getter className', async (): Promise<void> => {
        assert.equal(instance.className, TestObject.name)
    })
    await it('protect async initializer method invoked', async (): Promise<void> => {
        assert.equal(initialized, true)
    })
    await it('two object should have different objectId', async (): Promise<void> => {
        const obj1: TestObject = await rootContainer.build(TestObject)
        const obj2: TestObject = await rootContainer.build(TestObject)
        assert.notEqual(obj1.objectId(), obj2.objectId())
    })
    await it('set instance\'s property should works', async (): Promise<void> => {
        assert.equal(instance.getProperty('testProp'), undefined)
        assert.equal(instance.hasProperty('testProp'), false)
        instance.setProperty('testProp', 'ok')
        assert.equal(instance.hasProperty('testProp'), true)
        assert.equal(instance.getProperty('testProp'), 'ok')
    })
    await it('get instance\'s method should works', async (): Promise<void> => {
        assert.equal(instance.hasMethod('notExist'), false)
        assert.equal(instance.getMethod('test')(), 'test')
    })
    await it('get instance\'s not exist method should throw error when second argument throwExceptionIfNotFound set to true', async (): Promise<void> => {
        assert.throws(() => instance.getMethod('notExist', true), MethodNotFoundException)
    })
    await it('get object should access its parent container', async (): Promise<void> => {
        await assert.doesNotReject(() => instance.getTestObjectInRootContainer())
    })
    await it('protect async destroy method invoked', async (): Promise<void> => {
        await rootContainer.destroy()
        assert.equal(destroyed, true)
    })
})

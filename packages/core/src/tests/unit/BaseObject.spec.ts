import {describe, it} from 'node:test'
import {BaseObject} from '../../lib/base/BaseObject.js'
import assert from 'node:assert'
import {Container} from '../../lib/core/Container.js'
import {MethodNotFoundException} from '../../exceptions/MethodNotFoundException.js'
import {isPromiseLike} from '@lakutata/utils/IsPromiseLike'
import {OBJECT_ID} from '../../options/LoadObjectOptions.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {DTO} from '../../lib/dto/DTO.js'

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

class ConfiguredObject extends BaseObject {

    @Configurable(DTO.Number().optional().default(80))
    public readonly port: number

    public records(): Record<string, any> {
        return this.getConfigurableRecords()
    }
}

await describe('BaseObject Test', async function (): Promise<void> {
    const rootContainer: Container = new Container()
    await rootContainer.load([
        TestObjectRegisteredInRootContainer,
        {[OBJECT_ID]: 'TORIRC', class: TestObjectRegisteredInRootContainer},
        {[OBJECT_ID]: TORIRC_SYMBOL, class: TestObjectRegisteredInRootContainer}
    ])
    await it('new BaseObject\'s constructor returns promise-like object', async (): Promise<void> => {
        assert.equal(isPromiseLike(new TestObject({})), true)
    })
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
        assert.notEqual(obj1.$uuid, obj2.$uuid)
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
    await it('calls a method got by its name without a misleading frame in the stack of its errors', async (): Promise<void> => {
        class FailingObject extends BaseObject {
            public fail(): void {
                throw new Error('failed')
            }
        }

        const failing: FailingObject = await rootContainer.build(FailingObject)
        let stack: string = ''
        try {
            failing.getMethod('fail')()
        } catch (error: unknown) {
            stack = (error as Error).stack ?? ''
        }
        assert.ok(stack.includes('callMethod'), stack)
        //V8 named the anonymous function after the code below it: "at MethodNotFoundException.methodName"
        assert.ok(!stack.includes('MethodNotFoundException'), stack)
    })
    await it('get object should access its parent container', async (): Promise<void> => {
        await assert.doesNotReject(() => instance.getTestObjectInRootContainer())
    })
    await it('gets the options the object was created with, as they were given', async (): Promise<void> => {
        const configured: ConfiguredObject = await rootContainer.build(ConfiguredObject, {channel: 'http'})
        assert.strictEqual(configured.port, 80)
        assert.deepStrictEqual(configured.records(), {channel: 'http'})
        configured.records().channel = 'cli'
        assert.deepStrictEqual(configured.records(), {channel: 'http'})
    })
    await it('protect async destroy method invoked', async (): Promise<void> => {
        await rootContainer.destroy()
        assert.equal(destroyed, true)
    })
})

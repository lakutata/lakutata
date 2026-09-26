import {describe, it} from 'node:test'
import assert from 'node:assert'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {Component} from '../../lib/core/Component.js'
import {Container} from '../../lib/core/Container.js'
import {SetDestroyErrorReporter} from '../../lib/foundation/DestroyErrorReporter.js'

/**
 * Resolve with the given promise's outcome, or with 'timeout' if it does not settle in time
 * @param promise
 * @param ms
 */
async function settleWithin(promise: Promise<unknown>, ms: number = 1000): Promise<'settled' | 'timeout'> {
    let timer: NodeJS.Timeout | undefined
    const timeout: Promise<'timeout'> = new Promise(resolve => timer = setTimeout(() => resolve('timeout'), ms))
    const result: 'settled' | 'timeout' = await Promise.race([promise.then(() => 'settled' as const, () => 'settled' as const), timeout])
    clearTimeout(timer)
    return result
}

class Owner extends Component {
    public async take<T extends BaseObject>(constructor: new (...args: any[]) => T): Promise<T> {
        return await this.getObject(constructor as any)
    }
}

class ThrowOnDestroy extends BaseObject {
    protected async destroy(): Promise<void> {
        throw new Error('destroy failed')
    }
}

class DestroyCounter extends BaseObject {
    public static count: number = 0

    protected async destroy(): Promise<void> {
        DestroyCounter.count++
    }
}

await describe('Lifecycle Test', async function (): Promise<void> {
    await it('container destroy settles when a transient object throws in destroy()', async (): Promise<void> => {
        const reported: Error[] = []
        SetDestroyErrorReporter((error: Error): void => void reported.push(error))
        const root: Container = new Container()
        await root.load([Owner, ThrowOnDestroy, DestroyCounter])
        const owner: Owner = await root.get(Owner)
        await owner.take(ThrowOnDestroy)
        await owner.take(DestroyCounter)
        DestroyCounter.count = 0
        assert.equal(await settleWithin(root.destroy()), 'settled')
        assert.equal(DestroyCounter.count, 1, 'other objects are still destroyed')
        assert.equal(reported.length, 1, 'the destroy error is reported, not swallowed')
        assert.equal(reported[0].message, 'destroy failed')
        SetDestroyErrorReporter()
    })
})

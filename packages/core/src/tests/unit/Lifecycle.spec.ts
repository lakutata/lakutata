import {describe, it} from 'node:test'
import assert from 'node:assert'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {Component} from '../../lib/core/Component.js'
import {Container} from '../../lib/core/Container.js'
import {SetDestroyErrorReporter} from '../../lib/foundation/DestroyErrorReporter.js'
import {Module, MODULE_INITIALIZED} from '../../lib/core/Module.js'
import {ObjectDestroyedException} from '../../exceptions/ObjectDestroyedException.js'
import {LifetimeLockedException} from '../../exceptions/di/LifetimeLockedException.js'
import {Provider} from '../../lib/core/Provider.js'
import {Scoped, Singleton, Transient} from '../../decorators/di/Lifetime.js'

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

const events: string[] = []

class Leaf extends BaseObject {
    protected async destroy(): Promise<void> {
        events.push('Leaf.destroy')
    }
}

class Holder extends BaseObject {
    public leaf: Leaf

    protected async init(): Promise<void> {
        this.leaf = await this.buildObject(Leaf)
    }

    protected async destroy(): Promise<void> {
        events.push('Holder.destroy')
    }

    public async take<T extends BaseObject>(constructor: new (...args: any[]) => T): Promise<T> {
        return await this.getObject(constructor as any)
    }
}

class HolderWithFailingLeaf extends BaseObject {
    protected async init(): Promise<void> {
        await this.buildObject(ThrowOnDestroy)
    }
}

class Reloadable extends Component {
    protected async init(): Promise<void> {
        events.push('Reloadable.init')
    }

    protected async destroy(): Promise<void> {
        events.push('Reloadable.destroy')
    }
}

class ModuleFinder extends BaseObject {
    public find(): Module {
        return this.getModule()
    }
}

class InnerComponent extends Component {
    public async buildFinder(): Promise<ModuleFinder> {
        return await this.buildObject(ModuleFinder)
    }
}

class TestModule extends Module {
    protected options = {components: {inner: {class: InnerComponent}}}
}

async function initializedModule(root: Container): Promise<TestModule> {
    const module: TestModule = await root.get(TestModule)
    await new Promise<void>(resolve => module.once(MODULE_INITIALIZED, () => resolve()))
    return module
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

    await it('dispose() destroys the objects created by the disposed object', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Owner, Holder, Leaf])
        const holder: Holder = await (await root.get(Owner)).take(Holder)
        events.length = 0
        await holder.dispose()
        assert.deepEqual(events, ['Leaf.destroy', 'Holder.destroy'], 'children first, then the object itself')
        await root.destroy()
    })

    await it('teardown is idempotent: dispose() twice and a later owner teardown destroy once', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Owner, Holder, Leaf])
        const holder: Holder = await (await root.get(Owner)).take(Holder)
        events.length = 0
        await holder.dispose()
        await holder.dispose()
        await root.destroy()
        assert.deepEqual(events, ['Leaf.destroy', 'Holder.destroy'])
    })

    await it('a destroyed object can no longer resolve or build objects', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Owner, Holder, Leaf])
        const holder: Holder = await (await root.get(Owner)).take(Holder)
        await holder.dispose()
        await assert.rejects(holder.take(Leaf), ObjectDestroyedException)
        await root.destroy()
    })

    await it('dispose() throws its own destroy() error and reports errors of cascaded children', async (): Promise<void> => {
        const reported: Error[] = []
        SetDestroyErrorReporter((error: Error): void => void reported.push(error))
        const root: Container = new Container()
        await root.load([Owner, ThrowOnDestroy, HolderWithFailingLeaf])
        const owner: Owner = await root.get(Owner)
        await assert.rejects((await owner.take(ThrowOnDestroy)).dispose(), /destroy failed/)
        await (await owner.take(HolderWithFailingLeaf)).dispose()
        assert.equal(reported.length, 1, 'the failing child is reported, not thrown to the caller')
        await root.destroy()
        SetDestroyErrorReporter()
    })

    await it('await using disposes the object when the block exits', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Owner, Holder, Leaf])
        const owner: Owner = await root.get(Owner)
        events.length = 0
        {
            await using holder = await owner.take(Holder)
            assert.ok(holder.leaf instanceof Leaf)
        }
        assert.deepEqual(events, ['Leaf.destroy', 'Holder.destroy'])
        await root.destroy()
    })

    await it('Component.reload() destroys then initializes again', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Reloadable])
        const component: Reloadable = await root.get(Reloadable)
        events.length = 0
        await component.reload()
        await component.reload()
        assert.deepEqual(events, ['Reloadable.destroy', 'Reloadable.init', 'Reloadable.destroy', 'Reloadable.init'])
        await root.destroy()
    })

    await it('Module.reload() resolves', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([TestModule])
        const module: TestModule = await initializedModule(root)
        assert.equal(await settleWithin(module.reload()), 'settled')
        await root.destroy()
    })

    await it('getModule() walks up through non-module parents', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([TestModule])
        const module: TestModule = await initializedModule(root)
        const inner: InnerComponent = await module.getObject('inner')
        const finder: ModuleFinder = await inner.buildFinder()
        assert.equal(finder.find(), module)
        await root.destroy()
    })

    await it('removeAllListeners() without an event removes every regular listener', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Reloadable])
        const component: Reloadable = await root.get(Reloadable)
        component.on('a', (): void => undefined)
        component.on('b', (): void => undefined)
        component.removeAllListeners()
        assert.equal(component.listenerCount('a') + component.listenerCount('b'), 0)
        await root.destroy()
    })

    await it('components are always singletons', async (): Promise<void> => {
        assert.doesNotThrow((): void => {
            @Singleton()
            class RedeclaredSingletonComponent extends Component {
            }

            void RedeclaredSingletonComponent
        }, 'redeclaring the locked lifetime is allowed')
        assert.throws((): void => {
            @Transient()
            class TransientComponent extends Component {
            }

            void TransientComponent
        }, LifetimeLockedException)
    })

    await it('providers cannot be singletons', async (): Promise<void> => {
        assert.throws((): void => {
            @Singleton()
            class SingletonProvider extends Provider {
            }

            void SingletonProvider
        }, LifetimeLockedException)
        assert.doesNotThrow((): void => {
            @Transient()
            class TransientProvider extends Provider {
            }

            @Scoped()
            class ScopedProvider extends Provider {
            }

            void TransientProvider
            void ScopedProvider
        })
    })
})

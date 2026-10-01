import {describe, it} from 'node:test'
import assert from 'node:assert'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {Component} from '../../lib/core/Component.js'
import {Container, RegisterTeardownHook} from '../../lib/core/Container.js'
import {SetDestroyErrorReporter} from '../../lib/foundation/DestroyErrorReporter.js'
import {Module, MODULE_INITIALIZED} from '../../lib/core/Module.js'
import {ObjectDestroyedException} from '../../exceptions/ObjectDestroyedException.js'
import {LifetimeLockedException} from '../../exceptions/di/LifetimeLockedException.js'
import {Provider} from '../../lib/core/Provider.js'
import {ModuleConfigLoader} from '../../lib/base/internal/ModuleConfigLoader.js'
import {InvalidObjectTypeException} from '../../exceptions/InvalidObjectTypeException.js'
import {Scoped, Singleton, Transient} from '../../decorators/di/Lifetime.js'
import {Inject} from '../../decorators/di/Inject.js'
import {OBJECT_ID} from '../../options/LoadObjectOptions.js'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Resolve with the given promise's outcome, or with 'timeout' if it does not settle in time
 * @param promise
 * @param ms
 */
async function settleWithin(promise: Promise<unknown>, ms: number = 1000): Promise<'settled' | 'rejected' | 'timeout'> {
    let timer: NodeJS.Timeout | undefined
    const timeout: Promise<'timeout'> = new Promise(resolve => timer = setTimeout(() => resolve('timeout'), ms))
    const result: 'settled' | 'rejected' | 'timeout' = await Promise.race([promise.then(() => 'settled' as const, () => 'rejected' as const), timeout])
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

class SlowInit extends BaseObject {
    public static instance: SlowInit

    protected async init(): Promise<void> {
        SlowInit.instance = this
        await sleep(30)
    }

    public async take<T extends BaseObject>(constructor: new (...args: any[]) => T): Promise<T> {
        return await this.buildObject(constructor as any)
    }
}

class SlowLeaf extends BaseObject {
    protected async destroy(): Promise<void> {
        await sleep(30)
        events.push('SlowLeaf.destroy')
    }
}

class SlowHolder extends BaseObject {
    protected async init(): Promise<void> {
        await this.buildObject(SlowLeaf)
    }

    protected async destroy(): Promise<void> {
        events.push('SlowHolder.destroy')
    }
}

class DeferredModule extends Module {
    protected async init(): Promise<void> {
        events.push('DeferredModule.init')
    }
}

class InjectingComponent extends Component {
    @Inject(Holder)
    public readonly holder: Holder
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
        assert.match(reported[0].message, /ThrowOnDestroy.*destroy failed/, 'the report names the failing object')
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
        assert.equal(await settleWithin(module.reload()), 'settled', 'reload resolves, neither hangs nor rejects')
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
        component.onAny((): void => undefined)
        assert.equal(component.listenerCount(), 2, 'listenerCount() without an event counts every regular listener')
        component.removeAllListeners()
        assert.equal(component.listenerCount('a') + component.listenerCount('b'), 0)
        assert.equal(component.listenersAny().length, 1, 'onAny listeners are kept')
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

    await it('an object disposed while initializing does not come back to life', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Owner, SlowInit, Leaf])
        const owner: Owner = await root.get(Owner)
        const building: Promise<SlowInit> = owner.take(SlowInit)
        await sleep(5)
        await SlowInit.instance.dispose()
        await assert.rejects(building, ObjectDestroyedException, 'the pending construction fails')
        await assert.rejects(SlowInit.instance.take(Leaf), ObjectDestroyedException, 'the object stays destroyed')
        await root.destroy()
    })

    await it('a module disposed before its deferred initialization never initializes', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([DeferredModule])
        const module: DeferredModule = await root.get(DeferredModule)
        events.length = 0
        await module.dispose()
        await sleep(20)
        assert.deepEqual(events, [])
        await root.destroy()
    })

    await it('a concurrent dispose waits for the teardown already in progress', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Owner, SlowHolder, SlowLeaf])
        const holder: SlowHolder = await (await root.get(Owner)).take(SlowHolder)
        events.length = 0
        const shutdown: Promise<void> = root.destroy()
        await holder.dispose()
        await shutdown
        assert.deepEqual(events, ['SlowLeaf.destroy', 'SlowHolder.destroy'], 'children are still destroyed first')
    })

    await it('reload() fails while the parent is being destroyed', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Owner, Leaf])
        const owner: Owner = await root.get(Owner)
        const shutdown: Promise<void> = root.destroy()
        await assert.rejects(owner.reload(), ObjectDestroyedException)
        await shutdown
        await assert.rejects(owner.take(Leaf), ObjectDestroyedException, 'nothing survives the shutdown')
    })

    await it('reload() injects dependencies again', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([InjectingComponent, Holder, Leaf])
        const component: InjectingComponent = await root.get(InjectingComponent)
        const before: Holder = component.holder
        await component.reload()
        assert.notEqual(component.holder, before, 'the destroyed dependency is replaced')
        await assert.doesNotReject(component.holder.take(Leaf))
        await root.destroy()
    })

    await it('dispose() of a cached object lets the container create a new one', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Reloadable])
        const first: Reloadable = await root.get(Reloadable)
        await first.dispose()
        assert.notEqual(await root.get(Reloadable), first)
        await root.destroy()
    })

    await it('a destroy error delivered to dispose() is not reported again', async (): Promise<void> => {
        const reported: Error[] = []
        SetDestroyErrorReporter((error: Error): void => void reported.push(error))
        const root: Container = new Container()
        await root.load([Owner, ThrowOnDestroy])
        await assert.rejects((await (await root.get(Owner)).take(ThrowOnDestroy)).dispose())
        await root.destroy()
        assert.equal(reported.length, 0)
        SetDestroyErrorReporter()
    })

    await it('a destroyed container refuses to resolve or build objects', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Leaf])
        const scope: Container = root.createScope()
        await scope.destroy()
        await assert.rejects(scope.get(Leaf), ObjectDestroyedException)
        await assert.rejects(scope.build(Leaf), ObjectDestroyedException)
        await root.destroy()
    })

    await it('the teardown hooks of a container run before its scopes are destroyed', async (): Promise<void> => {
        class ScopedObject extends BaseObject {
            public destroyed: boolean = false

            protected async destroy(): Promise<void> {
                this.destroyed = true
            }
        }

        const root: Container = new Container()
        const scope: Container = root.createScope()
        const scoped: ScopedObject = await scope.build(ScopedObject)
        const seen: boolean[] = []
        RegisterTeardownHook(root, async (): Promise<void> => {
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 10))
            seen.push(scoped.destroyed)
        })
        const unregistered: () => void = RegisterTeardownHook(root, async (): Promise<void> => {
            seen.push(true)
        })
        unregistered()
        await root.destroy()
        assert.deepStrictEqual(seen, [false])
        assert.ok(scoped.destroyed)
    })

    await it('an object declared with its class replaces the preset object of the same name, its options are added otherwise', async (): Promise<void> => {
        class PresetComponent extends Component {
        }

        const preset = [{[OBJECT_ID]: 'replaced', class: PresetComponent}, {[OBJECT_ID]: 'kept', class: PresetComponent, value: 1}]
        const loader: ModuleConfigLoader = new ModuleConfigLoader({} as Module, {
            components: {replaced: {class: InnerComponent}, kept: {value: 2}}
        }, preset)
        const loaded = loader.loadOptions.map((options: any) => ({id: options[OBJECT_ID], class: options.class, value: options.value}))
        assert.deepStrictEqual(loaded, [
            {id: 'replaced', class: InnerComponent, value: undefined},
            {id: 'kept', class: PresetComponent, value: 2}
        ])
    })

    await it('a component declared as a provider is rejected with the configuration it belongs to', async (): Promise<void> => {
        //The validation does not use the module
        assert.throws((): unknown => new ModuleConfigLoader({} as Module, {providers: {proxy: {class: InnerComponent}}}), (error: Error): boolean => {
            assert.ok(error instanceof InvalidObjectTypeException)
            assert.strictEqual(error.message, 'Provider configuration only accepts object declarations of provider types: "proxy" (InnerComponent) is a component, declare it in the components configuration')
            return true
        })
    })
})

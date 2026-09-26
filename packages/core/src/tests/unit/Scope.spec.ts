import {describe, it} from 'node:test'
import assert from 'node:assert'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {Provider} from '../../lib/core/Provider.js'
import {Component} from '../../lib/core/Component.js'
import {Container} from '../../lib/core/Container.js'
import {Inject} from '../../decorators/di/Inject.js'
import {Autoload} from '../../decorators/di/Autoload.js'
import {GetObjectContainer} from '../../lib/base/internal/ObjectContainer.js'
import v8 from 'node:v8'
import vm from 'node:vm'

v8.setFlagsFromString('--expose_gc')
const gc: () => void = vm.runInNewContext('gc')

/**
 * Collect garbage until the weak reference is cleared or attempts run out
 * @param ref
 */
async function collected(ref: WeakRef<object>): Promise<boolean> {
    for (let attempt: number = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setImmediate(resolve))
        gc()
        if (!ref.deref()) return true
    }
    return false
}

class RequestState extends Provider {
    public static destroyed: number = 0

    protected async destroy(): Promise<void> {
        RequestState.destroyed++
    }
}

class Service extends BaseObject {
    @Inject(RequestState)
    public readonly injected: RequestState

    public async state(): Promise<RequestState> {
        return await this.getObject(RequestState)
    }

    public async child(): Promise<Service> {
        return await this.buildObject(Service)
    }
}

class SharedComponent extends Component {
    public async state(): Promise<RequestState> {
        return await this.getObject(RequestState)
    }
}

class AnotherComponent extends Component {
    public async state(): Promise<RequestState> {
        return await this.getObject(RequestState)
    }
}

class Invisible extends Provider {
}

class Job extends BaseObject {
}

@Autoload()
class AutoloadedState extends Provider {
}

class AutoloadUser extends BaseObject {
    public async state(): Promise<AutoloadedState> {
        return await this.getObject(AutoloadedState)
    }
}

class LongLived extends Component {
    public async buildJob(): Promise<WeakRef<Container>> {
        return new WeakRef(GetObjectContainer(await this.buildObject(Job)))
    }

    public async resolveJob(): Promise<WeakRef<Container>> {
        return new WeakRef(GetObjectContainer(await this.getObject(Job)))
    }
}

async function createRoot(): Promise<Container> {
    const root: Container = new Container()
    await root.load([RequestState, Service, SharedComponent, AnotherComponent])
    return root
}

await describe('Scope Test', async function (): Promise<void> {
    await it('objects in the same request scope share one scoped instance', async (): Promise<void> => {
        const root: Container = await createRoot()
        const request: Container = root.createScope()
        const first: Service = await request.get(Service)
        const second: Service = await request.get(Service)
        const fromScope: RequestState = await request.get(RequestState)
        assert.equal(await first.state(), fromScope, 'object resolves the request instance')
        assert.equal(await second.state(), fromScope, 'sibling object resolves the same instance')
        assert.equal(first.injected, fromScope, '@Inject resolves the same instance')
        assert.equal(await (await first.child()).state(), fromScope, 'objects created by an object share it too')
        await root.destroy()
    })

    await it('different request scopes get different scoped instances', async (): Promise<void> => {
        const root: Container = await createRoot()
        const requestA: Container = root.createScope()
        const requestB: Container = root.createScope()
        const stateA: RequestState = await (await requestA.get(Service)).state()
        const stateB: RequestState = await (await requestB.get(Service)).state()
        assert.notEqual(stateA, stateB)
        await root.destroy()
    })

    await it('outside a request scope, objects share the instance of the outermost scope', async (): Promise<void> => {
        const root: Container = await createRoot()
        const shared: SharedComponent = await root.get(SharedComponent)
        const another: AnotherComponent = await root.get(AnotherComponent)
        assert.equal(await shared.state(), await another.state())
        await root.destroy()
    })

    await it('destroying a request scope destroys its scoped instances', async (): Promise<void> => {
        const root: Container = await createRoot()
        const request: Container = root.createScope()
        await (await request.get(Service)).state()
        RequestState.destroyed = 0
        await request.destroy()
        assert.equal(RequestState.destroyed, 1)
        await root.destroy()
    })

    await it('registrations stay invisible to sibling and parent scopes', async (): Promise<void> => {
        const root: Container = await createRoot()
        const requestA: Container = root.createScope()
        const requestB: Container = root.createScope()
        await requestA.load([Invisible])
        await assert.doesNotReject(requestA.get(Invisible))
        await assert.rejects(requestB.get(Invisible))
        await assert.rejects(root.get(Invisible))
        await root.destroy()
    })

    await it('containers of objects built by a long-lived object are released with the objects', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([LongLived, Job])
        const longLived: LongLived = await root.get(LongLived)
        assert.equal(await collected(await longLived.buildJob()), true, 'buildObject()')
        assert.equal(await collected(await longLived.resolveJob()), true, 'getObject() of a transient object')
        await root.destroy()
    })

    await it('a request scope that is never destroyed explicitly is destroyed with its parent', async (): Promise<void> => {
        const root: Container = await createRoot()
        await (await root.createScope().get(Service)).state()
        RequestState.destroyed = 0
        await root.destroy()
        assert.equal(RequestState.destroyed, 1)
    })

    await it('an autoloaded scoped object is shared within the request', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([AutoloadUser])
        const request: Container = root.createScope()
        const first: AutoloadUser = await request.get(AutoloadUser)
        const second: AutoloadUser = await request.get(AutoloadUser)
        assert.equal(await first.state(), await second.state())
        await root.destroy()
    })
})

import {describe, it} from 'node:test'
import assert from 'node:assert'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {Provider} from '../../lib/core/Provider.js'
import {Component} from '../../lib/core/Component.js'
import {Container} from '../../lib/core/Container.js'
import {Inject} from '../../decorators/di/Inject.js'
import {Autoload} from '../../decorators/di/Autoload.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {DTO} from '../../lib/dto/DTO.js'
import {getObjectContainer} from '../../lib/base/internal/ObjectContainer.js'
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

class Report extends Provider {
    public static destroyed: number = 0

    @Configurable(DTO.String().optional().default('pdf'))
    public readonly format: string

    protected async destroy(): Promise<void> {
        Report.destroyed++
    }
}

class ReportUser extends BaseObject {
    public async report(configurableRecords?: Record<string, any>): Promise<Report> {
        return configurableRecords ? await this.getObject(Report, configurableRecords) : await this.getObject(Report)
    }
}

class Settings extends Component {
    @Configurable(DTO.String().optional().default('default'))
    public readonly mode: string
}

class Tagged extends Component {
    @Configurable(DTO.String().optional().default('none'))
    public readonly tag: string
}

class TaggedJob extends BaseObject {
    @Configurable(DTO.String().optional().default('none'))
    public readonly tag: string
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
        return new WeakRef(getObjectContainer(await this.buildObject(Job)))
    }

    public async resolveJob(): Promise<WeakRef<Container>> {
        return new WeakRef(getObjectContainer(await this.getObject(Job)))
    }
}

async function createRoot(): Promise<Container> {
    const root: Container = new Container()
    await root.load([RequestState, Service, SharedComponent, AnotherComponent])
    return root
}

describe('Scope Test', (): void => {
    it('objects in the same request scope share one scoped instance', async (): Promise<void> => {
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

    it('different request scopes get different scoped instances', async (): Promise<void> => {
        const root: Container = await createRoot()
        const requestA: Container = root.createScope()
        const requestB: Container = root.createScope()
        const stateA: RequestState = await (await requestA.get(Service)).state()
        const stateB: RequestState = await (await requestB.get(Service)).state()
        assert.notEqual(stateA, stateB)
        await root.destroy()
    })

    it('outside a request scope, objects share the instance of the outermost scope', async (): Promise<void> => {
        const root: Container = await createRoot()
        const shared: SharedComponent = await root.get(SharedComponent)
        const another: AnotherComponent = await root.get(AnotherComponent)
        assert.equal(await shared.state(), await another.state())
        await root.destroy()
    })

    it('destroying a request scope destroys its scoped instances', async (): Promise<void> => {
        const root: Container = await createRoot()
        const request: Container = root.createScope()
        await (await request.get(Service)).state()
        RequestState.destroyed = 0
        await request.destroy()
        assert.equal(RequestState.destroyed, 1)
        await root.destroy()
    })

    it('registrations stay invisible to sibling and parent scopes', async (): Promise<void> => {
        const root: Container = await createRoot()
        const requestA: Container = root.createScope()
        const requestB: Container = root.createScope()
        await requestA.load([Invisible])
        await assert.doesNotReject(requestA.get(Invisible))
        await assert.rejects(requestB.get(Invisible))
        await assert.rejects(root.get(Invisible))
        await root.destroy()
    })

    it('containers of objects built by a long-lived object are released with the objects', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([LongLived, Job])
        const longLived: LongLived = await root.get(LongLived)
        assert.equal(await collected(await longLived.buildJob()), true, 'buildObject()')
        assert.equal(await collected(await longLived.resolveJob()), true, 'getObject() of a transient object')
        await root.destroy()
    })

    it('a request scope that is never destroyed explicitly is destroyed with its parent', async (): Promise<void> => {
        const root: Container = await createRoot()
        await (await root.createScope().get(Service)).state()
        RequestState.destroyed = 0
        await root.destroy()
        assert.equal(RequestState.destroyed, 1)
    })

    it('an autoloaded scoped object is shared within the request', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([AutoloadUser])
        const request: Container = root.createScope()
        const first: AutoloadUser = await request.get(AutoloadUser)
        const second: AutoloadUser = await request.get(AutoloadUser)
        assert.equal(await first.state(), await second.state())
        await root.destroy()
    })

    it('a scoped object requested with its own configuration is a new instance for the requester', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Report, ReportUser])
        const request: Container = root.createScope()
        const user: ReportUser = await request.get(ReportUser)
        const shared: Report = await user.report()
        const csv: Report = await user.report({format: 'csv'})
        const xml: Report = await user.report({format: 'xml'})
        assert.equal(shared.format, 'pdf', 'without configuration, the shared request instance')
        assert.equal(csv.format, 'csv')
        assert.equal(xml.format, 'xml')
        assert.notEqual(csv, shared)
        assert.notEqual(csv, xml)
        assert.equal(await user.report(), shared, 'the shared instance is not affected')
        Report.destroyed = 0
        await user.dispose()
        assert.equal(Report.destroyed, 2, 'configured instances are destroyed with their requester')
        await request.destroy()
        assert.equal(Report.destroyed, 3, 'the shared instance is destroyed with the request')
        await root.destroy()
    })

    it('configuration passed for an already created object is ignored with a warning', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([Settings])
        const warnings: string[] = []
        const onWarning = (warning: Error): void => void warnings.push(warning.message)
        process.on('warning', onWarning)
        const first: Settings = await root.get(Settings, {mode: 'first'})
        const second: Settings = await root.get(Settings, {mode: 'second'})
        await root.get(Settings)
        process.off('warning', onWarning)
        assert.equal(second, first)
        assert.equal(second.mode, 'first')
        assert.equal(warnings.length, 1, 'only the call with an ignored configuration warns')
        assert.match(warnings[0], /Settings/)
        await root.destroy()
    })

    it('containers registering the same name and class keep their own options', async (): Promise<void> => {
        const containers: Container[] = [new Container(), new Container(), new Container()]
        for (const [index, container] of containers.entries()) {
            await container.registerNamed('tagged', Tagged, {tag: `tagged-${index}`})
            await container.registerNamed('job', TaggedJob, {tag: `job-${index}`})
        }
        //Created after the last registration, each with the options of its own container
        assert.deepEqual(await Promise.all(containers.map(async (container: Container): Promise<string> => (await container.get<Tagged>('tagged')).tag)), ['tagged-0', 'tagged-1', 'tagged-2'])
        assert.deepEqual(await Promise.all(containers.map(async (container: Container): Promise<string> => (await container.get<TaggedJob>('job')).tag)), ['job-0', 'job-1', 'job-2'])
        //Registered and created at the same time
        const concurrent: Container[] = [new Container(), new Container(), new Container()]
        const created: Tagged[] = await Promise.all(concurrent.map((container: Container, index: number): Promise<Tagged> => container.setNamed('tagged', Tagged, {tag: `concurrent-${index}`})))
        assert.deepEqual(created.map((tagged: Tagged): string => tagged.tag), ['concurrent-0', 'concurrent-1', 'concurrent-2'])
        for (const container of [...containers, ...concurrent]) await container.destroy()
    })

    it('a registration of a child container shadows the one of its parent with its own options', async (): Promise<void> => {
        const root: Container = new Container()
        await root.registerNamed('tagged', Tagged, {tag: 'root'})
        await root.registerNamed('job', TaggedJob, {tag: 'root'})
        const child: Container = root.createScope()
        const sibling: Container = root.createScope()
        await child.registerNamed('job', TaggedJob, {tag: 'child'})
        assert.equal((await child.get<TaggedJob>('job')).tag, 'child')
        assert.equal((await sibling.get<TaggedJob>('job')).tag, 'root')
        assert.equal((await root.get<TaggedJob>('job')).tag, 'root')
        assert.equal((await child.get<Tagged>('tagged')).tag, 'root', 'the singleton of the parent, with its options')
        await root.destroy()
    })

    it('an object built from a class gets the options of the class registered in its container only', async (): Promise<void> => {
        const root: Container = new Container()
        const other: Container = new Container()
        await root.register(TaggedJob, {tag: 'registered'})
        assert.equal((await root.createScope().build(TaggedJob)).tag, 'registered')
        assert.equal((await other.build(TaggedJob)).tag, 'none')
        await root.destroy()
        await other.destroy()
    })
})

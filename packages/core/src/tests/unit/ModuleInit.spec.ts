import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Component} from '../../lib/core/Component.js'
import {Container} from '../../lib/core/Container.js'
import {Module} from '../../lib/core/Module.js'
import {Inject} from '../../decorators/di/Inject.js'
import {OBJECT_ID} from '../../options/LoadObjectOptions.js'

const events: string[] = []

class Inner extends Component {
    @Inject('sub')
    public readonly sub: Module

    protected async init(): Promise<void> {
        events.push(`inner.init sub=${!!this.sub}`)
    }
}

class SubModule extends Module {
    protected options = {components: {inner: {class: Inner}}, bootstrap: ['inner']}

    protected async init(): Promise<void> {
        events.push('sub.init')
    }
}

describe('Module initialization', (): void => {
    it('is complete when the module is resolved, its objects injecting it', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([{[OBJECT_ID]: 'sub', class: SubModule}])
        const sub: Module = await root.get('sub')
        events.push('resolved')
        assert.strictEqual((await sub.getObject<Inner>('inner')).sub, sub)
        //Its bootstrap (creating its object, which injects it) and its init done before it is resolved
        assert.deepStrictEqual(events, ['inner.init sub=true', 'sub.init', 'resolved'])
        await root.destroy()
    })

    it('rejects the requests from outside when its initialization fails', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([{[OBJECT_ID]: 'failing', class: FailingModule}])
        await assert.rejects(root.get('failing'), /The bootstrap failed/)
        await root.destroy()
    })
})

class FailingModule extends Module {
    protected options = {
        bootstrap: [async (): Promise<void> => {
            throw new Error('The bootstrap failed')
        }]
    }
}

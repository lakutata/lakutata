import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {Controller, ServiceContext} from '../exports/Entrypoint.js'

class ContextController extends Controller {
    public get currentContext(): unknown {
        return this.context
    }
}

describe('Controller', (): void => {

    it('receives its context instance as is and rejects anything else', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([ContextController])
        const context: ServiceContext = new ServiceContext({data: {act: 'x'}})
        const controller: ContextController = await root.createScope().get(ContextController, {context: context})
        assert.equal(controller.currentContext, context)
        await assert.rejects(root.createScope().get(ContextController, {context: {type: 'SERVICE', data: {}}}))
        await root.destroy()
    })
})

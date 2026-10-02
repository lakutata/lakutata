import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {BuildEntrypoints, BuildServiceEntrypoint, Controller, Entrypoint, ServiceContext, type ServiceEntrypointHandler} from '../exports/Entrypoint.js'
import {ServiceAction} from '../exports/CTRLDecorators.js'

class BaseController extends Controller {
    @ServiceAction({act: 'version'})
    public async version(): Promise<string> {
        return 'base'
    }

    @ServiceAction({act: 'name'})
    public async name(): Promise<string> {
        return 'base name'
    }
}

/**
 * Declares the action of its parent again, by another method
 */
class MiddleController extends BaseController {
    @ServiceAction({act: 'version'})
    public async middleVersion(): Promise<string> {
        return 'middle'
    }
}

/**
 * Declares no action
 */
class LeafController extends MiddleController {
}

/**
 * The handler of the service actions of the controllers
 * @param controllers
 */
async function Handler(controllers: (typeof Controller)[]): Promise<{ handler: ServiceEntrypointHandler, container: Container }> {
    let handler: ServiceEntrypointHandler | undefined
    const container: Container = new Container()
    await container.set(Entrypoint, BuildEntrypoints({
        controllers: controllers as never,
        service: BuildServiceEntrypoint((module, serviceHandler): void => {
            handler = serviceHandler
        })
    }))
    return {handler: handler!, container: container}
}

describe('The actions of the subclasses of the controllers', (): void => {

    it('are the closest declarations: a subclass without actions runs the actions declared again by its parent', async (): Promise<void> => {
        for (const [controller, version] of [[MiddleController, 'middle'], [LeafController, 'middle'], [BaseController, 'base']] as const) {
            const {handler, container} = await Handler([controller])
            assert.strictEqual(await handler(new ServiceContext({data: {act: 'version'}})), version, controller.name)
            //The actions not declared again are inherited
            assert.strictEqual(await handler(new ServiceContext({data: {act: 'name'}})), 'base name', controller.name)
            await container.destroy()
        }
    })
})

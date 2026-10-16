import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {
    buildEntrypoints,
    buildServiceEntrypoint,
    ControllerActionNotFoundException,
    Controller,
    Entrypoint,
    ServiceContext,
    ServiceEntrypointHandler
} from '../exports/Entrypoint.js'
import {Prefix, ServiceAction} from '../exports/CTRLDecorators.js'

class ResourceController extends Controller {
    @ServiceAction({res: {name: 'user'}, act: 'get'})
    public async getUser(input: Record<string, unknown>): Promise<unknown> {
        return {action: 'getUser', input: input}
    }

    @ServiceAction({res: {name: 'order'}, act: 'get'})
    public async getOrder(): Promise<string> {
        return 'getOrder'
    }

    @ServiceAction({res: {name: 'file*'}, act: 'get'})
    public async getFile(): Promise<string> {
        return 'getFile'
    }

    @ServiceAction({res: 'flat', act: 'get'})
    public async getFlat(): Promise<string> {
        return 'getFlat'
    }
}

@Prefix({pattern: {scope: {tenant: 'acme'}}})
class TenantController extends Controller {
    @ServiceAction({act: 'list'})
    public async list(): Promise<string> {
        return 'tenant list'
    }
}

describe('The service patterns', (): void => {

    it('compare the values of their nested objects one by one', async (): Promise<void> => {
        let service: ServiceEntrypointHandler | undefined
        const container: Container = new Container()
        await container.set(Entrypoint, buildEntrypoints({
            controllers: [ResourceController, TenantController],
            service: buildServiceEntrypoint((module, handler): unknown => service = handler)
        }))
        const call = (data: Record<string, unknown>): Promise<unknown> => service!(new ServiceContext({data: data}))
        try {
            //The keys of the pattern, nested ones included, are not a part of the input
            assert.deepStrictEqual(await call({res: {name: 'user'}, act: 'get', id: 1}), {action: 'getUser', input: {id: 1}})
            assert.strictEqual(await call({res: {name: 'order'}, act: 'get'}), 'getOrder')
            //A nested glob, the unknown nested properties ignored
            assert.strictEqual(await call({res: {name: 'files', extra: 1}, act: 'get'}), 'getFile')
            assert.strictEqual(await call({res: 'flat', act: 'get'}), 'getFlat')
            //Matched by no pattern: another value of a nested key, a nested object without the key
            await assert.rejects(call({res: {name: 'invoice'}, act: 'get'}), ControllerActionNotFoundException)
            await assert.rejects(call({res: {}, act: 'get'}), ControllerActionNotFoundException)
            //A nested prefix
            assert.strictEqual(await call({scope: {tenant: 'acme'}, act: 'list'}), 'tenant list')
            await assert.rejects(call({scope: {tenant: 'other'}, act: 'list'}), ControllerActionNotFoundException)
        } finally {
            await container.destroy()
        }
    })
})

import {describe, it} from 'node:test'
import assert from 'node:assert'
import {types} from 'node:util'
import {Container, DTO, RegisterValidationMessages} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {
    BuildEntrypoints,
    BuildServiceEntrypoint,
    Controller,
    Entrypoint,
    ServiceContext,
    ServiceEntrypointHandler
} from '../exports/Entrypoint.js'
import {ServiceAction} from '../exports/CTRLDecorators.js'

class Point {
    constructor(public x: number) {
    }

    public norm(): number {
        return Math.abs(this.x)
    }
}

class InputDTO extends DTO {
    @Expect(DTO.Object())
    public meta: Record<string, any>

    @Expect(DTO.Array())
    public list: unknown[]

    @Expect(DTO.Date())
    public date: Date

    @Expect(DTO.Binary())
    public buffer: Buffer

    @Expect(DTO.Any())
    public map: Map<number, unknown>

    @Expect(DTO.InstanceOf(Point))
    public point: Point
}

let received: InputDTO

class NamedDTO extends DTO {
    @Expect(DTO.String().required())
    public name: string
}

class NamedController extends Controller {
    @ServiceAction({act: 'named'}, NamedDTO)
    public async named(input: NamedDTO): Promise<string> {
        return `Hello, ${input.name}`
    }
}

class InputController extends Controller {
    @ServiceAction({act: 'input'}, InputDTO)
    public async input(input: InputDTO): Promise<string> {
        received = input
        input.meta.changed = true
        input.list.push('added')
        return 'done'
    }
}

describe('Action input', (): void => {

    it('is a copy of the context data, including the nested values', async (): Promise<void> => {
        let handler: ServiceEntrypointHandler
        const container: Container = new Container()
        await container.set(Entrypoint, BuildEntrypoints({
            controllers: [InputController],
            service: BuildServiceEntrypoint((module, serviceHandler): unknown => handler = serviceHandler)
        }))
        const context: ServiceContext = new ServiceContext({
            data: {
                act: 'input',
                meta: {nested: {deep: [1, {a: 2}]}},
                list: [1, [2, 3], {b: 4}],
                date: new Date(5),
                buffer: Buffer.from('ab'),
                map: new Map([[1, {c: 3}]]),
                point: new Point(-2)
            }
        })
        assert.strictEqual(await handler!(context), 'done')
        //The values keep their types and are not the proxies of the context
        assert.ok(!types.isProxy(received.meta) && !types.isProxy(received.list) && !types.isProxy(received.date))
        assert.deepStrictEqual(received.meta, {nested: {deep: [1, {a: 2}]}, changed: true})
        assert.strictEqual(received.date.getTime(), 5)
        assert.strictEqual(received.buffer.toString(), 'ab')
        assert.deepStrictEqual(received.map.get(1), {c: 3})
        assert.strictEqual(received.point.norm(), 2)
        //The changes of the action do not reach the context
        assert.deepStrictEqual(JSON.parse(JSON.stringify(context.data.meta)), {nested: {deep: [1, {a: 2}]}})
        assert.deepStrictEqual(JSON.parse(JSON.stringify(context.data.list)), [1, [2, 3], {b: 4}])
        await container.destroy()
    })

    it('is validated in the language of its request, its errors in it', async (): Promise<void> => {
        RegisterValidationMessages('zh-CN', {'any.required': '{{#label}} 为必填项'})
        let handler: ServiceEntrypointHandler
        const container: Container = new Container()
        await container.set(Entrypoint, BuildEntrypoints({
            controllers: [NamedController],
            service: BuildServiceEntrypoint((module, serviceHandler): unknown => handler = serviceHandler)
        }))
        await assert.rejects(handler!(new ServiceContext({data: {act: 'named'}, locale: 'zh-CN'})), /"name" 为必填项/)
        //Without a language, or in a language without messages: the default messages
        await assert.rejects(handler!(new ServiceContext({data: {act: 'named'}})), /"name" is required/)
        await assert.rejects(handler!(new ServiceContext({data: {act: 'named'}, locale: 'fr'})), /"name" is required/)
        assert.strictEqual(await handler!(new ServiceContext({data: {act: 'named', name: 'Ada'}, locale: 'zh-CN'})), 'Hello, Ada')
        await container.destroy()
    })
})

import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Component} from '../../lib/core/Component.js'
import {Container} from '../../lib/core/Container.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {DTO} from '../../lib/dto/DTO.js'
import {checkObjectOptions} from '../../lib/base/internal/ObjectOptionsCheck.js'
import {OBJECT_ID} from '../../options/LoadObjectOptions.js'
import {InvalidObjectOptionsException} from '../../exceptions/di/InvalidObjectOptionsException.js'

class Server extends Component {
    @Configurable(DTO.String().optional().default('localhost'))
    public readonly host: string

    @Configurable(DTO.Number().integer().min(1).optional().default(80), function (this: Server, port: number): number {
        return port + 0
    })
    public readonly port: number

    @Configurable(DTO.String().optional().default('server'))
    public readonly label: string = 'initializer'
}

/**
 * Inherits every configurable property
 */
class InheritingServer extends Server {
}

/**
 * Declares the port again with another type, default and transform
 */
class NamedPortServer extends Server {
    @Configurable(DTO.String().valid('auto', 'http', 'https').optional().default('auto'), function (this: NamedPortServer, port: string): string {
        return port.toUpperCase()
    })
    public readonly port: any
}

/**
 * Declares the port of its parent again, and the host
 */
class SecureServer extends NamedPortServer {
    @Configurable(DTO.String().valid('https').optional().default('https'))
    public readonly port: any

    @Configurable(DTO.String().hostname().required())
    public readonly host: string
}

/**
 * Declares nothing: the declarations of its parent, not of its grandparent
 */
class PlainNamedPortServer extends NamedPortServer {
}

/**
 * A sibling of NamedPortServer declaring the port otherwise
 */
class RangedServer extends Server {
    @Configurable(DTO.Number().integer().min(1000).max(2000).optional().default(1500))
    public readonly port: number
}

class InitializedOnly extends Component {
    @Configurable(DTO.Number().optional())
    public readonly count: number = 5
}

class InitializedPort extends Server {
    public readonly port: number = 8443
}

class ReinitializedPort extends InitializedPort {
    public readonly port: number = 9443
}

class InitializedNamedPort extends NamedPortServer {
    public readonly port: any = 'https'
}

class InvalidInitializer extends Server {
    public readonly port: number = 0
}

class RedeclaredWithoutInitializer extends InitializedPort {
    @Configurable(DTO.Number().integer().min(1).optional().default(1))
    public readonly port: number
}

async function create<T extends Component>(target: new (...args: any[]) => T, options: Record<string, unknown> = {}): Promise<T> {
    return await new Container().set(target as any, options) as T
}

describe('The configurable properties of the subclasses', (): void => {

    it('are inherited: the values, the defaults, the transforms and the validation of the parent', async (): Promise<void> => {
        const server: InheritingServer = await create(InheritingServer, {host: 'example.com', port: 8080})
        assert.deepStrictEqual([server.host, server.port, server.label], ['example.com', 8080, 'initializer'])
        const defaults: InheritingServer = await create(InheritingServer)
        assert.deepStrictEqual([defaults.host, defaults.port], ['localhost', 80])
        await assert.rejects(create(InheritingServer, {port: 'auto'}), /"port" must be a number/)
        await assert.rejects(create(InheritingServer, {port: 0}), /"port" must be greater than or equal to 1/)
    })

    it('declared again take the type, the default and the transform of the subclass, the parent unchanged', async (): Promise<void> => {
        assert.strictEqual((await create(NamedPortServer, {port: 'http'})).port, 'HTTP')
        assert.strictEqual((await create(NamedPortServer)).port, 'AUTO')
        await assert.rejects(create(NamedPortServer, {port: 8080}), /"port" must be one of \[auto, http, https\]/)
        //The other properties of the parent are kept
        assert.strictEqual((await create(NamedPortServer, {host: 'h.com'})).host, 'h.com')
        //The parent validates and transforms as before
        assert.strictEqual((await create(Server, {port: 8080})).port, 8080)
        await assert.rejects(create(Server, {port: 'auto'}), /"port" must be a number/)
    })

    it('declared again over several levels take the closest declaration, the siblings do not share theirs', async (): Promise<void> => {
        const secure: SecureServer = await create(SecureServer, {host: 'secure.example.com'})
        assert.deepStrictEqual([secure.host, secure.port, secure.label], ['secure.example.com', 'https', 'initializer'])
        await assert.rejects(create(SecureServer, {host: 'secure.example.com', port: 'http'}), /"port" must be \[https\]/)
        //The host is required by the grandchild only
        await assert.rejects(create(SecureServer), /"host" is required/)
        assert.strictEqual((await create(NamedPortServer)).host, 'localhost')
        //A subclass declaring nothing takes the declaration of its parent, not the one of its grandparent (2.x took it)
        assert.strictEqual((await create(PlainNamedPortServer, {port: 'http'})).port, 'HTTP')
        await assert.rejects(create(PlainNamedPortServer, {port: 8080}), /"port" must be one of/)
        //The siblings
        assert.strictEqual((await create(RangedServer)).port, 1500)
        await assert.rejects(create(RangedServer, {port: 80}), /"port" must be greater than or equal to 1000/)
        assert.strictEqual((await create(NamedPortServer, {port: 'https'})).port, 'HTTPS')
    })

    it('take the value configured, else the initializer of the property, else the default of the schema', async (): Promise<void> => {
        //The initializer over the default of the schema
        assert.strictEqual((await create(Server)).label, 'initializer')
        assert.strictEqual((await create(InheritingServer, {label: 'given'})).label, 'given')
        //Without default in the schema, the initializer is kept (it was replaced by undefined)
        assert.strictEqual((await create(InitializedOnly)).count, 5)
        assert.strictEqual((await create(InitializedOnly, {count: 6})).count, 6)
        //The initializer of a subclass over the default of the parent, the initializer of a subclass over the one of the parent
        assert.strictEqual((await create(InitializedPort)).port, 8443)
        assert.strictEqual((await create(InitializedPort, {port: 9000})).port, 9000)
        assert.strictEqual((await create(ReinitializedPort)).port, 9443)
        //The initializer is validated and transformed as a configured value
        assert.strictEqual((await create(InitializedNamedPort)).port, 'HTTPS')
        await assert.rejects(create(InvalidInitializer), /"port" must be greater than or equal to 1/)
        //A subclass declaring the property again without initializer keeps the initializer of its parent
        assert.strictEqual((await create(RedeclaredWithoutInitializer)).port, 8443)
    })

    it('are checked at the startup with the declarations of the subclass', (): void => {
        const declare = (target: Function, options: Record<string, unknown>): any => ({class: target, [OBJECT_ID]: 'server', ...options})
        assert.doesNotThrow((): void => checkObjectOptions([declare(NamedPortServer, {port: 'http'})]))
        assert.throws((): void => checkObjectOptions([declare(NamedPortServer, {port: 8080})]), (error: Error): boolean => error instanceof InvalidObjectOptionsException && /"port" must be one of/.test(error.message))
        assert.throws((): void => checkObjectOptions([declare(Server, {port: 'http'})]), /"port" must be a number/)
        assert.throws((): void => checkObjectOptions([declare(RangedServer, {port: 80})]), /greater than or equal to 1000/)
    })

    it('give the components a configurable maximum of listeners: 11, configured, or the initializer of a subclass', async (): Promise<void> => {
        class QuietComponent extends Component {
            protected readonly maxListeners: number = 0
        }

        const listeners = (component: Component): number => component.getMaxListeners()
        assert.strictEqual(listeners(await create(Component)), 11)
        assert.strictEqual(listeners(await create(Component, {maxListeners: 50})), 50)
        assert.strictEqual(listeners(await create(QuietComponent)), 0)
        assert.strictEqual(listeners(await create(QuietComponent, {maxListeners: 3})), 3)
        await assert.rejects(create(Component, {maxListeners: -1}), /"maxListeners" must be greater than or equal to 0/)
        //No warning without a maximum
        const warnings: string[] = []
        const onWarning = (warning: Error): number => warnings.push(warning.name)
        process.on('warning', onWarning)
        const quiet: QuietComponent = await create(QuietComponent)
        for (let index: number = 0; index < 20; index++) quiet.on('event', (): undefined => undefined)
        await new Promise((resolve: (value?: unknown) => void): unknown => setImmediate(resolve))
        process.off('warning', onWarning)
        assert.deepStrictEqual(warnings, [])
    })
})

import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Component} from '../../lib/core/Component.js'
import {Container} from '../../lib/core/Container.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {DTO} from '../../lib/dto/DTO.js'
import {CheckObjectOptions} from '../../lib/base/internal/ObjectOptionsCheck.js'
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
 * A sibling of NamedPortServer declaring the port otherwise
 */
class RangedServer extends Server {
    @Configurable(DTO.Number().integer().min(1000).max(2000).optional().default(1500))
    public readonly port: number
}

async function Create<T extends Component>(target: new (...args: any[]) => T, options: Record<string, unknown> = {}): Promise<T> {
    return await new Container().set(target as any, options) as T
}

describe('The configurable properties of the subclasses', (): void => {

    it('are inherited: the values, the defaults, the transforms and the validation of the parent', async (): Promise<void> => {
        const server: InheritingServer = await Create(InheritingServer, {host: 'example.com', port: 8080})
        assert.deepStrictEqual([server.host, server.port, server.label], ['example.com', 8080, 'server'])
        const defaults: InheritingServer = await Create(InheritingServer)
        assert.deepStrictEqual([defaults.host, defaults.port], ['localhost', 80])
        await assert.rejects(Create(InheritingServer, {port: 'auto'}), /"port" must be a number/)
        await assert.rejects(Create(InheritingServer, {port: 0}), /"port" must be greater than or equal to 1/)
    })

    it('declared again take the type, the default and the transform of the subclass, the parent unchanged', async (): Promise<void> => {
        assert.strictEqual((await Create(NamedPortServer, {port: 'http'})).port, 'HTTP')
        assert.strictEqual((await Create(NamedPortServer)).port, 'AUTO')
        await assert.rejects(Create(NamedPortServer, {port: 8080}), /"port" must be one of \[auto, http, https\]/)
        //The other properties of the parent are kept
        assert.strictEqual((await Create(NamedPortServer, {host: 'h.com'})).host, 'h.com')
        //The parent validates and transforms as before
        assert.strictEqual((await Create(Server, {port: 8080})).port, 8080)
        await assert.rejects(Create(Server, {port: 'auto'}), /"port" must be a number/)
    })

    it('declared again over several levels take the closest declaration, the siblings do not share theirs', async (): Promise<void> => {
        const secure: SecureServer = await Create(SecureServer, {host: 'secure.example.com'})
        assert.deepStrictEqual([secure.host, secure.port, secure.label], ['secure.example.com', 'https', 'server'])
        await assert.rejects(Create(SecureServer, {host: 'secure.example.com', port: 'http'}), /"port" must be \[https\]/)
        //The host is required by the grandchild only
        await assert.rejects(Create(SecureServer), /"host" is required/)
        assert.strictEqual((await Create(NamedPortServer)).host, 'localhost')
        //The siblings
        assert.strictEqual((await Create(RangedServer)).port, 1500)
        await assert.rejects(Create(RangedServer, {port: 80}), /"port" must be greater than or equal to 1000/)
        assert.strictEqual((await Create(NamedPortServer, {port: 'https'})).port, 'HTTPS')
    })

    it('given a value or a default win over the initializer of the property', async (): Promise<void> => {
        assert.strictEqual((await Create(Server)).label, 'server')
        assert.strictEqual((await Create(InheritingServer, {label: 'given'})).label, 'given')
    })

    it('are checked at the startup with the declarations of the subclass', (): void => {
        const declare = (target: Function, options: Record<string, unknown>): any => ({class: target, [OBJECT_ID]: 'server', ...options})
        assert.doesNotThrow((): void => CheckObjectOptions([declare(NamedPortServer, {port: 'http'})]))
        assert.throws((): void => CheckObjectOptions([declare(NamedPortServer, {port: 8080})]), (error: Error): boolean => error instanceof InvalidObjectOptionsException && /"port" must be one of/.test(error.message))
        assert.throws((): void => CheckObjectOptions([declare(Server, {port: 'http'})]), /"port" must be a number/)
        assert.throws((): void => CheckObjectOptions([declare(RangedServer, {port: 80})]), /greater than or equal to 1000/)
    })
})

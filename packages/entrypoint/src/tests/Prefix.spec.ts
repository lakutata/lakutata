import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container, type IBaseObjectConstructor} from '@lakutata/core'
import {
    BuildCLIEntrypoint,
    BuildEntrypoints,
    BuildHTTPEntrypoint,
    BuildServiceEntrypoint,
    CLIContext,
    CLIEntrypointHandler,
    CLIMap,
    Controller,
    Entrypoint,
    HTTPRouteMap,
    InvalidPrefixException,
    ServiceContext,
    ServiceEntrypointHandler
} from '../exports/Entrypoint.js'
import {CLIAction, DELETE, GET, Prefix, ServiceAction} from '../exports/CTRLDecorators.js'

abstract class CrudController extends Controller {
    @GET('/:id')
    @CLIAction('get')
    @ServiceAction({act: 'get'})
    public async get(): Promise<string> {
        return `${this.constructor.name}.get`
    }

    @DELETE('/')
    @ServiceAction({act: 'remove'}, {description: 'Remove'})
    public async remove(): Promise<string> {
        return `${this.constructor.name}.remove`
    }
}

@Prefix({route: '/users/', command: 'user', pattern: {resource: 'user'}})
class UserController extends CrudController {
}

@Prefix({route: 'orders', command: 'order', pattern: {resource: 'order'}})
class OrderController extends CrudController {
}

//Without its own prefixes, a controller has the prefixes of its parent class
class AdminUserController extends UserController {
    @GET('/admin')
    public async admin(): Promise<string> {
        return 'admin'
    }
}

class PlainController extends Controller {
    @GET('/plain')
    @CLIAction('plain')
    @ServiceAction({act: 'plain'})
    public async plain(): Promise<string> {
        return 'plain'
    }
}

type Created = {
    entrypoint: Entrypoint
    container: Container
    routes: HTTPRouteMap
    commands: CLIMap
    service: ServiceEntrypointHandler
    cli: CLIEntrypointHandler
}

/**
 * Create an entrypoint with controllers
 * @param controllers
 */
async function Create(controllers: IBaseObjectConstructor<Controller>[]): Promise<Created> {
    const created: Partial<Created> = {container: new Container()}
    created.entrypoint = await created.container!.set(Entrypoint, BuildEntrypoints({
        controllers: controllers,
        service: BuildServiceEntrypoint((module, handler): unknown => created.service = handler),
        cli: BuildCLIEntrypoint((module, cliMap, handler): unknown => {
            created.commands = cliMap
            return created.cli = handler
        }),
        http: BuildHTTPEntrypoint((module, routeMap): unknown => created.routes = routeMap)
    }))
    return created as Created
}

describe('Controller prefixes', (): void => {

    it('prefix the routes, the commands and the service patterns', async (): Promise<void> => {
        const {container, routes, commands, service, cli} = await Create([UserController, OrderController, PlainController])
        assert.deepStrictEqual([...routes.entries()].map(([route, methods]): string => `${[...methods].join(',')} ${route}`).sort(), [
            'delete /orders', 'delete /users', 'get /orders/:id', 'get /plain', 'get /users/:id'
        ])
        assert.deepStrictEqual([...commands.keys()].sort(), ['order:get', 'plain', 'user:get'])
        //The actions of a shared parent class are run by each controller
        assert.strictEqual(await service(new ServiceContext({data: {resource: 'user', act: 'get'}})), 'UserController.get')
        assert.strictEqual(await service(new ServiceContext({data: {resource: 'order', act: 'get'}})), 'OrderController.get')
        assert.strictEqual(await cli(new CLIContext({command: 'order:get', data: {}})), 'OrderController.get')
        assert.strictEqual(await service(new ServiceContext({data: {act: 'plain'}})), 'plain')
        await container.destroy()
    })

    it('name the prefixed actions after their controllers', async (): Promise<void> => {
        const {entrypoint, container} = await Create([UserController, OrderController, PlainController])
        const actions = entrypoint.getHttpActions().actions
        const names: string[] = actions.map((action): string => `${action.name} ${action.route}`).sort()
        assert.deepStrictEqual(names, [
            'OrderController:get /orders/:id', 'OrderController:remove /orders', 'PlainController:plain /plain', 'UserController:get /users/:id', 'UserController:remove /users'
        ])
        assert.strictEqual(new Set(actions.map((action): string => action.id)).size, actions.length)
        await container.destroy()
    })

    it('keep the explicit names, which must stay unique', async (): Promise<void> => {
        abstract class NamedController extends Controller {
            @ServiceAction({act: 'named'}, {name: 'named'})
            public async named(): Promise<void> {
            }
        }

        @Prefix({pattern: {resource: 'a'}})
        class AController extends NamedController {
        }

        @Prefix({pattern: {resource: 'b'}})
        class BController extends NamedController {
        }

        const {entrypoint, container} = await Create([AController])
        assert.deepStrictEqual(entrypoint.getServiceActions().actions.map((action): string => action.name), ['named'])
        await container.destroy()
        await assert.rejects(Create([AController, BController]), {name: 'DuplicateActionNameException'})
    })

    it('keep the actions without prefix as they are', async (): Promise<void> => {
        const {entrypoint, container} = await Create([PlainController])
        const [action] = entrypoint.getHttpActions().actions
        assert.strictEqual(action.name, 'PlainController:plain')
        const reference = await Create([PlainController])
        assert.strictEqual(reference.entrypoint.getHttpActions().actions[0].id, action.id)
        await container.destroy()
        await reference.container.destroy()
    })

    it('use the prefixes of the nearest class', async (): Promise<void> => {
        const {routes, container} = await Create([AdminUserController])
        assert.deepStrictEqual([...routes.keys()].sort(), ['/users', '/users/:id', '/users/admin'])
        await container.destroy()
    })

    it('reject a pattern prefix conflicting with a pattern', async (): Promise<void> => {
        @Prefix({pattern: {act: 'other'}})
        class ConflictController extends Controller {
            @ServiceAction({act: 'get'})
            public async get(): Promise<void> {
            }
        }

        await assert.rejects(Create([ConflictController]), InvalidPrefixException)
    })
})

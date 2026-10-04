import assert from 'node:assert'
import {createServer, type Server} from 'node:http'
import express, {type Express, type Request, type Response} from 'express'
import {Server as SocketIOServer, type Socket as ServerSocket} from 'socket.io'
import {io, type Socket} from 'socket.io-client'
import {Application, DTO, Exception, type Module} from '../../../exports/Lakutata.js'
import {
    BuildCLIEntrypoint,
    BuildEntrypoints,
    BuildHTTPEntrypoint,
    BuildServiceEntrypoint,
    CLIContext,
    Controller,
    HTTPContext,
    ServiceContext,
    type CLIEntrypointHandler,
    type CLIMap,
    type EntrypointDestroyerRegistrar,
    type HTTPEntrypointHandler,
    type HTTPRouteMap,
    type ServiceEntrypointHandler
} from '../../../exports/EntrypointComponent.js'
import {CLIAction, GET, POST, ServiceAction} from '../../../exports/CTRLDecorators.js'
import {Inject} from '../../../exports/DIDecorators.js'
import {Expect} from '../../../exports/DTODecorators.js'
import {Column, Entity, PrimaryGeneratedColumn} from '../../../exports/ORMDecorators.js'
import {BuildDatabaseOptions, Database} from '../../../exports/DatabaseComponent.js'
import {As, ObjectPath} from '../../../exports/Utils.js'
import {FreePort, RunChecks} from '../support/Scenario.js'

/**
 * The responses of the HTTP entrypoint of the applications of lakutata 2.x
 */
type APIResponse = {
    errno: string | null
    errMsg: string | null
    data: unknown
}

class DeviceNotFoundException extends Exception {
    public errno: string = 'E_DEVICE_NOT_FOUND'
}

@Entity('device')
class Device {
    @PrimaryGeneratedColumn('uuid')
    public id: string

    @Column()
    public sn: string
}

class DeviceDTO extends DTO {
    @Expect(DTO.String().required())
    public sn: string
}

class DeviceController extends Controller {
    @Inject('db')
    protected readonly db: Database

    //The verbs of the routes are given in lower case, as express names its methods
    @POST('/devices', DeviceDTO)
    @ServiceAction({act: 'createDevice'}, DeviceDTO)
    @CLIAction('create-device', DeviceDTO)
    public async create(input: DeviceDTO): Promise<Device> {
        return await this.db.getRepository(Device).save({sn: input.sn})
    }

    @GET('/devices/:id')
    public async find(input: { id: string }): Promise<Device> {
        const device: Device | null = await this.db.getRepository(Device).findOneBy({id: input.id})
        if (!device) throw new DeviceNotFoundException('Device {id} not found', {id: input.id})
        return device
    }
}

const [httpPort, ioPort] = [await FreePort(), await FreePort()]
let cliMap: CLIMap
let cliHandler: CLIEntrypointHandler

/**
 * The HTTP entrypoint as the applications of lakutata 2.x build it: an Express application whose routes are the ones
 * of the route map, the results enveloped
 */
const SetupHttpEntrypoint = (): ReturnType<typeof BuildHTTPEntrypoint> => BuildHTTPEntrypoint(async (module: Module, routeMap: HTTPRouteMap, handler: HTTPEntrypointHandler, onDestroy: EntrypointDestroyerRegistrar): Promise<void> => {
    const app: Express = express()
    app.use(express.json())
    const db: Database = await module.getObject<Database>('db')
    app.get('/health', (_req: Request, res: Response): void => void res.send({errno: null, errMsg: null, data: {database: db.manager.connection.isInitialized}}))
    routeMap.forEach((methods: Set<string>, route: string): void => {
        methods.forEach((method: string): void => {
            As<Record<string, (route: string, handler: (req: Request, res: Response) => void) => void>>(app)[method](route, (req: Request, res: Response): void => {
                handler(new HTTPContext({
                    route: route,
                    method: method,
                    request: req,
                    response: res,
                    data: {...As<Record<string, string>>(req.params ?? {}), ...As<Record<string, string>>(req.query ?? {}), ...(req.body ?? {})}
                }))
                    .then((data: unknown): Response => res.send({errno: null, errMsg: null, data: data} satisfies APIResponse))
                    .catch((error: Error): Response => res.send({errno: ObjectPath.get(error, 'errno') ?? 'E_UNKNOWN', errMsg: error.message, data: null} satisfies APIResponse))
            })
        })
    })
    const server: Server = app.listen(httpPort, '127.0.0.1')
    onDestroy((): Promise<void> => new Promise((resolve: () => void): unknown => server.close((): void => resolve())))
})

Application
    .run(() => ({
        id: 'integration.legacy',
        name: 'IntegrationLegacy',
        components: {
            log: {level: 'warn'},
            db: BuildDatabaseOptions({type: 'sqlite', database: ':memory:', entities: [Device], synchronize: true}),
            entrypoint: BuildEntrypoints({
                controllers: [DeviceController],
                http: SetupHttpEntrypoint(),
                service: BuildServiceEntrypoint((_module: Module, handler: ServiceEntrypointHandler, onDestroy: EntrypointDestroyerRegistrar): void => {
                    const server: Server = createServer()
                    const ioServer: SocketIOServer = new SocketIOServer(server)
                    ioServer.on('connection', (socket: ServerSocket): void => {
                        socket.on('message', (data: Record<string, unknown>, ack: (response: unknown) => void): void => {
                            handler(new ServiceContext({data: data}))
                                .then((result: unknown): void => ack({ok: true, result: result}))
                                .catch((error: Error): void => ack({ok: false, errno: ObjectPath.get(error, 'errno'), message: error.message}))
                        })
                    })
                    server.listen(ioPort, '127.0.0.1')
                    onDestroy((): Promise<void> => new Promise((resolve: () => void): unknown => ioServer.close((): void => resolve())))
                }),
                cli: BuildCLIEntrypoint((_module: Module, map: CLIMap, handler: CLIEntrypointHandler): void => {
                    cliMap = map
                    cliHandler = handler
                })
            })
        },
        bootstrap: ['entrypoint']
    }))
    .onLaunched((app: Application): Promise<void> => RunChecks(app, async (check): Promise<void> => {
        const request = async (method: string, route: string, body?: unknown): Promise<APIResponse> => await (await fetch(`http://127.0.0.1:${httpPort}${route}`, {
            method: method,
            headers: body ? {'content-type': 'application/json'} : {},
            body: body ? JSON.stringify(body) : undefined
        })).json() as APIResponse
        //The 2.x builders are not awaited (as in 2.x): the server of the HTTP builder listens once it got its objects
        for (let attempt: number = 0; attempt < 100; attempt++) {
            if (await request('GET', '/health').then((): boolean => true, (): boolean => false)) break
            await new Promise((resolve): unknown => setTimeout(resolve, 50))
        }

        await check('the HTTP entrypoint gets the objects of the module', async (): Promise<void> => {
            assert.deepStrictEqual(await request('GET', '/health'), {errno: null, errMsg: null, data: {database: true}})
        })

        let id: string = ''
        await check('the routes of the route map run the actions, their results enveloped', async (): Promise<void> => {
            const created: APIResponse = await request('POST', '/devices', {sn: 'SN-1'})
            assert.strictEqual(created.errno, null, JSON.stringify(created))
            id = (created.data as Device).id
            assert.match(id, /^[0-9a-f-]{36}$/)
            assert.deepStrictEqual(await request('GET', `/devices/${id}`), {errno: null, errMsg: null, data: {id: id, sn: 'SN-1'}})
        })

        await check('the errors give their errno and their message, templated with their data', async (): Promise<void> => {
            assert.deepStrictEqual(await request('GET', '/devices/unknown'), {errno: 'E_DEVICE_NOT_FOUND', errMsg: 'Device unknown not found', data: null})
            const invalid: APIResponse = await request('POST', '/devices', {})
            assert.strictEqual(invalid.errno, 'E_INVALID_VALUE')
            assert.match(String(invalid.errMsg), /"sn" is required/)
        })

        await check('the service entrypoint runs the actions of its patterns', async (): Promise<void> => {
            const socket: Socket = io(`http://127.0.0.1:${ioPort}`, {transports: ['websocket']})
            try {
                const created = await socket.timeout(5000).emitWithAck('message', {act: 'createDevice', sn: 'SN-2'})
                assert.strictEqual(created.ok, true, JSON.stringify(created))
                assert.strictEqual(created.result.sn, 'SN-2')
                const unknown = await socket.timeout(5000).emitWithAck('message', {act: 'removeDevice'})
                assert.strictEqual(unknown.ok, false)
                assert.ok(unknown.errno, JSON.stringify(unknown))
            } finally {
                socket.disconnect()
            }
        })

        await check('the CLI entrypoint gets the commands and the JSON schemas of their DTOs, and runs them', async (): Promise<void> => {
            assert.ok(cliMap.has('create-device'), [...cliMap.keys()].join(','))
            assert.deepStrictEqual(Object.keys(As<{ properties: Record<string, unknown> }>(cliMap.get('create-device')).properties), ['sn'])
            const created: Device = As<Device>(await cliHandler(new CLIContext({command: 'create-device', data: {sn: 'SN-3'}})))
            assert.strictEqual(created.sn, 'SN-3')
        })

        await check('the actions of every entrypoint share the database', async (): Promise<void> => {
            const db: Database = await app.getObject<Database>('db')
            assert.deepStrictEqual((await db.getRepository(Device).find({order: {sn: 'ASC'}})).map((device: Device): string => device.sn), ['SN-1', 'SN-2', 'SN-3'])
        })
    }))
    .onFatalException((error: Error): number => {
        console.error(error)
        return 1
    })

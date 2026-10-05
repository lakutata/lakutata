import assert from 'node:assert'
import EventEmitter from 'node:events'
import {mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {io, type Socket} from 'socket.io-client'
import {Application, DTO, Provider, type ILogger} from '../../../exports/Lakutata.js'
import {AccessControlRule, buildEntrypoints, ContextType, Controller, scheduleEntrypoint, type ActionInvocation, type HTTPContext, type Next} from '../../../exports/EntrypointComponent.js'
import {expressHTTPEntrypoint, jsonEnvelope, staticUI} from '../../../exports/ExpressAdapter.js'
import {fastifyHTTPEntrypoint, fastifyJSONEnvelope} from '../../../exports/FastifyAdapter.js'
import {socketIOServiceEntrypoint} from '../../../exports/SocketIOAdapter.js'
import {commanderCLIEntrypoint} from '../../../exports/CommanderAdapter.js'
import {electronIPCServiceEntrypoint, type IPCMain} from '../../../exports/ElectronAdapter.js'
import {CLIAction, GET, POST, Schedule, ServiceAction} from '../../../exports/CTRLDecorators.js'
import {Configurable, Inject} from '../../../exports/DIDecorators.js'
import {Accept, Expect} from '../../../exports/DTODecorators.js'
import {Column, Entity, PrimaryGeneratedColumn} from '../../../exports/ORMDecorators.js'
import type {MigrationInterface, QueryRunner, Repository} from '../../../exports/ORM.js'
import {buildDatabaseOptions, Database} from '../../../exports/DatabaseComponent.js'
import {buildCacherOptions, Cacher} from '../../../exports/CacherComponent.js'
import {PasswordHash} from '../../../exports/PasswordHashProvider.js'
import {freePort, MemoryStream, runChecks} from '../support/Scenario.js'

@Entity('order')
class Order {
    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public customer: string

    @Column('real')
    public total: number
}

/**
 * The table of the orders, created by its migration when the database connects
 */
class CreateOrder1700000000000 implements MigrationInterface {
    public name: string = 'CreateOrder1700000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('CREATE TABLE "order" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "customer" varchar NOT NULL, "total" real NOT NULL)')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE "order"')
    }
}

/**
 * A provider configured by the application, its method validating its argument
 */
class PriceCalculator extends Provider {
    @Configurable(DTO.Number().min(0).max(1).optional().default(0))
    protected readonly taxRate: number

    @Accept(DTO.Number().min(0).required())
    public async total(amount: number): Promise<number> {
        return Math.round(amount * (1 + this.taxRate) * 100) / 100
    }
}

class CreateOrderDTO extends DTO {
    @Expect(DTO.String().required())
    public customer: string

    @Expect(DTO.Number().required())
    public amount: number
}

class RegisterDTO extends DTO {
    @Expect(DTO.String().required())
    public name: string

    @Expect(DTO.String().min(8).required())
    public password: string
}

/**
 * The actions of the administrators need the header x-role: admin (HTTP)
 */
class AdminRule extends AccessControlRule {
    public get supportContextTypes(): ContextType[] {
        return [ContextType.HTTP]
    }

    public async rule(): Promise<boolean> {
        return (this.context as unknown as HTTPContext).request.headers['x-role'] === 'admin'
    }
}

/**
 * The actions run, counted by a middleware of the entrypoint
 */
const invocations: string[] = []

/**
 * The runs of the scheduled action
 */
let heartbeats: number = 0

/**
 * The ipcMain of Electron: the actions are invoked as by a renderer (the windows are run by the tests of the Electron templates)
 */
class RendererIPCMain implements IPCMain {
    public readonly handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown> = new Map()

    public handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
        this.handlers.set(channel, listener)
    }

    public removeHandler(channel: string): void {
        this.handlers.delete(channel)
    }

    /**
     * Invoke a channel as a renderer, its web contents emitting their events
     * @param channel
     * @param data
     */
    public async invoke(channel: string, data: unknown): Promise<any> {
        return await this.handlers.get(channel)!({sender: Object.assign(new EventEmitter(), {id: 1})}, data)
    }
}

const ipcMain: RendererIPCMain = new RendererIPCMain()

/**
 * The built user interface served by Express
 */
const ui: string = mkdtempSync(path.join(tmpdir(), 'lakutata-ui-'))
writeFileSync(path.join(ui, 'index.html'), '<!doctype html><title>orders</title><div id="app"></div>')
writeFileSync(path.join(ui, 'main.js'), 'console.log("orders")')

async function countInvocations(invocation: ActionInvocation, next: Next): Promise<unknown> {
    invocations.push(invocation.action.name)
    return await next()
}

class OrderController extends Controller {
    @Inject('db')
    protected readonly db: Database

    @Inject('cache')
    protected readonly cache: Cacher

    @Inject('calculator')
    protected readonly calculator: PriceCalculator

    @Inject('passwordHash')
    protected readonly passwordHash: PasswordHash

    @Inject('log')
    protected readonly log: ILogger

    protected get orders(): Repository<Order> {
        return this.db.getRepository(Order)
    }

    @POST('/orders', CreateOrderDTO)
    @ServiceAction({act: 'createOrder'}, CreateOrderDTO)
    public async create(input: CreateOrderDTO): Promise<Order> {
        const order: Order = await this.orders.save({customer: input.customer, total: await this.calculator.total(input.amount)})
        await this.cache.del('orders:count')
        this.log.info('order %d created for %s', order.id, order.customer)
        return order
    }

    @GET('/orders/count')
    @CLIAction('count-orders')
    @ServiceAction({act: 'countOrders'})
    public async count(): Promise<{ count: number }> {
        return {count: await this.cache.wrap('orders:count', (): Promise<number> => this.orders.count())}
    }

    @POST('/users', RegisterDTO)
    public async register(input: RegisterDTO): Promise<{ name: string, verified: boolean, rejected: boolean }> {
        const hash: string = await this.passwordHash.hash(input.password)
        return {name: input.name, verified: await this.passwordHash.validate(input.password, hash), rejected: await this.passwordHash.validate(`${input.password}!`, hash)}
    }

    @Schedule({every: '50ms', immediate: true})
    public async heartbeat(): Promise<void> {
        heartbeats++
    }

    @GET('/admin/orders', {acl: true})
    public async all(): Promise<Order[]> {
        return await this.orders.find({order: {id: 'ASC'}})
    }
}

const [expressPort, fastifyPort, ioPort] = [await freePort(), await freePort(), await freePort()]
const logs: MemoryStream = new MemoryStream()
const cliOutput: MemoryStream = new MemoryStream()
let cliExited: (code: number) => void
const cliCode: Promise<number> = new Promise((resolve: (code: number) => void): unknown => cliExited = resolve)

Application
    .env({SCENARIO: 'service'})
    .run(() => ({
        id: 'integration.service',
        name: 'IntegrationService',
        components: {
            log: {pretty: false, sync: true, destinations: [logs]},
            db: buildDatabaseOptions({type: 'sqlite', database: ':memory:', entities: [Order], synchronize: false, migrationsRun: true, migrations: [CreateOrder1700000000000]}),
            cache: buildCacherOptions({}),
            entrypoint: buildEntrypoints({
                controllers: [OrderController],
                rules: [AdminRule],
                middlewares: [countInvocations],
                http: [
                    expressHTTPEntrypoint({port: expressPort, host: '127.0.0.1', respond: jsonEnvelope({errorStatus: 200}), fallback: staticUI(ui, {spa: true})}),
                    fastifyHTTPEntrypoint({port: fastifyPort, host: '127.0.0.1', respond: fastifyJSONEnvelope({errorStatus: 200})})
                ],
                service: [socketIOServiceEntrypoint({port: ioPort, host: '127.0.0.1'}), electronIPCServiceEntrypoint({ipcMain: ipcMain})],
                schedule: scheduleEntrypoint(),
                cli: commanderCLIEntrypoint({bin: 'service', argv: ['count-orders'], interactive: false, stdout: cliOutput, exit: (code: number): void => cliExited(code)})
            })
        },
        providers: {
            calculator: {class: PriceCalculator, taxRate: 0.2},
            passwordHash: {class: PasswordHash}
        },
        bootstrap: ['db', 'entrypoint']
    }))
    .onLaunched((app: Application): Promise<void> => runChecks(app, async (check): Promise<void> => {
        const post = async (port: number, route: string, body: unknown, headers: Record<string, string> = {}): Promise<any> => await (await fetch(`http://127.0.0.1:${port}${route}`, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)})).json()
        const get = async (port: number, route: string, headers: Record<string, string> = {}): Promise<any> => await (await fetch(`http://127.0.0.1:${port}${route}`, {headers: headers})).json()

        await check('the environment of the application is set', (): void => {
            assert.strictEqual(process.env.SCENARIO, 'service')
        })

        await check('the command line runs its command once launched: no order yet', async (): Promise<void> => {
            assert.strictEqual(await cliCode, 0)
            assert.match(cliOutput.text(), /"count":\s*0/)
        })

        await check('an order created through Express is saved in the database migrated, its total computed by the provider configured', async (): Promise<void> => {
            const created = await post(expressPort, '/orders', {customer: 'ada', amount: 100})
            assert.strictEqual(created.errno, null, JSON.stringify(created))
            assert.deepStrictEqual(created.data, {id: 1, customer: 'ada', total: 120})
        })

        await check('the same action through Fastify and Socket.IO, with the same validation', async (): Promise<void> => {
            assert.strictEqual((await post(fastifyPort, '/orders', {customer: 'grace', amount: 10})).data.total, 12)
            const socket: Socket = io(`http://127.0.0.1:${ioPort}`, {transports: ['websocket']})
            try {
                //The results of Socket.IO are {success, payload, error}
                const created = await socket.timeout(5000).emitWithAck('message', {act: 'createOrder', customer: 'linus', amount: 5})
                assert.deepStrictEqual(created, {success: true, payload: {id: 3, customer: 'linus', total: 6}, error: null})
                const invalid = await socket.timeout(5000).emitWithAck('message', {act: 'createOrder', customer: 'linus'})
                assert.strictEqual(invalid.success, false)
                assert.strictEqual(invalid.error.errno, 'E_INVALID_VALUE')
                assert.strictEqual(invalid.error.message, '"amount" is required')
            } finally {
                socket.disconnect()
            }
            const missing = await post(expressPort, '/orders', {customer: 'ada'})
            assert.strictEqual(missing.errno, 'E_INVALID_VALUE')
            assert.match(missing.errMsg, /"amount" is required/)
        })

        await check('the count is cached until an order is created', async (): Promise<void> => {
            assert.deepStrictEqual((await get(expressPort, '/orders/count')).data, {count: 3})
            await app.getObject<Database>('db').then((db: Database): Promise<unknown> => db.query('DELETE FROM "order" WHERE id = 3'))
            //Cached: the order deleted without the action is still counted
            assert.deepStrictEqual((await get(fastifyPort, '/orders/count')).data, {count: 3})
            await post(expressPort, '/orders', {customer: 'barbara', amount: 1})
            assert.deepStrictEqual((await get(expressPort, '/orders/count')).data, {count: 3})
        })

        await check('the provider rejects an invalid argument through its schema', async (): Promise<void> => {
            const negative = await post(expressPort, '/orders', {customer: 'ada', amount: -1})
            assert.strictEqual(negative.errno, 'E_INVALID_METHOD_ACCEPT', JSON.stringify(negative))
        })

        await check('the passwords are hashed and verified by the provider', async (): Promise<void> => {
            assert.deepStrictEqual((await post(expressPort, '/users', {name: 'ada', password: 'correct horse'})).data, {name: 'ada', verified: true, rejected: false})
            assert.strictEqual((await post(expressPort, '/users', {name: 'ada', password: 'short'})).errno, 'E_INVALID_VALUE')
        })

        await check('the actions of the access control need their rule', async (): Promise<void> => {
            const denied = await get(expressPort, '/admin/orders')
            assert.strictEqual(denied.errno, 'E_ACCESS_DENY', JSON.stringify(denied))
            const allowed = await get(fastifyPort, '/admin/orders', {'x-role': 'admin'})
            assert.deepStrictEqual(allowed.data.map((order: Order): string => order.customer), ['ada', 'grace', 'barbara'])
        })

        await check('an unknown route is not found', async (): Promise<void> => {
            assert.strictEqual((await get(fastifyPort, '/unknown')).errno, 'E_ROUTE_NOT_FOUND')
        })

        await check('Express serves the user interface besides the actions, its routes to its index', async (): Promise<void> => {
            const page = (route: string): Promise<Response> => fetch(`http://127.0.0.1:${expressPort}${route}`, {headers: {accept: 'text/html'}})
            assert.match(await (await page('/')).text(), /<title>orders<\/title>/)
            assert.match(await (await page('/settings/profile')).text(), /<div id="app">/)
            //The paths under the prefixes of the actions are the ones of the actions, not of the interface
            assert.strictEqual((await (await page('/orders/42/edit')).json() as Record<string, unknown>).errno, 'E_ROUTE_NOT_FOUND')
            const script: Response = await page('/main.js')
            assert.match(String(script.headers.get('content-type')), /javascript/)
            assert.strictEqual(await script.text(), 'console.log("orders")')
            //The actions keep their routes
            assert.deepStrictEqual((await get(expressPort, '/orders/count')).data, {count: 3})
        })

        await check('the renderers of Electron invoke the actions over IPC', async (): Promise<void> => {
            assert.deepStrictEqual(await ipcMain.invoke('lakutata:service', {act: 'countOrders'}), {success: true, payload: {count: 3}, error: null})
            const invalid = await ipcMain.invoke('lakutata:service', {act: 'createOrder', customer: 'ada'})
            assert.strictEqual(invalid.success, false)
            assert.strictEqual(invalid.error.errno, 'E_INVALID_VALUE')
        })

        await check('the scheduled action runs at its interval, through the middlewares', async (): Promise<void> => {
            const before: number = heartbeats
            await new Promise((resolve: (value?: unknown) => void): unknown => setTimeout(resolve, 300))
            assert.ok(heartbeats - before >= 3, `${heartbeats - before} runs in 300ms`)
            assert.ok(invocations.includes('OrderController:heartbeat'), invocations.join(','))
        })

        await check('the middleware of the entrypoint ran for every transport', (): void => {
            //The actions are named <controller>:<method>; the orders were created through Express, Fastify and Socket.IO
            assert.ok(invocations.includes('OrderController:count'), invocations.join(','))
            assert.ok(invocations.filter((name: string): boolean => name === 'OrderController:create').length >= 4, invocations.join(','))
        })

        await check('the logger writes the messages of the objects into its destinations', (): void => {
            const lines: Record<string, any>[] = logs.text().trim().split('\n').map((line: string): Record<string, any> => JSON.parse(line))
            assert.ok(lines.some((line: Record<string, any>): boolean => line.msg === 'order 1 created for ada'), logs.text())
        })
    }))
    .onFatalException((error: Error): number => {
        console.error(error)
        return 1
    })

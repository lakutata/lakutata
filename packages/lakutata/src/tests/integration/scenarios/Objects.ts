import assert from 'node:assert'
import {existsSync, mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Application, Component, DTO, Module, Provider, type ModuleOptions} from '../../../exports/Lakutata.js'
import {BuildEntrypoints, Controller} from '../../../exports/EntrypointComponent.js'
import {ExpressHTTPEntrypoint, JSONEnvelope} from '../../../exports/ExpressAdapter.js'
import {GET} from '../../../exports/CTRLDecorators.js'
import {Autoload, Configurable, Inject, Scoped, Transient} from '../../../exports/DIDecorators.js'
import {After, Before} from '../../../exports/ASSTDecorators.js'
import {Column, Entity, PrimaryGeneratedColumn} from '../../../exports/ORMDecorators.js'
import {BuildDatabaseOptions as BuildDatabaseProviderOptions, Database as DatabaseProvider} from '../../../exports/DatabaseProvider.js'
import {Logger} from '../../../exports/LoggerComponent.js'
import {CpuMonitor, EventLoopMonitor, HttpRequestMonitor, MemoryMonitor} from '../../../exports/MonitorComponent.js'
import {UUID} from '../../../exports/Utils.js'
import {FreePort, MemoryStream, RunChecks} from '../support/Scenario.js'

@Entity('visit')
class Visit {
    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public request: string
}

/**
 * One per request: the objects of a request share it
 */
@Scoped()
class RequestId extends Provider {
    public readonly id: string = UUID.v4()
}

/**
 * A provider of the request using the request id
 */
@Scoped()
class Visitor extends Provider {
    @Inject('requestId')
    public readonly requestId: RequestId
}

let stamps: number = 0

/**
 * One per injection
 */
@Transient()
class Stamp extends Provider {
    public readonly value: number = ++stamps
}

/**
 * One for the application (a component)
 */
class Counter extends Component {
    public value: number = 0
}

/**
 * Registered when it is first injected, without declaration
 */
@Autoload()
@Transient()
class Clock extends Provider {
    public now(): number {
        return 1700000000000
    }
}

/**
 * A provider whose method is assisted: its arguments prepared before it, its result after it
 */
class PriceFormatter extends Provider {
    @Configurable(DTO.String().optional().default('EUR'))
    protected readonly currency: string

    @Before(function (this: PriceFormatter, amount: number): [number] {
        return [Math.max(0, Math.round(amount * 100) / 100)]
    })
    @After(function (this: PriceFormatter, formatted: string): string {
        return `${formatted} ${this.currency}`
    })
    public format(amount: number): string {
        return amount.toFixed(2)
    }
}

/**
 * The component of a module of the application
 */
class Ledger extends Component {
    @Inject('counter')
    public readonly counter: Counter

    public owner(): Module {
        return this.getModule()
    }
}

/**
 * A module of the application, with its own objects
 */
class AccountingModule extends Module {
    protected options: ModuleOptions = {
        components: {ledger: {class: Ledger}},
        providers: {formatter: {class: PriceFormatter, currency: 'CNY'}},
        bootstrap: ['ledger']
    }
}

class ObjectController extends Controller {
    @Inject('requestId')
    protected readonly requestId: RequestId

    @Inject('visitor')
    protected readonly visitor: Visitor

    @Inject('stamp')
    protected readonly firstStamp: Stamp

    @Inject('stamp')
    protected readonly secondStamp: Stamp

    @Inject('counter')
    protected readonly counter: Counter

    @Inject(Clock)
    protected readonly clock: Clock

    @Inject('visits')
    protected readonly visits: DatabaseProvider

    @GET('/objects')
    public async objects(): Promise<Record<string, unknown>> {
        await this.visits.getRepository(Visit).save({request: this.requestId.id})
        return {
            request: this.requestId.id,
            sharedInTheRequest: this.visitor.requestId === this.requestId,
            stamps: [this.firstStamp.value, this.secondStamp.value],
            counter: ++this.counter.value,
            now: this.clock.now(),
            visits: await this.visits.getRepository(Visit).count(),
            connection: this.visits.manager.connection.options.database
        }
    }
}

const port: number = await FreePort()
const scenario: string = mkdtempSync(path.join(tmpdir(), 'lakutata-objects-'))
const audit: MemoryStream = new MemoryStream()
const connections: unknown[] = []

Application
    //The aliases of the paths, as the projects declare theirs: an alias of an alias, the directories created
    .alias({'@scenario': scenario, '@data': '@scenario/data', '@sessions': '@data/sessions'}, true)
    .run(() => ({
        id: 'integration.objects',
        name: 'IntegrationObjects',
        components: {
            log: {level: 'warn'},
            audit: {class: Logger, pretty: false, sync: true, level: 'info', destinations: [audit]},
            counter: {class: Counter},
            cpu: {class: CpuMonitor},
            memory: {class: MemoryMonitor},
            eventLoop: {class: EventLoopMonitor},
            httpRequests: {class: HttpRequestMonitor},
            entrypoint: BuildEntrypoints({
                controllers: [ObjectController],
                http: ExpressHTTPEntrypoint({port: port, host: '127.0.0.1', respond: JSONEnvelope({errorStatus: 200})})
            })
        },
        //The modules are objects of the application
        objects: {named: {accounting: {class: AccountingModule}}},
        providers: {
            requestId: {class: RequestId},
            visitor: {class: Visitor},
            stamp: {class: Stamp},
            //A database provider: a connection per object, given to the objects of a request (its file in an alias)
            visits: BuildDatabaseProviderOptions({type: 'sqlite', database: path.resolve('@data', 'visits.db'), entities: [Visit], synchronize: true})
        },
        bootstrap: ['accounting', 'httpRequests', 'entrypoint']
    }))
    .onLaunched((app: Application): Promise<void> => RunChecks(app, async (check): Promise<void> => {
        const objects = async (): Promise<Record<string, any>> => (await (await fetch(`http://127.0.0.1:${port}/objects`)).json() as { data: Record<string, any> }).data

        await check('the aliases resolve the paths, an alias of an alias too, their directories created', (): void => {
            assert.strictEqual(path.resolve('@sessions', 'a.json'), path.join(scenario, 'data', 'sessions', 'a.json'))
            assert.ok(existsSync(path.join(scenario, 'data', 'sessions')))
            assert.strictEqual(path.resolve('@runtime'), process.cwd())
        })

        let first: Record<string, any> = {}
        await check('the objects of a request share its scoped objects, the transient ones are new at each injection', async (): Promise<void> => {
            first = await objects()
            assert.strictEqual(first.sharedInTheRequest, true)
            assert.match(first.request, /^[0-9a-f-]{36}$/)
            assert.notStrictEqual(first.stamps[0], first.stamps[1])
            assert.strictEqual(first.now, 1700000000000)
        })

        await check('the requests have their own scoped objects, and share the components', async (): Promise<void> => {
            const second: Record<string, any> = await objects()
            assert.notStrictEqual(second.request, first.request)
            assert.strictEqual(second.counter, first.counter + 1)
            assert.strictEqual((await app.getObject<Counter>('counter')).value, second.counter)
        })

        await check('the database provider connects for the objects of a request, its database in a path of an alias', async (): Promise<void> => {
            const third: Record<string, any> = await objects()
            assert.strictEqual(third.visits, 3)
            assert.strictEqual(third.connection, path.join(scenario, 'data', 'visits.db'))
            assert.ok(existsSync(path.join(scenario, 'data', 'visits.db')))
            //A provider of the application gets its own connection
            const visits: DatabaseProvider = await app.getObject<DatabaseProvider>('visits')
            connections.push(visits.manager.connection)
            assert.strictEqual(await visits.getRepository(Visit).count(), 3)
        })

        await check('a module has its own objects, which reach the objects of the application', async (): Promise<void> => {
            const accounting: AccountingModule = await app.getObject<AccountingModule>('accounting')
            const ledger: Ledger = await accounting.getObject<Ledger>('ledger')
            assert.strictEqual(ledger.owner(), accounting)
            assert.strictEqual(ledger.counter, await app.getObject<Counter>('counter'))
            await assert.rejects(app.getObject('ledger'))
        })

        await check('the methods assisted by @Before and @After', async (): Promise<void> => {
            const formatter: PriceFormatter = await (await app.getObject<AccountingModule>('accounting')).getObject<PriceFormatter>('formatter')
            assert.strictEqual(formatter.format(12.345), '12.35 CNY')
            assert.strictEqual(formatter.format(-3), '0.00 CNY')
        })

        await check('a Logger component writes into its own destinations', async (): Promise<void> => {
            const logger: Logger = await app.getObject<Logger>('audit')
            logger.info({user: 'ada'}, 'signed in')
            logger.debug('below the level')
            const lines: Record<string, any>[] = audit.text().trim().split('\n').map((line: string): Record<string, any> => JSON.parse(line))
            assert.strictEqual(lines.length, 1, audit.text())
            assert.strictEqual(lines[0].msg, 'signed in')
            assert.strictEqual(lines[0].user, 'ada')
        })

        await check('the monitors give the statistics of the process, the HTTP requests received counted', async (): Promise<void> => {
            await new Promise((resolve: (value?: unknown) => void): unknown => setTimeout(resolve, 200))
            const http = (await app.getObject<HttpRequestMonitor>('httpRequests')).statistics
            assert.ok(http.count >= 3, JSON.stringify(http))
            assert.ok(http.max >= http.min && http.p99 >= http.p50, JSON.stringify(http))
            const memory = (await app.getObject<MemoryMonitor>('memory')).statistics
            assert.ok(Object.values(memory).every((value: unknown): boolean => typeof value === 'number'), JSON.stringify(memory))
            assert.strictEqual(typeof (await app.getObject<CpuMonitor>('cpu')).statistics, 'object')
            assert.strictEqual(typeof (await app.getObject<EventLoopMonitor>('eventLoop')).statistics, 'object')
        })
    }))
    .onFatalException((error: Error): number => {
        console.error(error)
        return 1
    })

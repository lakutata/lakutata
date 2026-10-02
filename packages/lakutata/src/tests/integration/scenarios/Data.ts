import assert from 'node:assert'
import {Application, DTO, Time} from '../../../exports/Lakutata.js'
import {BuildEntrypoints, Controller} from '../../../exports/EntrypointComponent.js'
import {ExpressHTTPEntrypoint, JSONEnvelope} from '../../../exports/ExpressAdapter.js'
import {GET, HTTPAction, POST} from '../../../exports/CTRLDecorators.js'
import {Inject} from '../../../exports/DIDecorators.js'
import {Expect, Return} from '../../../exports/DTODecorators.js'
import {FlexibleDTO, Paginator, PaginationResultDTO, PaginationSearchDTO, fromJsonSchema, toJsonSchema} from '../../../exports/DTOs.js'
import {Column, Entity, PrimaryGeneratedColumn} from '../../../exports/ORMDecorators.js'
import type {Repository} from '../../../exports/ORM.js'
import {BuildDatabaseOptions, Database} from '../../../exports/DatabaseComponent.js'
import {FreePort, RunChecks} from '../support/Scenario.js'

@Entity('device')
class Device {
    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public sn: string

    @Column()
    public site: string
}

/**
 * The search of the devices, paginated, as the projects declare their searches
 */
class DeviceSearchDTO extends PaginationSearchDTO {
    @Expect(DTO.String().optional())
    public site?: string
}

/**
 * The properties of a device, the unknown ones kept
 */
class DeviceTagsDTO extends FlexibleDTO {
    @Expect(DTO.String().required())
    public sn: string
}

/**
 * A query string: its values are strings, converted by the schemas not strict
 */
class ReportDTO extends DTO {
    @Expect(DTO.Number().integer().min(1).strict(false).required())
    public days: number
}

class DeviceController extends Controller {
    @Inject('db')
    protected readonly db: Database

    protected get devices(): Repository<Device> {
        return this.db.getRepository(Device)
    }

    //A route of several methods (one action: the decorators of a method give its action once)
    @HTTPAction('/devices', ['get', 'post'], DeviceSearchDTO)
    @Return(PaginationResultDTO)
    public async search(input: DeviceSearchDTO): Promise<PaginationResultDTO<Device>> {
        return await Paginator(input, async (limit: number, offset: number): Promise<{ items: Device[], total: number }> => {
            const [items, total] = await this.devices.findAndCount({where: input.site ? {site: input.site} : {}, order: {id: 'ASC'}, take: limit, skip: offset})
            return {items: items, total: total}
        })
    }

    @GET('/report', ReportDTO)
    public async report(input: ReportDTO): Promise<{ days: number }> {
        return {days: input.days}
    }

    @POST('/devices/tags', DeviceTagsDTO)
    public async tags(input: DeviceTagsDTO): Promise<DeviceTagsDTO> {
        return input
    }

    @GET('/broken')
    @Return(PaginationResultDTO)
    public async broken(): Promise<unknown> {
        return {items: 'not an array'}
    }
}

const port: number = await FreePort()

Application
    .run(() => ({
        id: 'integration.data',
        name: 'IntegrationData',
        timezone: 'Asia/Shanghai',
        components: {
            log: {level: 'warn'},
            db: BuildDatabaseOptions({type: 'sqlite', database: ':memory:', entities: [Device], synchronize: true}),
            entrypoint: BuildEntrypoints({
                controllers: [DeviceController],
                http: ExpressHTTPEntrypoint({port: port, host: '127.0.0.1', respond: JSONEnvelope({errorStatus: 200})})
            })
        },
        bootstrap: ['db', 'entrypoint']
    }))
    .onLaunched((app: Application): Promise<void> => RunChecks(app, async (check): Promise<void> => {
        const db: Database = await app.getObject<Database>('db')
        await db.getRepository(Device).save(Array.from({length: 25}, (_value: unknown, index: number): Partial<Device> => ({sn: `SN-${index + 1}`, site: index % 5 === 0 ? 'north' : 'south'})))
        const request = async (method: string, route: string, body?: unknown): Promise<any> => await (await fetch(`http://127.0.0.1:${port}${route}`, {
            method: method,
            headers: body ? {'content-type': 'application/json'} : {},
            body: body ? JSON.stringify(body) : undefined
        })).json()

        await check('a search paginates with the defaults of PaginationSearchDTO (10 items from 0)', async (): Promise<void> => {
            const page = (await request('POST', '/devices', {})).data
            assert.deepStrictEqual(page.meta, {count: 10, total: 25, limit: 10, offset: 0})
            assert.deepStrictEqual(page.items.map((device: Device): string => device.sn), Array.from({length: 10}, (_value: unknown, index: number): string => `SN-${index + 1}`))
        })

        await check('the limit, the offset and the filters are applied', async (): Promise<void> => {
            const page = (await request('POST', '/devices', {limit: 3, offset: 2, site: 'north'})).data
            assert.deepStrictEqual(page.meta, {count: 3, total: 5, limit: 3, offset: 2})
            assert.deepStrictEqual(page.items.map((device: Device): string => device.sn), ['SN-11', 'SN-16', 'SN-21'])
            const last = (await request('POST', '/devices', {limit: 10, offset: 20})).data
            assert.deepStrictEqual(last.meta, {count: 5, total: 25, limit: 10, offset: 20})
        })

        await check('the values of a query string are converted by the schemas not strict only (as lakutata 2.x)', async (): Promise<void> => {
            //The schemas are strict by default: the numbers of PaginationSearchDTO are not converted from texts
            const strict = await request('GET', '/devices?limit=3')
            assert.strictEqual(strict.errno, 'E_INVALID_VALUE')
            assert.match(strict.errMsg, /"limit" must be a number/)
            assert.deepStrictEqual((await request('GET', '/report?days=7')).data, {days: 7})
        })

        await check('an invalid pagination is rejected', async (): Promise<void> => {
            const invalid = await request('POST', '/devices', {limit: -1})
            assert.strictEqual(invalid.errno, 'E_INVALID_VALUE')
            assert.match(invalid.errMsg, /"limit"/)
        })

        await check('the results are validated by @Return', async (): Promise<void> => {
            assert.strictEqual((await request('GET', '/broken')).errno, 'E_INVALID_METHOD_RETURN')
        })

        await check('a FlexibleDTO keeps the properties it does not declare, validating the ones it declares', async (): Promise<void> => {
            assert.deepStrictEqual((await request('POST', '/devices/tags', {sn: 'SN-1', color: 'red', rack: 4})).data, {sn: 'SN-1', color: 'red', rack: 4})
            assert.strictEqual((await request('POST', '/devices/tags', {color: 'red'})).errno, 'E_INVALID_VALUE')
        })

        await check('the DTOs are described by JSON Schema and OpenAPI, and built from them', (): void => {
            const schema = DeviceSearchDTO.toJsonSchema()
            assert.deepStrictEqual(Object.keys(schema.properties ?? {}).sort(), ['limit', 'offset', 'site'])
            assert.strictEqual(DeviceSearchDTO.toOpenAPIJsonSchema().type, 'object')
            assert.deepStrictEqual(toJsonSchema(DTO.String().email()), {type: 'string', format: 'email'})
            const imported = fromJsonSchema({type: 'object', properties: {port: {type: 'integer', minimum: 1}}, required: ['port']})
            assert.ok(DTO.isValid({port: 80}, imported))
            assert.ok(!DTO.isValid({port: 0}, imported))
            const Imported = DTO.fromJsonSchema({type: 'object', properties: {name: {type: 'string'}}, required: ['name']})
            assert.ok(Imported.isValid({name: 'ada'}))
            assert.ok(!Imported.isValid({}))
        })

        await check('the times are given in the timezone of the application', (): void => {
            assert.strictEqual(app.timezone, 'Asia/Shanghai')
            assert.strictEqual(new Time('2026-10-02T00:00:00Z').format('YYYY-MM-DD HH:mm'), '2026-10-02 08:00')
        })
    }))
    .onFatalException((error: Error): number => {
        console.error(error)
        return 1
    })

import assert from 'node:assert'
import {Application} from '../../../exports/Lakutata.js'
import {DataSource} from '../../../exports/ORM.js'
import {Column, Entity, PrimaryGeneratedColumn} from '../../../exports/ORMDecorators.js'
import {buildDatabaseOptions, Database} from '../../../exports/DatabaseComponent.js'
import {buildCacherOptions, Cacher} from '../../../exports/CacherComponent.js'
import {runChecks} from '../support/Scenario.js'

/**
 * The server of the scenario: POSTGRES_URL (the PostgreSQL of packages/orm/docker-compose.test.yml), a database created
 * for the scenario and dropped at its end
 */
const server: URL = new URL(process.env.POSTGRES_URL!)
const name: string = `lakutata_integration_${process.pid}_${Date.now()}`
const databaseURL = (database: string): string => `postgres://${server.username}:${server.password}@${server.host}/${database}`
const admin: DataSource = await new DataSource({type: 'postgres', url: databaseURL('postgres')}).initialize()
await admin.query(`CREATE DATABASE "${name}"`)

@Entity('device')
class Device {
    @PrimaryGeneratedColumn('uuid')
    public id: string

    @Column({type: 'varchar', length: 64})
    public sn: string
}

/**
 * The cache stored in a table of the database, as oims declares its caches
 * @param namespace
 */
const postgresCache = (namespace: string): ReturnType<typeof buildCacherOptions> => buildCacherOptions({
    stores: {
        type: 'postgres',
        host: server.hostname,
        port: Number(server.port || 5432),
        database: name,
        table: 'user_token_cache',
        username: decodeURIComponent(server.username),
        password: decodeURIComponent(server.password),
        namespace: namespace
    },
    ttl: 60 * 60 * 1000
})

Application
    .run(() => ({
        id: 'integration.postgresql',
        name: 'IntegrationPostgreSQL',
        components: {
            log: {level: 'warn'},
            db: buildDatabaseOptions({type: 'postgres', url: databaseURL(name), entities: [Device], synchronize: true}),
            tokens: postgresCache('integration.tokens'),
            sessions: postgresCache('integration.sessions')
        },
        bootstrap: ['db']
    }))
    .onLaunched((app: Application): Promise<void> => runChecks(app, async (check): Promise<void> => {
        try {
            const tokens: Cacher = await app.getObject<Cacher>('tokens')
            const sessions: Cacher = await app.getObject<Cacher>('sessions')

            await check('the cache stores its values in the table of PostgreSQL', async (): Promise<void> => {
                await tokens.set('ada', {token: 'abc', roles: ['admin']})
                assert.deepStrictEqual(await tokens.get('ada'), {token: 'abc', roles: ['admin']})
                const db: Database = await app.getObject<Database>('db')
                const rows: { key: string }[] = await db.query('SELECT key FROM user_token_cache')
                assert.ok(rows.some((row: { key: string }): boolean => row.key.includes('ada')), JSON.stringify(rows))
            })

            await check('the caches sharing the table are separated by their namespaces', async (): Promise<void> => {
                assert.strictEqual(await sessions.get('ada'), undefined)
                await sessions.set('ada', 'session')
                assert.strictEqual(await sessions.get('ada'), 'session')
                assert.deepStrictEqual(await tokens.get('ada'), {token: 'abc', roles: ['admin']})
            })

            await check('the values expire with their time to live, and are deleted', async (): Promise<void> => {
                await tokens.set('short', 'lived', 100)
                assert.strictEqual(await tokens.get('short'), 'lived')
                await new Promise((resolve: (value?: unknown) => void): unknown => setTimeout(resolve, 250))
                assert.strictEqual(await tokens.get('short'), undefined)
                await tokens.del('ada')
                assert.strictEqual(await tokens.get('ada'), undefined)
                assert.strictEqual(await sessions.get('ada'), 'session')
            })

            await check('the database generates the uuids of the entities (uuid_generate_v4)', async (): Promise<void> => {
                const db: Database = await app.getObject<Database>('db')
                const device: Device = await db.getRepository(Device).save({sn: 'SN-1'})
                assert.match(device.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
                assert.strictEqual((await db.getRepository(Device).findOneBy({id: device.id}))?.sn, 'SN-1')
            })
        } finally {
            await check('the database of the scenario is dropped', async (): Promise<void> => {
                await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
                await admin.destroy()
            })
        }
    }))
    .onFatalException(async (error: Error): Promise<number> => {
        console.error(error)
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch((): undefined => undefined)
        return 1
    })

import assert from 'node:assert/strict'
import {rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {Container} from '@lakutata/core'
import {Database} from '@lakutata/orm/com/database'
import {DirectoryBackend, directoryEntities, IdAllocationPlugin, LastBindPlugin, LDAPBindStateRecord, LDAPConstraintViolationException, LDAPServer, MemberOfPlugin, UniquePlugin} from '../exports/LDAP.js'
import {sqliteLoads} from './support/SQLite.js'

/**
 * A server with a directory backend on a fresh SQLite file
 * @param backend The options of the backend.
 * @param server More options of the server.
 */
async function serve(backend: Record<string, unknown>, server: Record<string, unknown> = {}): Promise<{container: Container, ldap: LDAPServer, file: string}> {
    const file: string = join(tmpdir(), `lakutata-ldap-options-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`)
    const container: Container = new Container()
    await container.setNamed('database', Database, {options: {type: 'better-sqlite3', database: file, entities: directoryEntities('better-sqlite3'), synchronize: true}})
    await container.setNamed('ldap', LDAPServer, {port: 0, host: '127.0.0.1', backends: [{class: DirectoryBackend, database: 'database', ...backend}], passwords: {iterations: 1000}, ...server})
    return {container: container, ldap: await container.get<LDAPServer>('ldap'), file: file}
}

describe('the options of the directory backend', {skip: sqliteLoads() ? false : 'better-sqlite3 does not load here'}, () => {
    it('creates a root of its own and imports LDIF, from its text or a file, on the first start', async () => {
        const ldif: string = 'dn: ou=imported,o=acme\nobjectClass: organizationalUnit\nou: imported\n\ndn: cn=printer,ou=imported,o=acme\nobjectClass: device\ncn: printer\n'
        const path: string = join(tmpdir(), `lakutata-ldap-options-${process.pid}.ldif`)
        writeFileSync(path, ldif)
        for (const source of [ldif, path]) {
            const {container, ldap, file} = await serve({suffix: 'o=acme', initialize: {root: {objectClass: ['organization'], o: 'acme', description: 'ACME'}, ldif: source, admin: {dn: 'cn=admin,o=acme', password: 'secret'}}}, {access: {admins: ['cn=admin,o=acme']}})
            try {
                const admin = ldap.connect('cn=admin,o=acme')
                assert.equal((await admin.search('o=acme', {scope: 'base'})).entries[0].first('description'), 'ACME')
                assert.equal((await admin.search('o=acme', {filter: '(cn=printer)'})).entries[0].dn, 'cn=printer,ou=imported,o=acme')
            } finally {
                await container.destroy()
                rmSync(file, {force: true})
            }
        }
        rmSync(path, {force: true})
    })

    it('gives memberOf under a name and an OID of its own, or not at all', async () => {
        const named = await serve({suffix: 'dc=example', memberOf: {name: 'isMemberOf', oid: '1.3.6.1.4.1.65000.1.1'}, initialize: {admin: {dn: 'cn=admin,dc=example', password: 'secret'}}}, {access: {admins: ['cn=admin,dc=example']}})
        try {
            const directory = named.ldap.directory('cn=admin,dc=example')
            const user: string = await directory.createUser('dc=example', {uid: 'u', cn: 'U', sn: 'U'})
            const group: string = await directory.createGroup('dc=example', {cn: 'g'}, [user])
            assert.deepEqual((await named.ldap.connect('cn=admin,dc=example').search(user, {scope: 'base', attributes: ['isMemberOf']})).entries[0].get('isMemberOf'), [group])
            assert.equal(named.ldap.engine.schema.attributeType('memberOf'), undefined)
        } finally {
            await named.container.destroy()
            rmSync(named.file, {force: true})
        }
        const without = await serve({suffix: 'dc=example', memberOf: false, lastBind: false})
        try {
            assert.equal(without.ldap.engine.schema.attributeType('memberOf'), undefined)
            assert.equal(without.ldap.engine.schema.attributeType('authTimestamp'), undefined)
        } finally {
            await without.container.destroy()
            rmSync(without.file, {force: true})
        }
    })

    it('creates the root and the administrator once when two instances start together', async () => {
        const file: string = join(tmpdir(), `lakutata-ldap-options-${process.pid}-together.sqlite`)
        const database: Record<string, unknown> = {type: 'better-sqlite3', database: file, entities: directoryEntities('better-sqlite3')}
        //The tables made first, as the migrations of an application would
        const tables: Container = new Container()
        await tables.setNamed('database', Database, {options: {...database, synchronize: true}})
        await tables.destroy()
        const instances: Container[] = [new Container(), new Container()]
        try {
            await Promise.all(instances.map(async (instance: Container): Promise<void> => {
                await instance.setNamed('database', Database, {options: database})
                await instance.setNamed('ldap', LDAPServer, {port: 0, host: '127.0.0.1', backends: [{class: DirectoryBackend, database: 'database', suffix: 'dc=example', initialize: {admin: {dn: 'cn=admin,dc=example', password: 'secret'}}}], access: {admins: ['cn=admin,dc=example']}, passwords: {iterations: 1000}})
            }))
            const ldap: LDAPServer = await instances[1].get<LDAPServer>('ldap')
            assert.deepEqual((await ldap.connect('cn=admin,dc=example').search('dc=example')).entries.map((entry) => entry.dn).sort(), ['cn=admin,dc=example', 'dc=example'])
            await ldap.connect().bind('cn=admin,dc=example', 'secret')
        } finally {
            for (const instance of instances) await instance.destroy()
            rmSync(file, {force: true})
        }
    })

    it('leaves out of its chain the plugins doing what it does itself', async () => {
        const plugins = [new MemberOfPlugin(), new LastBindPlugin(), new IdAllocationPlugin({uidNumber: 50000}), new UniquePlugin({attributes: ['mail']})]
        const {container, ldap, file} = await serve({suffix: 'dc=example', initialize: {admin: {dn: 'cn=admin,dc=example', password: 'secret'}}}, {access: {admins: ['cn=admin,dc=example']}, plugins: plugins, schema: {bundled: ['core', 'cosine', 'inetorgperson', 'rfc2307bis']}})
        try {
            const admin = ldap.connect('cn=admin,dc=example')
            await admin.add('uid=alice,dc=example', {objectClass: ['inetOrgPerson', 'posixAccount'], uid: 'alice', cn: 'Alice', sn: 'A', mail: 'alice@example.org', homeDirectory: '/home/alice', userPassword: 'alice-secret'})
            await admin.add('cn=staff,dc=example', {objectClass: 'groupOfNames', cn: 'staff', member: 'uid=alice,dc=example'})
            const alice = (await admin.search('uid=alice,dc=example', {scope: 'base', attributes: ['memberOf', 'uidNumber']})).entries[0]
            //The backend's memberOf and numbers, not the plugins'
            assert.deepEqual(alice.get('memberOf'), ['cn=staff,dc=example'])
            assert.deepEqual(alice.get('uidNumber'), ['10000'])
            await ldap.connect().bind('uid=alice,dc=example', 'alice-secret')
            assert.equal((await admin.search('uid=alice,dc=example', {scope: 'base', attributes: ['authTimestamp']})).entries[0].get('authTimestamp').length, 1)
            //A plugin the backend does not replace runs
            await assert.rejects(admin.add('uid=bob,dc=example', {objectClass: 'inetOrgPerson', uid: 'bob', cn: 'Bob', sn: 'B', mail: 'ALICE@example.org'}), LDAPConstraintViolationException)
        } finally {
            await container.destroy()
            rmSync(file, {force: true})
        }
    })

    it('keeps the failed binds in the database', async () => {
        const {container, ldap, file} = await serve({suffix: 'dc=example', initialize: {admin: {dn: 'cn=admin,dc=example', password: 'secret'}}}, {access: {admins: ['cn=admin,dc=example']}, bindThrottle: {delay: 0}})
        try {
            await assert.rejects(ldap.connect().bind('cn=admin,dc=example', 'wrong'))
            const database: Database = await container.get<Database>('database')
            assert.ok(await database.getRepository(LDAPBindStateRecord).count() >= 1)
        } finally {
            await container.destroy()
            rmSync(file, {force: true})
        }
    })

    it('refuses a database without its entities, and MySQL without the entities of MySQL', async () => {
        const container: Container = new Container()
        try {
            await container.setNamed('database', Database, {options: {type: 'better-sqlite3', database: ':memory:', entities: [], synchronize: true}})
            await assert.rejects(container.setNamed('ldap', LDAPServer, {port: 0, host: '127.0.0.1', backends: [{class: DirectoryBackend, suffix: 'dc=example', database: 'database'}]}), /entities of the directory backend/)
            await assert.rejects(container.setNamed('ldap2', LDAPServer, {port: 0, host: '127.0.0.1', backends: [{class: DirectoryBackend, suffix: 'dc=example'}]}), /needs its database option: the name the application's Database component is registered under/)
            await assert.rejects(container.setNamed('ldap3', LDAPServer, {port: 0, host: '127.0.0.1', backends: [{class: DirectoryBackend, suffix: 'dc=example', database: 'mainDB'}]}), /finds no Database component named mainDB/)
        } finally {
            await container.destroy()
        }
    })
})

describe('the directory backend on sql.js', () => {
    it('keeps a directory in the memory of one process', async () => {
        const container: Container = new Container()
        try {
            await container.setNamed('database', Database, {options: {type: 'sqljs', entities: directoryEntities('sqljs'), synchronize: true}})
            await container.setNamed('ldap', LDAPServer, {port: 0, host: '127.0.0.1', backends: [{class: DirectoryBackend, database: 'database', suffix: 'dc=example', initialize: {admin: {dn: 'cn=admin,dc=example', password: 'secret'}}}], access: {admins: ['cn=admin,dc=example']}, passwords: {iterations: 1000}})
            const ldap: LDAPServer = await container.get<LDAPServer>('ldap')
            const directory = ldap.directory('cn=admin,dc=example')
            const user: string = await directory.createUser('dc=example', {uid: 'alice', cn: 'Alice', sn: 'A'}, 'alice-secret')
            const group: string = await directory.createGroup('dc=example', {cn: 'staff'}, [user])
            const renamed: string = await directory.rename(user, 'alice2')
            const {entries} = await ldap.connect('cn=admin,dc=example').search('dc=example', {filter: `(&(uid=alice2)(memberOf=${group}))`, attributes: ['memberOf']})
            assert.deepEqual(entries.map((entry) => [entry.dn, entry.get('memberOf')]), [[renamed, [group]]])
            assert.deepEqual((await ldap.connect('cn=admin,dc=example').search(group, {scope: 'base', attributes: ['member']})).entries[0].get('member'), [renamed])
            assert.equal(await directory.verifyPassword(renamed, 'alice-secret'), true)
        } finally {
            await container.destroy()
        }
    })
})

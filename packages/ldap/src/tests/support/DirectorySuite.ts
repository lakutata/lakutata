//The tests of the directory backend, run on each database: SQLite in the unit tests, PostgreSQL and MySQL in Docker
import assert from 'node:assert/strict'
import {after, before, describe, it} from 'node:test'
import {Container} from '@lakutata/core'
import {Database} from '@lakutata/orm/com/database'
import {
    connectLDAP,
    type Directory,
    DirectoryBackend,
    directoryEntities,
    findControl,
    LDAPAttributeOrValueExistsException,
    type LDAPClientConnection,
    LDAPConstraintViolationException,
    LDAPEntryAlreadyExistsException,
    LDAPEntryRecord,
    type LDAPInProcessConnection,
    LDAPInvalidCredentialsException,
    LDAPMySQLValueRecord,
    LDAPNoSuchObjectException,
    LDAPServer,
    LDAPUnwillingToPerformException,
    LDAPValueRecord,
    SortRequestControl,
    SortResponseControl,
    TreeDeleteControl,
    VLVRequestControl,
    VLVResponseControl
} from '../../exports/LDAP.js'
import type {BundledSchemaName} from '../../exports/Schemas.js'

const BASE: string = 'dc=example,dc=com'
const ADMIN: string = 'cn=admin,dc=example,dc=com'

/**
 * Register the tests of the directory backend on a database
 * @param label The name of the database.
 * @param options The options of the database (its type and where it is), or what makes them; undefined skips the tests.
 */
export function directorySuite(label: string, options: (() => Promise<Record<string, unknown>>) | undefined): void {
    describe(`the directory backend on ${label}`, {skip: options ? false : `no ${label} to test on`}, () => {
        let container: Container
        let ldap: LDAPServer
        let admin: LDAPInProcessConnection
        let directory: Directory
        let url: string
        let databaseOptions: Record<string, unknown>
        const people: string = `ou=people,${BASE}`
        const groups: string = `ou=groups,${BASE}`
        //The POSIX accounts and the SSH public keys of the users, besides the default schemas
        const schema = {bundled: ['core', 'cosine', 'inetorgperson', 'rfc2307bis', 'openssh-lpk'] as BundledSchemaName[]}

        /**
         * Start the server on the database
         */
        const start = async (target: Container): Promise<LDAPServer> => {
            await target.setNamed('ldap', LDAPServer, {
                host: '127.0.0.1',
                port: 0,
                schema: schema,
                backends: [{class: DirectoryBackend, suffix: BASE, database: 'database', unique: ['uid'], nestedGroups: 2, mailAlias: true, initialize: {admin: {dn: ADMIN, password: 'secret'}}}],
                access: {admins: [ADMIN]},
                passwords: {iterations: 1000},
                bindThrottle: {delay: 0, maxFailures: 3, lockout: 60000}
            })
            return target.get<LDAPServer>('ldap')
        }

        before(async () => {
            databaseOptions = await options!()
            container = new Container()
            await container.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type)), synchronize: true}})
            ldap = await start(container)
            admin = ldap.connect(ADMIN)
            directory = ldap.directory(ADMIN)
            url = `ldap://127.0.0.1:${ldap.ports.ldap}`
            await directory.createOrganizationalUnit(BASE, {ou: 'people'})
            await directory.createOrganizationalUnit(BASE, {ou: 'groups'})
            for (let index: number = 0; index < 30; index++) {
                await directory.createUser(people, {objectClass: ['posixAccount', 'ldapPublicKey'], uid: `user${index}`, cn: `User ${String(index).padStart(2, '0')}`, sn: `Surname${index % 3}`, mail: `user${index}@Example.com`, homeDirectory: `/home/user${index}`})
            }
            await admin.passwordModify({userIdentity: `uid=user1,${people}`, newPassword: 'password1'})
        })

        after(async () => {
            await container?.destroy()
        })

        it('creates the entry of the suffix and the administrator on its first start, once', async () => {
            const root = (await admin.search(BASE, {scope: 'base'})).entries[0]
            assert.deepEqual(root.get('objectClass').sort(), ['dcObject', 'organization', 'top'])
            const connection: LDAPClientConnection = await connectLDAP(url)
            await connection.bind(ADMIN, 'secret')
            await connection.close()
            //A second server on the same database creates nothing
            const second: Container = new Container()
            try {
                await second.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await start(second)
                assert.equal((await admin.search(BASE, {filter: '(cn=admin)'})).entries.length, 1)
            } finally {
                await second.destroy()
            }
        })

        it('finds entries by the forms of their values: equality, substrings, presence, numbers, NOT and OR', async () => {
            assert.equal((await admin.search(BASE, {filter: '(mail=USER3@example.COM)'})).entries[0].dn, `uid=user3,${people}`)
            assert.equal((await admin.search(BASE, {filter: '(cn=user 1*)'})).entries.length, 10)
            assert.equal((await admin.search(BASE, {filter: '(&(objectClass=posixAccount)(!(sn=Surname0)))'})).entries.length, 20)
            assert.equal((await admin.search(BASE, {filter: '(|(uid=user4)(uid=user5)(uid=nobody))'})).entries.length, 2)
            assert.equal((await admin.search(BASE, {filter: '(uidNumber>=10025)'})).entries.length, 5)
            assert.equal((await admin.search(BASE, {filter: '(uidNumber<=10002)'})).entries.length, 3)
            assert.equal((await admin.search(BASE, {filter: '(homeDirectory=*)'})).entries.length, 30)
            assert.equal((await admin.search(BASE, {filter: '(commonName=User 07)'})).entries.length, 1)
            assert.equal((await admin.search(people, {scope: 'one'})).entries.length, 30)
            assert.equal((await admin.search(BASE, {scope: 'one'})).entries.length, 3)
            assert.equal((await admin.search(BASE, {scope: 'children', filter: '(objectClass=organizationalUnit)'})).entries.length, 2)
            assert.equal((await admin.search(BASE, {filter: '(shoeSize=42)'})).entries.length, 0)
        })

        it('gives the entries of an unsorted search parents first, siblings in the order they were added', async () => {
            const {entries} = await admin.search(people, {scope: 'one', paged: false})
            assert.deepEqual(entries.map((entry) => entry.first('uid')), Array.from({length: 30}, (_, index) => `user${index}`))
            //A base that does not exist, told by the rows alone
            await assert.rejects(admin.search(`ou=nowhere,${people}`), (error: unknown) => error instanceof LDAPNoSuchObjectException && error.matchedDN === people)
            //An entry moved under a parent added after it still comes after its parent
            const older: string = await directory.createOrganizationalUnit(BASE, {ou: 'older'})
            await admin.add(`cn=leaf,${older}`, {objectClass: 'device', cn: 'leaf'})
            const newer: string = await directory.createOrganizationalUnit(BASE, {ou: 'newer'})
            await admin.modifyDN(older, 'ou=older', {newSuperior: newer})
            try {
                const tree = await admin.search(newer, {paged: false})
                assert.deepEqual(tree.entries.map((entry) => entry.dn), [newer, `ou=older,${newer}`, `cn=leaf,ou=older,${newer}`])
            } finally {
                await admin.delete(newer, {controls: [TreeDeleteControl.encode()]})
            }
        })

        it('sorts and windows in the database past the sort limit of the engine, the inexact filters checked first', async () => {
            //A server sorting at most 5 entries in memory: the backend sorts the 30 users itself
            const second: Container = new Container()
            try {
                await second.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await second.setNamed('ldap', LDAPServer, {port: false, schema: schema, backends: [{class: DirectoryBackend, suffix: BASE, database: 'database', mailAlias: true}], access: {admins: [ADMIN]}, limits: {sortCandidates: 5}})
                const connection: LDAPInProcessConnection = (await second.get<LDAPServer>('ldap')).connect(ADMIN)
                const window = await connection.search(people, {scope: 'one', sort: [{attribute: 'cn', reverse: true}], window: {offset: 3, limit: 4}})
                assert.deepEqual(window.entries.map((entry) => entry.first('cn')), ['User 27', 'User 26', 'User 25', 'User 24'])
                assert.equal(window.total, 30)
                assert.equal(window.entries[0].first('homeDirectory'), '/home/user27')
                //A substring filter is checked on the entries before they are sorted; several keys
                const sorted = await connection.search(people, {scope: 'one', filter: '(cn=User 1*)', sort: [{attribute: 'sn'}, {attribute: 'cn', reverse: true}], paged: false})
                assert.deepEqual(sorted.entries.map((entry) => entry.first('cn')), ['User 18', 'User 15', 'User 12', 'User 19', 'User 16', 'User 13', 'User 10', 'User 17', 'User 14', 'User 11'])
                assert.equal(SortResponseControl.decode(findControl(sorted.controls, SortResponseControl)!).result, 0)
                //The view from the first value not less than an assertion
                const from = await connection.search(people, {scope: 'one', paged: false, controls: [SortRequestControl.encode([{attribute: 'cn'}], true), VLVRequestControl.encode({beforeCount: 1, afterCount: 2, greaterThanOrEqual: Buffer.from('user 2')}, true)]})
                assert.deepEqual(from.entries.map((entry) => entry.first('cn')), ['User 19', 'User 20', 'User 21', 'User 22'])
                assert.deepEqual(VLVResponseControl.decode(findControl(from.controls, VLVResponseControl)!), {targetPosition: 21, contentCount: 30, result: 0})
                //A virtual attribute (email, mail under another name) sorted on the entries themselves
                const byEmail = await connection.search(people, {scope: 'one', sort: [{attribute: 'email'}], window: {offset: 1, limit: 3}})
                assert.deepEqual(byEmail.entries.map((entry) => entry.first('uid')), ['user0', 'user10', 'user11'])
            } finally {
                await second.destroy()
            }
        })

        it('orders and windows in SQL by the forms of the values, as the engine sorts', async () => {
            const unit: string = await directory.createOrganizationalUnit(BASE, {ou: 'sorting'})
            try {
                const devices: [string, string[]][] = [['d1', ['m', 'b']], ['d2', ['x']], ['d3', []], ['d4', ['n', 'a']], ['d5', ['\u{20000}']], ['d6', ['\uFA0E']]]
                for (const [cn, description] of devices) await admin.add(`cn=${cn},${unit}`, {objectClass: 'device', cn: cn, ...description.length ? {description: description} : {}})
                const order = async (reverse: boolean): Promise<(string | undefined)[]> => (await admin.search(unit, {scope: 'one', sort: [{attribute: 'description', reverse: reverse}], window: {offset: 1, limit: 10}})).entries.map((entry) => entry.first('cn'))
                //The least value orders an entry, the greatest in reverse; without one, last both ways; by code points
                assert.deepEqual(await order(false), ['d4', 'd1', 'd2', 'd6', 'd5', 'd3'])
                assert.deepEqual(await order(true), ['d5', 'd6', 'd2', 'd4', 'd1', 'd3'])
                const window = await admin.search(unit, {scope: 'one', sort: [{attribute: 'description'}], window: {offset: 2, limit: 2}})
                assert.deepEqual(window.entries.map((entry) => entry.first('cn')), ['d1', 'd2'])
                assert.equal(window.total, 6)
                //Two values alike in their first 256 bytes: their keys are cut short, the entries sorted on their values
                await admin.add(`cn=long1,${unit}`, {objectClass: 'device', cn: 'long1', description: 'y'.repeat(300) + 'b'})
                await admin.add(`cn=long2,${unit}`, {objectClass: 'device', cn: 'long2', description: 'y'.repeat(300) + 'a'})
                assert.deepEqual(await order(false), ['d4', 'd1', 'd2', 'long2', 'long1', 'd6', 'd5', 'd3'])
                //Integers by their value
                const numbers = await admin.search(people, {scope: 'one', sort: [{attribute: 'uidNumber', reverse: true}], window: {offset: 1, limit: 5}})
                const values: number[] = numbers.entries.map((entry) => Number(entry.first('uidNumber')))
                assert.deepEqual(values, [...values].sort((a, b) => b - a))
                assert.equal(numbers.total, 30)
            } finally {
                await admin.delete(unit, {controls: [TreeDeleteControl.encode()]})
            }
        })

        it('allocates uidNumber and gidNumber, and keeps uid unique', async () => {
            const numbers: number[] = (await admin.search(people, {scope: 'one', attributes: ['uidNumber']})).entries.map((entry) => Number(entry.first('uidNumber'))).sort((a, b) => a - b)
            assert.deepEqual([numbers[0], numbers[29], new Set(numbers).size], [10000, 10029, 30])
            const group: string = await directory.createGroup(groups, {objectClass: 'posixGroup', cn: 'posix-users'}, [`uid=user1,${people}`, `uid=user2,${people}`])
            const posix = (await admin.search(group, {scope: 'base', attributes: ['gidNumber', 'memberUid']})).entries[0]
            assert.ok(Number(posix.first('gidNumber')) >= 10000)
            assert.deepEqual(posix.get('memberUid').sort(), ['user1', 'user2'])
            assert.equal((await admin.search(groups, {filter: '(memberUid=user2)'})).entries[0].dn, group)
            await assert.rejects(admin.add(`uid=user1,${groups}`, {objectClass: 'account', uid: 'user1'}), LDAPConstraintViolationException)
            //The gidNumber of a posixGroup is unique among the groups, not among the accounts
            const gid: string = posix.first('gidNumber')!
            await assert.rejects(directory.createGroup(groups, {objectClass: 'posixGroup', cn: 'same-gid', gidNumber: gid}), LDAPConstraintViolationException)
            await admin.modify(`uid=user3,${people}`, {operation: 'replace', attribute: 'gidNumber', values: gid})
            const allocated: string[] = []
            for (const name of ['g1', 'g2', 'g3']) allocated.push((await admin.search(await directory.createGroup(groups, {objectClass: 'posixGroup', cn: name}), {scope: 'base', attributes: ['gidNumber']})).entries[0].first('gidNumber')!)
            assert.equal(new Set([gid, ...allocated]).size, 4)
        })

        it('computes memberOf, nested groups included, and finds the members of a group by it', async () => {
            const developers: string = await directory.createGroup(groups, {cn: 'developers'}, [`uid=user5,${people}`, `uid=user6,${people}`])
            const staff: string = await directory.createGroup(groups, {cn: 'staff'}, [developers, `uid=user7,${people}`])
            const user5 = (await admin.search(`uid=user5,${people}`, {scope: 'base', attributes: ['memberOf']})).entries[0]
            assert.deepEqual(user5.get('memberOf').sort(), [developers, staff].sort())
            assert.deepEqual((await admin.search(people, {filter: `(memberOf=${developers})`})).entries.map((entry) => entry.first('uid')).sort(), ['user5', 'user6'])
            assert.deepEqual((await admin.search(people, {filter: `(memberOf=${staff})`})).entries.map((entry) => entry.first('uid')).sort(), ['user5', 'user6', 'user7'])
            assert.equal(await admin.compare(`uid=user6,${people}`, 'memberOf', staff), true)
            assert.equal((await admin.search(`uid=user6,${people}`, {scope: 'base'})).entries[0].has('memberOf'), false)
        })

        it('keeps the references when entries are renamed, moved and deleted', async () => {
            const group: string = await directory.createGroup(groups, {cn: 'renaming'}, [`uid=user8,${people}`, `uid=user9,${people}`])
            const renamed: string = await directory.rename(`uid=user8,${people}`, 'user8b')
            assert.deepEqual((await admin.search(group, {scope: 'base'})).entries[0].get('member').sort(), [renamed, `uid=user9,${people}`].sort())
            assert.equal((await admin.search(groups, {filter: `(member=${renamed})`})).entries[0].dn, group)
            await admin.delete(renamed)
            assert.deepEqual((await admin.search(group, {scope: 'base'})).entries[0].get('member'), [`uid=user9,${people}`])
            await admin.delete(`uid=user9,${people}`)
            assert.deepEqual((await admin.search(group, {scope: 'base'})).entries[0].get('member'), [''])
        })

        it('keeps groupOfUniqueNames as groupOfNames: memberOf, the references with their UIDs, the approximate match', async () => {
            const group: string = `cn=uniques,${groups}`
            //A member added after the group naming it
            await admin.add(group, {objectClass: 'groupOfUniqueNames', cn: 'uniques', uniqueMember: [`uid=user10,${people}#'0101'B`, `uid=late,${people}#'1'B`]})
            await admin.add(`uid=late,${people}`, {objectClass: 'account', uid: 'late'})
            const memberOf = async (dn: string): Promise<string[]> => (await admin.search(dn, {scope: 'base', attributes: ['memberOf']})).entries[0].get('memberOf')
            assert.ok((await memberOf(`uid=user10,${people}`)).includes(group))
            assert.ok((await memberOf(`uid=late,${people}`)).includes(group))
            assert.equal((await admin.search(groups, {filter: `(uniqueMember~=UID=User10,${people})`})).entries[0]?.dn, group)
            assert.equal((await admin.search(groups, {filter: `(uniqueMember=uid=user10,${people})`})).entries.length, 0)
            await admin.modifyDN(`uid=late,${people}`, 'uid=later')
            assert.deepEqual((await admin.search(group, {scope: 'base'})).entries[0].get('uniqueMember').sort(), [`uid=later,${people}#'1'B`, `uid=user10,${people}#'0101'B`].sort())
            await admin.delete(`uid=later,${people}`)
            assert.deepEqual((await admin.search(group, {scope: 'base'})).entries[0].get('uniqueMember'), [`uid=user10,${people}#'0101'B`])
        })

        it('moves and deletes subtrees, and pages a search of the network client', async () => {
            const unit: string = await directory.createOrganizationalUnit(BASE, {ou: 'temporary'})
            const inner: string = await directory.createOrganizationalUnit(unit, {ou: 'inner'})
            await admin.add(`cn=device,${inner}`, {objectClass: 'device', cn: 'device'})
            await admin.modifyDN(unit, 'ou=moved', {newSuperior: groups})
            assert.equal((await admin.search(`ou=moved,${groups}`, {filter: '(cn=device)'})).entries[0].dn, `cn=device,ou=inner,ou=moved,${groups}`)
            await assert.rejects(admin.search(unit), LDAPNoSuchObjectException)
            await admin.delete(`ou=moved,${groups}`, {controls: [TreeDeleteControl.encode()]})
            assert.equal((await admin.search(BASE, {filter: '(cn=device)'})).entries.length, 0)
            const connection: LDAPClientConnection = await connectLDAP(url)
            await connection.bind(`uid=user1,${people}`, 'password1')
            assert.equal((await connection.search(people, {scope: 'one', paged: {pageSize: 7}})).entries.length, 28)
            await connection.close()
        })

        it('modifies values, keeps bytes, the time of the last bind, the failed binds, email as mail', async () => {
            const dn: string = `uid=user10,${people}`
            await admin.modify(dn, [{operation: 'add', attribute: 'mail', values: 'second@example.com'}, {operation: 'replace', attribute: 'description', values: ['one', 'two']}, {operation: 'add', attribute: 'jpegPhoto', values: Buffer.from([0xff, 0xd8, 0x00, 0x10, 0x80])}])
            await admin.modify(dn, {operation: 'delete', attribute: 'mail', values: 'SECOND@example.com'})
            const entry = (await admin.search(dn, {scope: 'base', attributes: ['*', 'email', 'modifyTimestamp']})).entries[0]
            assert.deepEqual([entry.get('mail'), entry.get('email'), entry.get('description').sort()], [['user10@Example.com'], ['user10@Example.com'], ['one', 'two']])
            assert.deepEqual(entry.getBuffers('jpegPhoto')[0], Buffer.from([0xff, 0xd8, 0x00, 0x10, 0x80]))
            assert.equal((await admin.search(people, {filter: '(email=user10@example.com)'})).entries.length, 1)
            await ldap.connect().bind(`uid=user1,${people}`, 'password1')
            assert.match((await admin.search(`uid=user1,${people}`, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp')!, /^\d{14}Z$/)
            const connection: LDAPClientConnection = await connectLDAP(url)
            for (let index: number = 0; index < 3; index++) await assert.rejects(connection.bind(`uid=user1,${people}`, 'wrong'), LDAPInvalidCredentialsException)
            await assert.rejects(connection.bind(`uid=user1,${people}`, 'password1'), LDAPInvalidCredentialsException)
            await connection.close()
        })

        it('keeps the state of the password policy in the database, for every instance', async () => {
            const servers: Container[] = []
            try {
                const policy = async (): Promise<LDAPServer> => {
                    const instance: Container = new Container()
                    servers.push(instance)
                    await instance.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                    await instance.setNamed('ldap', LDAPServer, {
                        port: 0,
                        host: '127.0.0.1',
                        schema: schema,
                        backends: [{class: DirectoryBackend, suffix: BASE, database: 'database', sharedThrottle: false}],
                        access: {admins: [ADMIN]},
                        passwords: {iterations: 1000},
                        bindThrottle: {maxFailures: 0, ipMaxFailures: 0, delay: 0},
                        passwordPolicy: {default: {lockout: true, maxFailure: 2, lockoutDuration: 0}}
                    })
                    return instance.get<LDAPServer>('ldap')
                }
                const [first, second] = [await policy(), await policy()]
                await admin.passwordModify({userIdentity: `uid=user12,${people}`, newPassword: 'password12'})
                for (let index: number = 0; index < 2; index++) await assert.rejects(first.connect().bind(`uid=user12,${people}`, 'wrong'), LDAPInvalidCredentialsException)
                await assert.rejects(second.connect().bind(`uid=user12,${people}`, 'password12'), LDAPInvalidCredentialsException)
                assert.ok((await admin.search(`uid=user12,${people}`, {scope: 'base', attributes: ['pwdAccountLockedTime']})).entries[0].first('pwdAccountLockedTime'))
                //A password an administrator sets unlocks the account, on an instance with the policy
                await first.connect(ADMIN).passwordModify({userIdentity: `uid=user12,${people}`, newPassword: 'password12b'})
                await second.connect().bind(`uid=user12,${people}`, 'password12b')
            } finally {
                for (const instance of servers) await instance.destroy()
            }
        })

        it('keeps large values, and serves two suffixes from one database with two backends', async () => {
            const photo: Buffer = Buffer.alloc(100 * 1024, 7)
            photo[0] = 0xff
            await admin.modify(`uid=user11,${people}`, {operation: 'replace', attribute: 'jpegPhoto', values: photo})
            assert.deepEqual((await admin.search(`uid=user11,${people}`, {scope: 'base', attributes: ['jpegPhoto']})).entries[0].getBuffers('jpegPhoto')[0], photo)
            const two: Container = new Container()
            try {
                await two.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await two.setNamed('ldap', LDAPServer, {
                    port: 0,
                    host: '127.0.0.1',
                    backends: [{class: DirectoryBackend, suffix: 'dc=first,dc=org', database: 'database'}, {class: DirectoryBackend, suffix: 'dc=second,dc=org', database: 'database'}],
                    access: {admins: ['cn=admin,dc=first,dc=org']}
                })
                const server: LDAPServer = await two.get<LDAPServer>('ldap')
                const writer: LDAPInProcessConnection = server.connect('cn=admin,dc=first,dc=org')
                await writer.add('dc=first,dc=org', {objectClass: ['dcObject', 'organization'], dc: 'first', o: 'First'})
                await writer.add('dc=second,dc=org', {objectClass: ['dcObject', 'organization'], dc: 'second', o: 'Second'})
                await writer.add('cn=only-second,dc=second,dc=org', {objectClass: 'device', cn: 'only-second'})
                assert.equal((await writer.search('dc=first,dc=org', {filter: '(cn=only-second)'})).entries.length, 0)
                assert.equal((await writer.search('dc=second,dc=org', {filter: '(cn=only-second)'})).entries.length, 1)
                assert.equal((await admin.search(BASE, {filter: '(cn=only-second)'})).entries.length, 0)
            } finally {
                await two.destroy()
            }
        })

        it('rolls a write back when an interceptor refuses it before the commit', async () => {
            const refusing: Container = new Container()
            try {
            await refusing.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
            await refusing.setNamed('ldap', LDAPServer, {
                port: 0,
                host: '127.0.0.1',
                backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}],
                access: {admins: [ADMIN]},
                interceptors: [{name: 'refuse', operations: ['add'], beforeCommit: () => {
                    throw new LDAPUnwillingToPerformException('refused before the commit')
                }}]
            })
            const server: LDAPServer = await refusing.get<LDAPServer>('ldap')
            await assert.rejects(server.connect(ADMIN).add(`cn=refused,${BASE}`, {objectClass: 'device', cn: 'refused'}), LDAPUnwillingToPerformException)
            assert.equal((await admin.search(BASE, {filter: '(cn=refused)'})).entries.length, 0)
            } finally {
                await refusing.destroy()
            }
        })

        it('keeps every change of concurrent writes to one entry, from one instance or two, and one value in an attribute of one value', {timeout: 120000}, async () => {
            const db: Database = await container.get<Database>('database')
            //A second instance on the database where it has row locks (SQLite takes one write at a time in an instance)
            const second: Container = new Container()
            let instances: LDAPServer[] = [ldap]
            if (String(databaseOptions.type) !== 'better-sqlite3') {
                await second.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await second.setNamed('ldap', LDAPServer, {port: false, schema: schema, backends: [{class: DirectoryBackend, suffix: BASE, database: 'database', unique: ['uid'], nestedGroups: 2, mailAlias: true}], access: {admins: [ADMIN]}})
                instances = [ldap, await second.get<LDAPServer>('ldap')]
            }
            const valueEntity = String(databaseOptions.type) === 'mysql' ? LDAPMySQLValueRecord : LDAPValueRecord
            const device: string = `cn=concurrent,${BASE}`
            const user: string = `uid=concurrent,${people}`
            const unit: string = `ou=concurrent-members,${BASE}`
            const group: string = `cn=concurrent,${groups}`
            //Each writer on a connection of its own, more of them than the connections of a pool, the instances in turn
            const writer = (index: number): LDAPInProcessConnection => instances[index % instances.length].connect(ADMIN)
            const writers = (count: number): LDAPInProcessConnection[] => Array.from({length: count}, (_: unknown, index: number): LDAPInProcessConnection => writer(index))
            const idOf = async (dn: string): Promise<string> => (await db.getRepository(LDAPEntryRecord).findOneByOrFail({dn: dn})).id
            //The values as the database keeps them, not as a search filters them
            const stored = async (dn: string, type: string): Promise<string[]> => (await db.getRepository(valueEntity).findBy({entryId: await idOf(dn), attributeType: type})).map((row: LDAPValueRecord): string => row.value).sort()
            const read = async (dn: string, type: string): Promise<string[]> => (await admin.search(dn, {scope: 'base'})).entries[0].get(type).sort()
            const refused = (results: PromiseSettledResult<unknown>[], ...types: (new (...args: never[]) => Error)[]): void => {
                for (const result of results) {
                    if (result.status === 'rejected') assert.ok(types.some((type: new (...args: never[]) => Error): boolean => result.reason instanceof type), String(result.reason))
                }
            }
            const stale: string[] = Array.from({length: 40}, (_: unknown, index: number): string => `stale${String(index).padStart(2, '0')}`)
            const added: string[] = Array.from({length: 40}, (_: unknown, index: number): string => `added${String(index).padStart(2, '0')}`)
            await admin.add(device, {objectClass: 'device', cn: 'concurrent', description: stale})
            await admin.add(user, {objectClass: 'inetOrgPerson', uid: 'concurrent', cn: 'Concurrent', sn: 'Writer'})
            await directory.createOrganizationalUnit(BASE, {ou: 'concurrent-members'})
            const members: string[] = []
            for (let index: number = 0; index < 20; index++) members.push(await directory.createUser(unit, {uid: `member${index}`, cn: `Member ${index}`, sn: 'Member'}))
            await directory.createGroup(groups, {cn: 'concurrent'}, members.slice(0, 10))
            try {
                //Forty writers each deleting a value of their own, then forty each adding one
                await Promise.all(writers(40).map((connection: LDAPInProcessConnection, index: number) => connection.modify(device, {operation: 'delete', attribute: 'description', values: stale[index]})))
                assert.deepEqual(await stored(device, 'description'), [])
                await Promise.all(writers(40).map((connection: LDAPInProcessConnection, index: number) => connection.modify(device, {operation: 'add', attribute: 'description', values: added[index]})))
                assert.deepEqual(await stored(device, 'description'), added)
                //Each value read back: two at one position would hide one of them
                assert.deepEqual(await read(device, 'description'), added)
                //Ten writers adding the same value: it is kept once
                refused(await Promise.allSettled(writers(10).map((connection: LDAPInProcessConnection) => connection.modify(device, {operation: 'add', attribute: 'description', values: 'same'}))), LDAPAttributeOrValueExistsException)
                assert.deepEqual((await stored(device, 'description')).filter((value: string): boolean => value === 'same'), ['same'])
                //An attribute of one value: ten writers replacing it, then ten adding a value to it while it has none
                await Promise.all(writers(10).map((connection: LDAPInProcessConnection, index: number) => connection.modify(user, {operation: 'replace', attribute: 'displayName', values: `Name ${index}`})))
                assert.equal((await stored(user, 'displayname')).length, 1)
                await admin.modify(user, {operation: 'delete', attribute: 'displayName'})
                const adding: PromiseSettledResult<unknown>[] = await Promise.allSettled(writers(10).map((connection: LDAPInProcessConnection, index: number) => connection.modify(user, {operation: 'add', attribute: 'displayName', values: `Added ${index}`})))
                refused(adding, LDAPConstraintViolationException, LDAPAttributeOrValueExistsException)
                assert.ok(adding.some((result: PromiseSettledResult<unknown>): boolean => result.status === 'fulfilled'))
                assert.equal((await stored(user, 'displayname')).length, 1)
                //The members deleted while other members are added: the values naming the deleted ones go, the added ones stay
                await Promise.all([
                    ...members.slice(0, 5).map((dn: string, index: number) => writer(index).delete(dn)),
                    ...members.slice(10).map((dn: string, index: number) => writer(index + 1).modify(group, {operation: 'add', attribute: 'member', values: dn}))
                ])
                assert.deepEqual(await read(group, 'member'), [...members.slice(5)].sort())
                //No attribute of one value holds two, the operational ones written by each write among them
                for (const dn of [device, user, group]) {
                    const counts: Map<string, number> = new Map()
                    for (const row of await db.getRepository(valueEntity).findBy({entryId: await idOf(dn)})) counts.set(row.attributeType, (counts.get(row.attributeType) ?? 0) + 1)
                    for (const [type, count] of counts) {
                        if (ldap.engine.schema.isSingleValued(type)) assert.equal(count, 1, `${dn}: ${type}`)
                    }
                }
            } finally {
                await second.destroy()
                await admin.delete(device)
                await admin.delete(user)
                await admin.delete(group)
                await admin.delete(unit, {controls: [TreeDeleteControl.encode()]})
            }
        })

        it('keeps the changes made to an entry while it is renamed', {timeout: 60000}, async () => {
            const before: string = `cn=renaming,${BASE}`
            const after: string = `cn=renamed,${BASE}`
            await admin.add(before, {objectClass: 'device', cn: 'renaming', 'cn;lang-en': 'renaming', description: 'initial'})
            assert.deepEqual((await admin.search(before, {scope: 'base'})).entries[0].get('cn;lang-en'), ['renaming'])
            const renaming: Container = new Container()
            try {
                await renaming.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await renaming.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN]},
                    //A change made once the engine has read the entry to rename, before the rename is written
                    interceptors: [{name: 'between', operations: ['modifyDN'], beforeCommit: async (): Promise<void> => {
                        await (await renaming.get<LDAPServer>('ldap')).connect(ADMIN).modify(before, [{operation: 'add', attribute: 'description', values: 'between'}, {operation: 'add', attribute: 'serialNumber', values: 'S-1'}])
                    }}]
                })
                await (await renaming.get<LDAPServer>('ldap')).connect(ADMIN).modifyDN(before, 'cn=renamed')
                const entry = (await admin.search(after, {scope: 'base', attributes: ['*', 'modifyTimestamp']})).entries[0]
                assert.deepEqual(entry.get('description').sort(), ['between', 'initial'])
                assert.deepEqual(entry.get('serialNumber'), ['S-1'])
                assert.deepEqual(entry.get('cn'), ['renamed'])
                //The old RDN value removed from each description of the type
                assert.deepEqual(entry.get('cn;lang-en'), [])
                assert.equal(entry.get('modifyTimestamp').length, 1)
                //Writes to the entry while it is renamed: each one kept, or refused as it was renamed before it ran
                const values: string[] = Array.from({length: 20}, (_: unknown, index: number): string => `during${String(index).padStart(2, '0')}`)
                const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
                    ...values.map((value: string) => ldap.connect(ADMIN).modify(after, {operation: 'add', attribute: 'description', values: value})),
                    ldap.connect(ADMIN).modifyDN(after, 'cn=renamed-again')
                ])
                assert.equal(results[values.length].status, 'fulfilled', String((results[values.length] as PromiseRejectedResult).reason))
                for (const result of results.slice(0, values.length)) {
                    if (result.status === 'rejected') assert.ok(result.reason instanceof LDAPNoSuchObjectException, String(result.reason))
                }
                const kept: string[] = values.filter((_: string, index: number): boolean => results[index].status === 'fulfilled')
                const again = (await admin.search(`cn=renamed-again,${BASE}`, {scope: 'base'})).entries[0]
                assert.deepEqual(again.get('description').sort(), ['between', 'initial', ...kept].sort())
                assert.deepEqual(again.get('cn'), ['renamed-again'])
            } finally {
                await renaming.destroy()
                for (const dn of [before, after, `cn=renamed-again,${BASE}`]) await admin.delete(dn).catch((): undefined => undefined)
            }
        })

        it('refuses a rename to a DN an entry took once the engine checked it, the entry left as it was', {timeout: 60000}, async () => {
            const source: string = `cn=moving,${BASE}`
            const taken: string = `cn=taken,${BASE}`
            await admin.add(source, {objectClass: 'device', cn: 'moving', description: 'kept'})
            const taking: Container = new Container()
            try {
                await taking.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await taking.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN]},
                    //The new DN taken once the engine has checked it, before the rename is written
                    interceptors: [{name: 'taking', operations: ['modifyDN'], beforeCommit: async (): Promise<void> => {
                        await (await taking.get<LDAPServer>('ldap')).connect(ADMIN).add(taken, {objectClass: 'device', cn: 'taken'})
                    }}]
                })
                await assert.rejects((await taking.get<LDAPServer>('ldap')).connect(ADMIN).modifyDN(source, 'cn=taken'), LDAPEntryAlreadyExistsException)
                const entry = (await admin.search(source, {scope: 'base'})).entries[0]
                assert.deepEqual([entry.get('cn'), entry.get('description')], [['moving'], ['kept']])
                //The entry added in the transaction of the rename went back with it
                await assert.rejects(admin.search(taken, {scope: 'base'}), LDAPNoSuchObjectException)
            } finally {
                await taking.destroy()
                for (const dn of [source, taken]) await admin.delete(dn).catch((): undefined => undefined)
            }
        })

        it('runs the writes made in the transaction of another write, to its entry and to another one', {timeout: 60000}, async () => {
            const target: string = `cn=nesting,${BASE}`
            const other: string = `cn=nested,${BASE}`
            await admin.add(target, {objectClass: 'device', cn: 'nesting'})
            await admin.add(other, {objectClass: 'device', cn: 'nested'})
            const nesting: Container = new Container()
            try {
                await nesting.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await nesting.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN]},
                    interceptors: [{name: 'nesting', operations: ['modify'], beforeCommit: async (_context: unknown, request: {dn?: {toString(): string}}): Promise<void> => {
                        if (request.dn?.toString() !== target) return
                        //An operational attribute of the entry being modified, as a plugin keeps its state; a write to another entry
                        const server: LDAPServer = await nesting.get<LDAPServer>('ldap')
                        await server.engine.writeOperational(target, [{operation: 'replace', attribute: {type: 'modifyTimestamp', values: [Buffer.from('20260101000000Z')]}}])
                        await server.connect(ADMIN).modify(other, {operation: 'add', attribute: 'description', values: 'nested'})
                    }}]
                })
                //The state of an entry that is not there is not written, without an error (a bind answers the same)
                await (await nesting.get<LDAPServer>('ldap')).engine.writeOperational(`cn=missing,${BASE}`, [{operation: 'replace', attribute: {type: 'modifyTimestamp', values: [Buffer.from('20260101000000Z')]}}])
                await (await nesting.get<LDAPServer>('ldap')).connect(ADMIN).modify(target, {operation: 'add', attribute: 'description', values: 'outer'})
                assert.deepEqual((await admin.search(target, {scope: 'base'})).entries[0].get('description'), ['outer'])
                assert.deepEqual((await admin.search(other, {scope: 'base'})).entries[0].get('description'), ['nested'])
            } finally {
                await nesting.destroy()
                await admin.delete(target)
                await admin.delete(other)
            }
        })
    })
}

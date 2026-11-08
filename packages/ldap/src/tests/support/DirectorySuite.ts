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
    type LDAPClientConnection,
    LDAPConstraintViolationException,
    type LDAPInProcessConnection,
    LDAPInvalidCredentialsException,
    LDAPNoSuchObjectException,
    LDAPServer,
    LDAPUnwillingToPerformException,
    TreeDeleteControl
} from '../../exports/LDAP.js'

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

        /**
         * Start the server on the database
         */
        const start = async (target: Container): Promise<LDAPServer> => {
            await target.setNamed('ldap', LDAPServer, {
                host: '127.0.0.1',
                port: 0,
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
    })
}

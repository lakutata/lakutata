//The tests of the directory backend, run on each database: SQLite in the unit tests, PostgreSQL and MySQL in Docker
import assert from 'node:assert/strict'
import {createHash, randomBytes} from 'node:crypto'
import {after, before, describe, it} from 'node:test'
import {Container} from '@lakutata/core'
import {Database} from '@lakutata/orm/com/database'
import {
    connectLDAP,
    type Directory,
    DN,
    DirectoryBackend,
    type DirectoryEntry,
    directoryEntities,
    type Entry,
    findControl,
    LDAPAttributeOrValueExistsException,
    LDAPBindStateRecord,
    type LDAPClientConnection,
    LDAPConstraintViolationException,
    LDAPEntryAlreadyExistsException,
    LDAPEntryRecord,
    type LDAPInProcessConnection,
    LDAPInvalidCredentialsException,
    LDAPMySQLValueRecord,
    LDAPNoSuchObjectException,
    LDAPNotAllowedOnNonLeafException,
    LDAPObjectClassViolationException,
    LDAPResultException,
    LDAPServer,
    LDAPUnavailableCriticalExtensionException,
    LDAPUnavailableException,
    LDAPUnwillingToPerformException,
    LDAPValueRecord,
    PagedResultsControl,
    SortRequestControl,
    SortResponseControl,
    TreeDeleteControl,
    VLVRequestControl,
    VLVResponseControl,
    type WriteContext
} from '../../exports/LDAP.js'
import type {BundledSchemaName} from '../../exports/Schemas.js'

const BASE: string = 'dc=example,dc=com'
const ADMIN: string = 'cn=admin,dc=example,dc=com'

/**
 * The next add, rename or delete of a HoldingBackend to hold in its transaction, its locks kept: told when it is held, let go
 * when the test says
 */
let held: {reached: () => void, release: Promise<void>} | undefined

/**
 * Hold the next add, modify, rename or delete of a HoldingBackend: told when it is held, let go by release()
 */
function holdNext(): {reached: Promise<void>, release: () => void} {
    let reached: () => void = (): void => undefined
    let release: () => void = (): void => undefined
    const reachedPromise: Promise<void> = new Promise<void>((resolve: () => void): void => {
        reached = resolve
    })
    held = {reached: (): void => reached(), release: new Promise<void>((resolve: () => void): void => {
        release = resolve
    })}
    return {reached: reachedPromise, release: (): void => release()}
}

/**
 * Wait a while: the writes started meanwhile reach the locks of a held write
 */
function waitAWhile(): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 300)
    })
}

/**
 * Hold the write of a HoldingBackend when the test asked for it
 */
async function hold(): Promise<void> {
    const current: {reached: () => void, release: Promise<void>} | undefined = held
    if (!current) return
    held = undefined
    current.reached()
    await current.release
}

/**
 * A directory backend holding its adds, modifies, renames and deletes in their transactions once they are written, until the test
 * lets them go: the writes made meanwhile on other connections meet their locks
 */
class HoldingBackend extends DirectoryBackend {
    public async add(context: WriteContext, entry: DirectoryEntry): Promise<void> {
        await super.add(context, entry)
        await hold()
    }

    public async modify(context: WriteContext, dn: Parameters<DirectoryBackend['modify']>[1], changes: Parameters<DirectoryBackend['modify']>[2]): Promise<void> {
        await super.modify(context, dn, changes)
        await hold()
    }

    public async modifyDN(context: WriteContext, dn: Parameters<DirectoryBackend['modifyDN']>[1], entry: DirectoryEntry): Promise<void> {
        await super.modifyDN(context, dn, entry)
        await hold()
    }

    public async delete(context: WriteContext, dn: Parameters<DirectoryBackend['delete']>[1], options: {subtree: boolean}): Promise<void> {
        await super.delete(context, dn, options)
        await hold()
    }
}

/**
 * What a MeanwhileBackend runs once a bind has read the entry of a DN, before the bind checks the password and hashes
 * it again, as many times as left
 */
let meanwhile: {dn: string, left: number, run: () => Promise<unknown>} | undefined

/**
 * A directory backend running a step of the test once a bind has read an entry, and giving the stored passwords
 */
class MeanwhileBackend extends DirectoryBackend {
    public static last: MeanwhileBackend | undefined

    protected reading: Parameters<DirectoryBackend['get']>[0] | undefined

    public async get(...args: Parameters<DirectoryBackend['get']>): Promise<DirectoryEntry | undefined> {
        this.reading = args[0]
        MeanwhileBackend.last = this
        const entry: DirectoryEntry | undefined = await super.get(...args)
        const current: {dn: string, left: number, run: () => Promise<unknown>} | undefined = meanwhile
        if (current && current.left > 0 && args[1].toString() === current.dn) {
            current.left--
            await current.run()
        }
        return entry
    }

    /**
     * The values of userPassword the backend holds for a DN
     * @param dn The DN.
     */
    public async passwords(dn: string): Promise<string[]> {
        const entry: DirectoryEntry | undefined = await super.get(this.reading!, DN.parse(dn))
        return (entry?.attributes.find((attribute) => attribute.type.toLowerCase() === 'userpassword')?.values ?? []).map((value) => value.toString())
    }
}

/**
 * Two writes of a MeetingBackend to meet once each has locked its entry, before they write: each then meets the lock of
 * the other (at most 5 seconds, then they go on)
 */
let meeting: {arrived: number, met: Promise<void>, meet: () => void} | undefined

/**
 * A directory backend whose writes, once the entry of each is locked, wait for each other when the test asks for it
 */
class MeetingBackend extends DirectoryBackend {
    public async lock(context: WriteContext, dn: Parameters<DirectoryBackend['lock']>[1]): Promise<Awaited<ReturnType<DirectoryBackend['lock']>>> {
        const entry: Awaited<ReturnType<DirectoryBackend['lock']>> = await super.lock(context, dn)
        const current: {arrived: number, met: Promise<void>, meet: () => void} | undefined = meeting
        if (current) {
            if (++current.arrived === 2) {
                meeting = undefined
                current.meet()
            }
            await Promise.race([current.met, new Promise<void>((resolve: () => void): void => {
                setTimeout(resolve, 5000)
            })])
        }
        return entry
    }
}

/**
 * The last CapturedBackend started
 */
let captured: DirectoryBackend | undefined

/**
 * A directory backend the test reaches once it is started
 */
class CapturedBackend extends DirectoryBackend {
    protected async init(): Promise<void> {
        await super.init()
        captured = this
    }
}

/**
 * Told of each modify reaching a ReachingBackend, by its DN
 */
let reaching: ((dn: string) => void) | undefined

/**
 * A directory backend telling the test of the modifies reaching it, before they run
 */
class ReachingBackend extends DirectoryBackend {
    public async modify(context: WriteContext, dn: Parameters<DirectoryBackend['modify']>[1], changes: Parameters<DirectoryBackend['modify']>[2]): Promise<void> {
        reaching?.(dn.toString())
        await super.modify(context, dn, changes)
    }
}

/**
 * A directory backend whose work once a transaction is committed fails (the references of an entry resolved)
 */
class FailingAfterCommitBackend extends DirectoryBackend {
    protected async resolveReferences(): Promise<void> {
        throw new Error('the references not resolved')
    }
}

/**
 * Told of each read, lock and modify a QueueingBackend has queued in the turn of its write, before they run
 */
let queueing: ((operation: 'get' | 'lock' | 'modify', dn: string) => void) | undefined

/**
 * A directory backend telling the test of the operations it has queued in the turn of the write they are made in
 */
class QueueingBackend extends DirectoryBackend {
    public async get(context: Parameters<DirectoryBackend['get']>[0], dn: Parameters<DirectoryBackend['get']>[1]): Promise<Awaited<ReturnType<DirectoryBackend['get']>>> {
        const reading: ReturnType<DirectoryBackend['get']> = super.get(context, dn)
        queueing?.('get', dn.toString())
        return reading
    }

    public async lock(context: WriteContext, dn: Parameters<DirectoryBackend['lock']>[1]): Promise<Awaited<ReturnType<DirectoryBackend['lock']>>> {
        const locking: ReturnType<DirectoryBackend['lock']> = super.lock(context, dn)
        queueing?.('lock', dn.toString())
        return locking
    }

    public async modify(context: WriteContext, dn: Parameters<DirectoryBackend['modify']>[1], changes: Parameters<DirectoryBackend['modify']>[2]): Promise<void> {
        const writing: Promise<void> = super.modify(context, dn, changes)
        queueing?.('modify', dn.toString())
        await writing
    }
}

/**
 * Told of each batch of entries a CountingBackend reads
 */
let readingEntries: (() => void) | undefined

/**
 * A directory backend telling the test of the batches of entries it reads (not the reads of one entry, as the base of a
 * search the engine checks)
 */
class CountingBackend extends DirectoryBackend {
    protected async entries(...parameters: Parameters<DirectoryBackend['entries']>): Promise<DirectoryEntry[]> {
        if (parameters[1].length > 1) readingEntries?.()
        return super.entries(...parameters)
    }
}

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
        //A server of a HoldingBackend on the database of the suite (its writes taking turns with the suite's on SQLite)
        const holdingServer = async (): Promise<LDAPServer> => {
            if (!container.has('holding')) await container.setNamed('holding', LDAPServer, {port: false, schema: schema, backends: [{class: HoldingBackend, suffix: BASE, database: 'database'}], access: {admins: [ADMIN]}})
            return container.get<LDAPServer>('holding')
        }

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
                //A critical view with a sort the backend cannot do, not critical: refused, not every entry unsorted
                await assert.rejects(connection.search(people, {scope: 'one', paged: false, controls: [SortRequestControl.encode([{attribute: 'jpegPhoto'}]), VLVRequestControl.encode({beforeCount: 0, afterCount: 4, offset: {offset: 1, contentCount: 0}}, true)]}), LDAPUnavailableCriticalExtensionException)
                //A virtual attribute (email, mail under another name) sorted on the entries themselves
                const byEmail = await connection.search(people, {scope: 'one', sort: [{attribute: 'email'}], window: {offset: 1, limit: 3}})
                assert.deepEqual(byEmail.entries.map((entry) => entry.first('uid')), ['user0', 'user10', 'user11'])
            } finally {
                await second.destroy()
            }
        })

        it('counts and windows what a session may read, the entries the access check hides left out first', async () => {
            //The users of an even number hidden from the users
            const hidingContainer: Container = new Container()
            try {
                await hidingContainer.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await hidingContainer.setNamed('ldap', LDAPServer, {port: false, schema: schema, backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}], access: {admins: [ADMIN], check: (request: {operation: string, identity?: {toString(): string}, dn: {toString(): string}}): boolean | undefined => request.operation === 'read' && String(request.identity) !== ADMIN && /^uid=user\d*[02468],/i.test(String(request.dn)) ? false : undefined}})
                const reader: LDAPInProcessConnection = (await hidingContainer.get<LDAPServer>('ldap')).connect()
                await reader.bind(`uid=user1,${people}`, 'password1')
                //The virtual list view: counted and windowed on the entries it reads
                const window = await reader.search(people, {scope: 'one', filter: '(uid=user*)', sort: [{attribute: 'cn'}], window: {offset: 1, limit: 5}})
                assert.deepEqual([window.total, window.entries.length], [15, 5])
                assert.deepEqual(window.entries.map((entry) => entry.first('cn')), ['User 01', 'User 03', 'User 05', 'User 07', 'User 09'])
                //Sorted and paged: full pages, in order
                const counts: number[] = []
                let cookie: Buffer = Buffer.alloc(0)
                const names: string[] = []
                do {
                    const page = await reader.search(people, {scope: 'one', filter: '(uid=user*)', paged: false, controls: [SortRequestControl.encode([{attribute: 'cn'}]), PagedResultsControl.encode({size: 4, cookie: cookie})]})
                    counts.push(page.entries.length)
                    names.push(...page.entries.map((entry) => entry.first('cn')!))
                    cookie = PagedResultsControl.decode(findControl(page.controls, PagedResultsControl)!).cookie
                } while (cookie.length)
                assert.deepEqual(counts, [4, 4, 4, 3])
                assert.deepEqual(names, [...names].sort())
            } finally {
                await hidingContainer.destroy()
            }
        })

        it('orders and windows in SQL by the forms of the values, as the engine sorts', async () => {
            const unit: string = await directory.createOrganizationalUnit(BASE, {ou: 'sorting'})
            try {
                const devices: [string, string[]][] = [['d1', ['m', 'b']], ['d2', ['x']], ['d3', []], ['d4', ['n', 'a']], ['d5', ['\u{20000}']], ['d6', ['\uFA0E']]]
                for (const [cn, description] of devices) await admin.add(`cn=${cn},${unit}`, {objectClass: 'device', cn: cn, ...description.length ? {description: description} : {}})
                const order = async (reverse: boolean): Promise<(string | undefined)[]> => (await admin.search(unit, {scope: 'one', sort: [{attribute: 'description', reverse: reverse}], window: {offset: 1, limit: 10}})).entries.map((entry) => entry.first('cn'))
                //The least value orders an entry, the greatest in reverse; without one, last, and first in reverse (no value is
                //greater than every value, RFC 2891 §2.2); by code points
                assert.deepEqual(await order(false), ['d4', 'd1', 'd2', 'd6', 'd5', 'd3'])
                assert.deepEqual(await order(true), ['d3', 'd5', 'd6', 'd2', 'd4', 'd1'])
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
            //By ranges, as Active Directory gives it
            assert.deepEqual((await admin.search(`uid=user5,${people}`, {scope: 'base', attributes: ['memberOf;range=0-*'], ranges: false})).entries[0].attributes.map((item) => [item.type, item.values.length]), [['memberOf;range=0-*', 2]])
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
            //A bind an interceptor answers without the password checked: no time kept; one it answers nothing: other, and
            //no time kept either (the backend's lastBind outside it)
            const refusing: Container = new Container()
            try {
                await refusing.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await refusing.setNamed('ldap', LDAPServer, {port: false, schema: schema, backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}], access: {admins: [ADMIN]}, interceptors: [{interceptor: {name: 'refusing', operations: ['bind'], around: async (_context: unknown, request: {dn?: {toString(): string}}) => request.dn?.toString().startsWith('uid=user3,') ? {resultCode: 53} : undefined} as never}]})
                const server: LDAPServer = await refusing.get<LDAPServer>('ldap')
                await assert.rejects(server.connect().bind(`uid=user3,${people}`, 'anything'), (error: unknown) => error instanceof LDAPResultException && error.code === 53)
                assert.equal((await admin.search(`uid=user3,${people}`, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp'), undefined)
                await assert.rejects(server.connect().bind(`uid=user4,${people}`, 'wrong'), (error: unknown) => error instanceof LDAPResultException && error.code === 80)
                assert.equal((await admin.search(`uid=user4,${people}`, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp'), undefined)
            } finally {
                await refusing.destroy()
            }
            //A SASL PLAIN bind too
            await admin.passwordModify({userIdentity: `uid=user2,${people}`, newPassword: 'password2'})
            await ldap.connect().saslBind('PLAIN', Buffer.from(`\0dn:uid=user2,${people}\0password2`))
            assert.match((await admin.search(`uid=user2,${people}`, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp') ?? '', /^\d{14}Z$/)
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
            //A second instance on the same database (on SQLite, a second connection to the same file)
            const second: Container = new Container()
            await second.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
            await second.setNamed('ldap', LDAPServer, {port: false, schema: schema, backends: [{class: DirectoryBackend, suffix: BASE, database: 'database', unique: ['uid'], nestedGroups: 2, mailAlias: true}], access: {admins: [ADMIN]}})
            const instances: LDAPServer[] = [ldap, await second.get<LDAPServer>('ldap')]
            const valueEntity = String(databaseOptions.type) === 'mysql' ? LDAPMySQLValueRecord : LDAPValueRecord
            const device: string = `cn=concurrent,${BASE}`
            const user: string = `uid=concurrent,${people}`
            const unit: string = `ou=concurrent-members,${BASE}`
            const group: string = `cn=concurrent,${groups}`
            const bulk: string = `ou=concurrent-bulk,${BASE}`
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
                //Forty entries added under one parent at once: they share the lock of the parent, and all are kept
                await directory.createOrganizationalUnit(BASE, {ou: 'concurrent-bulk'})
                await Promise.all(Array.from({length: 40}, (_: unknown, index: number) => writer(index).add(`cn=bulk${index},${bulk}`, {objectClass: 'device', cn: `bulk${index}`})))
                assert.equal((await admin.search(bulk, {scope: 'one', paged: false})).entries.length, 40)
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
                await admin.delete(bulk, {controls: [TreeDeleteControl.encode()]}).catch((): undefined => undefined)
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

        it('leaves nothing of a write that failed in the transaction of another, which goes on, with others made at once', {timeout: 60000}, async () => {
            const outer: string = `cn=outer,${BASE}`
            const failing: string = `cn=failing,${people}`
            const siblings: string[] = [`cn=sibling1,${BASE}`, `cn=sibling2,${BASE}`]
            await admin.add(outer, {objectClass: 'device', cn: 'outer'})
            await admin.add(failing, {objectClass: 'inetOrgPerson', cn: 'failing', sn: 'Failing', uid: 'failing'})
            for (const dn of siblings) await admin.add(dn, {objectClass: 'device', cn: DN.parse(dn).rdn()!.attributes[0].value})
            const failingWrites: Container = new Container()
            let refused: unknown
            try {
                await failingWrites.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await failingWrites.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: DirectoryBackend, suffix: BASE, database: 'database', unique: ['uid']}],
                    access: {admins: [ADMIN]},
                    //Writes in the transaction of another, at once: one refused once it has written a value (uid taken), the
                    //error caught, the others made
                    interceptors: [{name: 'failing', operations: ['modify'], beforeCommit: async (_context: unknown, request: {dn?: {toString(): string}}): Promise<void> => {
                        if (request.dn?.toString() !== outer) return
                        const server: LDAPServer = await failingWrites.get<LDAPServer>('ldap')
                        await Promise.all([
                            server.connect(ADMIN).modify(siblings[0], {operation: 'add', attribute: 'description', values: 'first'}),
                            server.connect(ADMIN).modify(failing, [{operation: 'add', attribute: 'description', values: 'written before the refusal'}, {operation: 'replace', attribute: 'uid', values: 'user0'}]).catch((error: unknown): void => {
                                refused = error
                            }),
                            server.connect(ADMIN).modify(siblings[1], {operation: 'add', attribute: 'description', values: 'second'})
                        ])
                    }}]
                })
                await (await failingWrites.get<LDAPServer>('ldap')).connect(ADMIN).modify(outer, {operation: 'add', attribute: 'description', values: 'outer'})
                assert.ok(refused instanceof LDAPConstraintViolationException, String(refused))
                assert.deepEqual((await admin.search(outer, {scope: 'base'})).entries[0].get('description'), ['outer'])
                const entry = (await admin.search(failing, {scope: 'base'})).entries[0]
                assert.deepEqual([entry.get('description'), entry.get('uid')], [[], ['failing']])
                assert.deepEqual((await admin.search(siblings[0], {scope: 'base'})).entries[0].get('description'), ['first'])
                assert.deepEqual((await admin.search(siblings[1], {scope: 'base'})).entries[0].get('description'), ['second'])
            } finally {
                await failingWrites.destroy()
                for (const dn of [outer, failing, ...siblings]) await admin.delete(dn).catch((): undefined => undefined)
            }
        })

        it('keeps the tree whole when entries are added or moved under one being renamed or deleted', {timeout: 60000}, async () => {
            const db: Database = await container.get<Database>('database')
            const holding: LDAPServer = await holdingServer()
            //Each entry under its parent: the parent there, the path and the DN made of the parent's
            const whole = async (): Promise<void> => {
                const rows: LDAPEntryRecord[] = await db.getRepository(LDAPEntryRecord).find()
                const byId: Map<string, LDAPEntryRecord> = new Map(rows.map((row: LDAPEntryRecord): [string, LDAPEntryRecord] => [row.id, row]))
                for (const row of rows) {
                    if (!row.parentId) continue
                    const parent: LDAPEntryRecord | undefined = byId.get(row.parentId)
                    assert.ok(parent, `${row.dn}: its parent is not there`)
                    assert.equal(row.path, parent.path + row.id.replace(/-/g, '').toLowerCase(), `${row.dn}: its path`)
                    assert.equal(row.dn.slice(row.dn.indexOf(',') + 1).toLowerCase(), parent.dn.toLowerCase(), `${row.dn}: its DN`)
                }
            }
            const unit: string = await directory.createOrganizationalUnit(BASE, {ou: 'tree'})
            try {
                //An entry added under one being renamed
                const parent: string = await directory.createOrganizationalUnit(unit, {ou: 'parent'})
                let holdOn: {reached: Promise<void>, release: () => void} = holdNext()
                const renaming: Promise<unknown> = holding.connect(ADMIN).modifyDN(parent, 'ou=parent-renamed')
                await holdOn.reached
                const adding: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([admin.add(`cn=child,${parent}`, {objectClass: 'device', cn: 'child'})])
                await waitAWhile()
                holdOn.release()
                await renaming
                for (const result of await adding) if (result.status === 'rejected') assert.ok(result.reason instanceof LDAPNoSuchObjectException, String(result.reason))
                await whole()
                //An entry moved under one being deleted
                const going: string = await directory.createOrganizationalUnit(unit, {ou: 'going'})
                const mover: string = await directory.createOrganizationalUnit(unit, {ou: 'mover'})
                holdOn = holdNext()
                const deleting: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([holding.connect(ADMIN).delete(going)])
                await holdOn.reached
                const moving: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([admin.modifyDN(mover, 'ou=mover', {newSuperior: going})])
                await waitAWhile()
                holdOn.release()
                const [deleted, moved] = [(await deleting)[0], (await moving)[0]]
                assert.ok(deleted.status === 'fulfilled' || (deleted.reason instanceof LDAPNotAllowedOnNonLeafException), String((deleted as PromiseRejectedResult).reason))
                if (moved.status === 'rejected') assert.ok(moved.reason instanceof LDAPNoSuchObjectException, String(moved.reason))
                await whole()
                //An entry moved under one being renamed, the other way round: the move held, the rename made meanwhile
                const destination: string = await directory.createOrganizationalUnit(unit, {ou: 'destination'})
                const traveller: string = await directory.createOrganizationalUnit(unit, {ou: 'traveller'})
                holdOn = holdNext()
                const travelling: Promise<unknown> = holding.connect(ADMIN).modifyDN(traveller, 'ou=traveller', {newSuperior: destination})
                await holdOn.reached
                const renamingDestination: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([admin.modifyDN(destination, 'ou=destination-renamed')])
                await waitAWhile()
                holdOn.release()
                await travelling
                const renamedDestination: PromiseSettledResult<unknown> = (await renamingDestination)[0]
                assert.equal(renamedDestination.status, 'fulfilled', String((renamedDestination as PromiseRejectedResult).reason))
                await whole()
                //An entry added under one being deleted
                const leaf: string = await directory.createOrganizationalUnit(unit, {ou: 'leaf'})
                holdOn = holdNext()
                const removing: Promise<unknown> = holding.connect(ADMIN).delete(leaf)
                await holdOn.reached
                const addingUnder: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([admin.add(`cn=orphan,${leaf}`, {objectClass: 'device', cn: 'orphan'})])
                await waitAWhile()
                holdOn.release()
                await removing
                const addedUnder: PromiseSettledResult<unknown> = (await addingUnder)[0]
                assert.equal(addedUnder.status, 'rejected')
                assert.ok((addedUnder as PromiseRejectedResult).reason instanceof LDAPNoSuchObjectException, String((addedUnder as PromiseRejectedResult).reason))
                await whole()
                //An entry deleted while an entry is moved under it: refused, as it has one below it now
                const keeper: string = await directory.createOrganizationalUnit(unit, {ou: 'keeper'})
                const kept: string = await directory.createOrganizationalUnit(unit, {ou: 'kept'})
                holdOn = holdNext()
                const keeping: Promise<unknown> = holding.connect(ADMIN).modifyDN(kept, 'ou=kept', {newSuperior: keeper})
                await holdOn.reached
                const deletingKeeper: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([admin.delete(keeper)])
                await waitAWhile()
                holdOn.release()
                await keeping
                const keeperDeleted: PromiseSettledResult<unknown> = (await deletingKeeper)[0]
                assert.equal(keeperDeleted.status, 'rejected')
                assert.ok((keeperDeleted as PromiseRejectedResult).reason instanceof LDAPNotAllowedOnNonLeafException, String((keeperDeleted as PromiseRejectedResult).reason))
                await whole()
                //An entry added two levels below one being renamed, then below one being deleted with its subtree: the
                //rename and the delete take it too
                const top: string = await directory.createOrganizationalUnit(unit, {ou: 'top'})
                const middle: string = await directory.createOrganizationalUnit(top, {ou: 'middle'})
                holdOn = holdNext()
                const addingDeep: Promise<unknown> = holding.connect(ADMIN).add(`cn=deep,${middle}`, {objectClass: 'device', cn: 'deep'})
                await holdOn.reached
                const renamingTop: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([admin.modifyDN(top, 'ou=top-renamed')])
                await waitAWhile()
                holdOn.release()
                await addingDeep
                const topRenamed: PromiseSettledResult<unknown> = (await renamingTop)[0]
                assert.equal(topRenamed.status, 'fulfilled', String((topRenamed as PromiseRejectedResult).reason))
                await whole()
                assert.equal((await admin.search(`ou=top-renamed,${unit}`, {filter: '(cn=deep)'})).entries.length, 1)
                const renamedMiddle: string = `ou=middle,ou=top-renamed,${unit}`
                holdOn = holdNext()
                const addingDeeper: Promise<unknown> = holding.connect(ADMIN).add(`cn=deeper,${renamedMiddle}`, {objectClass: 'device', cn: 'deeper'})
                await holdOn.reached
                const deletingTop: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([admin.delete(`ou=top-renamed,${unit}`, {controls: [TreeDeleteControl.encode()]})])
                await waitAWhile()
                holdOn.release()
                await addingDeeper
                const topDeleted: PromiseSettledResult<unknown> = (await deletingTop)[0]
                assert.equal(topDeleted.status, 'fulfilled', String((topDeleted as PromiseRejectedResult).reason))
                await whole()
                assert.equal((await db.getRepository(LDAPEntryRecord).find()).filter((row: LDAPEntryRecord): boolean => row.dn.startsWith('cn=deep')).length, 0)
            } finally {
                held = undefined
                await admin.delete(unit, {controls: [TreeDeleteControl.encode()]}).catch((): undefined => undefined)
            }
        })

        it('makes a modify from the entry as it is once locked: increments each counted, a required attribute not emptied', {timeout: 60000}, async () => {
            const counter: string = `uid=counter,${people}`
            const team: string = `cn=team,${groups}`
            await admin.add(counter, {objectClass: ['account', 'posixAccount'], uid: 'counter', cn: 'counter', uidNumber: '20000', gidNumber: '100', homeDirectory: '/home/counter'})
            await admin.add(team, {objectClass: 'groupOfNames', cn: 'team', member: [`uid=user1,${people}`, `uid=user2,${people}`]})
            const holding: LDAPServer = await holdingServer()
            try {
                //Ten increments at once: each one counted
                await Promise.all(Array.from({length: 10}, () => ldap.connect(ADMIN).modify(counter, {operation: 'increment', attribute: 'gidNumber', values: '1'})))
                assert.equal((await admin.search(counter, {scope: 'base'})).entries[0].first('gidNumber'), '110')
                //Each of two writers deletes one of the two values of a required attribute: the second leaves none, refused
                const holdOn: {reached: Promise<void>, release: () => void} = holdNext()
                const first: Promise<unknown> = holding.connect(ADMIN).modify(team, {operation: 'delete', attribute: 'member', values: `uid=user1,${people}`})
                await holdOn.reached
                const second: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([admin.modify(team, {operation: 'delete', attribute: 'member', values: `uid=user2,${people}`})])
                await waitAWhile()
                holdOn.release()
                await first
                const refusedSecond: PromiseSettledResult<unknown> = (await second)[0]
                assert.equal(refusedSecond.status, 'rejected')
                assert.ok((refusedSecond as PromiseRejectedResult).reason instanceof LDAPObjectClassViolationException, String((refusedSecond as PromiseRejectedResult).reason))
                assert.deepEqual((await admin.search(team, {scope: 'base'})).entries[0].get('member'), [`uid=user2,${people}`])
            } finally {
                held = undefined
                await admin.delete(counter).catch((): undefined => undefined)
                await admin.delete(team).catch((): undefined => undefined)
            }
        })

        it('points the values written while the entries they name are added, renamed or deleted at the entries as they are', {timeout: 60000}, async () => {
            const db: Database = await container.get<Database>('database')
            const valueEntity = String(databaseOptions.type) === 'mysql' ? LDAPMySQLValueRecord : LDAPValueRecord
            const holding: LDAPServer = await holdingServer()
            const team: string = `cn=references,${groups}`
            const named = (uid: string): string => `uid=${uid},${people}`
            await admin.add(team, {objectClass: 'groupOfNames', cn: 'references', member: named('user3')})
            //The row of the member value naming a DN, as the database keeps it
            const member = async (dn: string): Promise<LDAPValueRecord | undefined> => {
                const group: LDAPEntryRecord = await db.getRepository(LDAPEntryRecord).findOneByOrFail({dn: team})
                return (await db.getRepository(valueEntity).findBy({entryId: group.id, attributeType: 'member'})).find((row: LDAPValueRecord): boolean => row.value.toLowerCase() === dn.toLowerCase())
            }
            const idOf = async (dn: string): Promise<string | undefined> => (await db.getRepository(LDAPEntryRecord).findOneBy({dn: dn}))?.id
            try {
                //A member named while its entry is being added: pointed at it
                let holdOn: {reached: Promise<void>, release: () => void} = holdNext()
                const adding: Promise<unknown> = holding.connect(ADMIN).add(named('arriving'), {objectClass: 'account', uid: 'arriving'})
                await holdOn.reached
                const naming: Promise<unknown> = admin.modify(team, {operation: 'add', attribute: 'member', values: named('arriving')})
                await waitAWhile()
                holdOn.release()
                await adding
                await naming
                assert.equal((await member(named('arriving')))?.target, await idOf(named('arriving')))
                assert.ok((await admin.search(named('arriving'), {scope: 'base', attributes: ['memberOf']})).entries[0].get('memberOf').includes(team))
                //A member named by the DN of an entry being renamed: the name of no entry once the rename is made
                await admin.add(named('leaving'), {objectClass: 'account', uid: 'leaving'})
                holdOn = holdNext()
                const renaming: Promise<unknown> = holding.connect(ADMIN).modifyDN(named('leaving'), 'uid=left')
                await holdOn.reached
                const namingOld: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([admin.modify(team, {operation: 'add', attribute: 'member', values: named('leaving')})])
                await waitAWhile()
                holdOn.release()
                await renaming
                if ((await namingOld)[0].status === 'fulfilled') assert.equal((await member(named('leaving')))?.target ?? null, null)
                //A member named while its entry is being deleted: pointing at no entry, not at the deleted one
                await admin.add(named('going'), {objectClass: 'account', uid: 'going'})
                const going: string | undefined = await idOf(named('going'))
                holdOn = holdNext()
                const deleting: Promise<unknown> = holding.connect(ADMIN).delete(named('going'))
                await holdOn.reached
                const namingGone: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([admin.modify(team, {operation: 'add', attribute: 'member', values: named('going')})])
                await waitAWhile()
                holdOn.release()
                await deleting
                if ((await namingGone)[0].status === 'fulfilled') assert.notEqual((await member(named('going')))?.target ?? null, going)
                //An entry renamed to a DN members name already: they point at it
                await admin.modify(team, {operation: 'add', attribute: 'member', values: named('future')})
                await admin.add(named('present'), {objectClass: 'account', uid: 'present'})
                await admin.modifyDN(named('present'), 'uid=future')
                assert.equal((await member(named('future')))?.target, await idOf(named('future')))
            } finally {
                held = undefined
                await admin.delete(team).catch((): undefined => undefined)
                for (const uid of ['arriving', 'left', 'leaving', 'going', 'future', 'present']) await admin.delete(named(uid)).catch((): undefined => undefined)
            }
        })

        it('fills the values naming a new DN once committed only for an entry which has it', {timeout: 60000}, async () => {
            const db: Database = await container.get<Database>('database')
            const valueEntity = String(databaseOptions.type) === 'mysql' ? LDAPMySQLValueRecord : LDAPValueRecord
            const outer: string = `cn=backfilling,${BASE}`
            const team: string = `cn=backfilled,${groups}`
            const wanted: string = `uid=wanted,${people}`
            const renamable: string = `uid=renamable,${people}`
            await admin.add(outer, {objectClass: 'device', cn: 'backfilling'})
            await admin.add(team, {objectClass: 'groupOfNames', cn: 'backfilled', member: wanted})
            await admin.add(renamable, {objectClass: 'account', uid: 'renamable'})
            //The uid of the new RDN taken elsewhere: the rename is refused after it filled the values naming its new DN
            await admin.add(`uid=wanted,${groups}`, {objectClass: 'account', uid: 'wanted'})
            const backfilling: Container = new Container()
            try {
                await backfilling.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await backfilling.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: DirectoryBackend, suffix: BASE, database: 'database', unique: ['uid']}],
                    access: {admins: [ADMIN]},
                    interceptors: [{name: 'backfilling', operations: ['modify'], beforeCommit: async (_context: unknown, request: {dn?: {toString(): string}}): Promise<void> => {
                        if (request.dn?.toString() !== outer) return
                        await assert.rejects((await backfilling.get<LDAPServer>('ldap')).connect(ADMIN).modifyDN(renamable, 'uid=wanted'), LDAPConstraintViolationException)
                    }}]
                })
                await (await backfilling.get<LDAPServer>('ldap')).connect(ADMIN).modify(outer, {operation: 'add', attribute: 'description', values: 'outer'})
                //The value naming the DN the rename did not take names no entry
                const group: LDAPEntryRecord = await db.getRepository(LDAPEntryRecord).findOneByOrFail({dn: team})
                const row: LDAPValueRecord | undefined = (await db.getRepository(valueEntity).findBy({entryId: group.id, attributeType: 'member'})).find((item: LDAPValueRecord): boolean => item.value.toLowerCase() === wanted.toLowerCase())
                assert.equal(row?.target ?? null, null)
                assert.equal((await admin.search(renamable, {scope: 'base'})).entries.length, 1)
            } finally {
                await backfilling.destroy()
                for (const dn of [outer, team, renamable, `uid=wanted,${groups}`]) await admin.delete(dn).catch((): undefined => undefined)
            }
        })

        it('answers noSuchObject to a client deleting an entry another deleted once the engine read it', {timeout: 60000}, async () => {
            const holding: LDAPServer = await holdingServer()
            const doomed: string = `cn=doomed,${BASE}`
            await admin.add(doomed, {objectClass: 'device', cn: 'doomed'})
            try {
                const holdOn: {reached: Promise<void>, release: () => void} = holdNext()
                const first: Promise<unknown> = holding.connect(ADMIN).delete(doomed)
                await holdOn.reached
                const second: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([admin.delete(doomed)])
                await waitAWhile()
                holdOn.release()
                await first
                const result: PromiseSettledResult<unknown> = (await second)[0]
                assert.equal(result.status, 'rejected')
                assert.ok((result as PromiseRejectedResult).reason instanceof LDAPNoSuchObjectException, String((result as PromiseRejectedResult).reason))
            } finally {
                held = undefined
                await admin.delete(doomed).catch((): undefined => undefined)
            }
        })

        it('hashes a password again at a bind only while the entry still holds the value the bind matched', {timeout: 60000}, async () => {
            //A value of another scheme than the server's, as an import gives
            const ssha = (password: string): string => {
                const salt: Buffer = randomBytes(8)
                return `{SSHA}${Buffer.concat([createHash('sha1').update(password).update(salt).digest(), salt]).toString('base64')}`
            }
            if (!container.has('meanwhile')) await container.setNamed('meanwhile', LDAPServer, {port: false, schema: schema, backends: [{class: MeanwhileBackend, suffix: BASE, database: 'database'}], access: {admins: [ADMIN]}, passwords: {iterations: 1000}})
            const server: LDAPServer = await container.get<LDAPServer>('meanwhile')
            const user: string = `uid=rehashing,${people}`
            try {
                await admin.add(user, {objectClass: ['account', 'simpleSecurityObject'], uid: 'rehashing', userPassword: ssha('second')})
                //Changed meanwhile: left as it is, the password the bind checked no longer binding
                const third: string = ssha('third')
                meanwhile = {dn: user, left: 1, run: () => admin.modify(user, {operation: 'replace', attribute: 'userPassword', values: third})}
                await server.connect().bind(user, 'second')
                assert.deepEqual(await MeanwhileBackend.last!.passwords(user), [third])
                await assert.rejects(server.connect().bind(user, 'second'), LDAPInvalidCredentialsException)
                //Two binds having read the value at once: one hashes it again, the other finds it gone
                let arrived: number = 0
                let open: () => void = (): void => undefined
                const met: Promise<void> = new Promise<void>((resolve: () => void): void => {
                    open = resolve
                })
                meanwhile = {dn: user, left: 2, run: async (): Promise<void> => {
                    if (++arrived === 2) open()
                    await Promise.race([met, new Promise<void>((resolve: () => void): void => {
                        setTimeout(resolve, 5000)
                    })])
                }}
                await Promise.all([server.connect().bind(user, 'third'), server.connect().bind(user, 'third')])
                const kept: string[] = await MeanwhileBackend.last!.passwords(user)
                assert.equal(kept.length, 1, kept.join(' '))
                assert.match(kept[0], /^\{PBKDF2-SHA512\}/)
                //Deleted meanwhile: nothing written
                await admin.modify(user, {operation: 'replace', attribute: 'userPassword', values: ssha('fourth')})
                meanwhile = {dn: user, left: 1, run: () => admin.delete(user)}
                await server.connect().bind(user, 'fourth')
                assert.deepEqual(await MeanwhileBackend.last!.passwords(user), [])
            } finally {
                meanwhile = undefined
                await admin.delete(user).catch((): undefined => undefined)
            }
        })

        it('lets no more binds through at once than the grace binds left', {timeout: 60000}, async () => {
            if (!container.has('graced')) await container.setNamed('graced', LDAPServer, {port: false, schema: schema, backends: [{class: MeanwhileBackend, suffix: BASE, database: 'database'}], access: {admins: [ADMIN]}, passwords: {iterations: 1000}, bindThrottle: {maxFailures: 0, ipMaxFailures: 0, delay: 0}, passwordPolicy: {default: {maxAge: 1, graceAuthNLimit: 1}}})
            const server: LDAPServer = await container.get<LDAPServer>('graced')
            const user: string = `uid=graced,${people}`
            try {
                await admin.add(user, {objectClass: 'inetOrgPerson', uid: 'graced', cn: 'Graced', sn: 'Graced'})
                //Its password changed under the policy, expired a second later
                await server.connect(ADMIN).passwordModify({userIdentity: user, newPassword: 'graced-password'})
                await new Promise<void>((resolve: () => void): void => {
                    setTimeout(resolve, 1500)
                })
                //Two binds meeting once each has read the entry, before either writes
                let arrived: number = 0
                let open: () => void = (): void => undefined
                const met: Promise<void> = new Promise<void>((resolve: () => void): void => {
                    open = resolve
                })
                meanwhile = {dn: user, left: 2, run: async (): Promise<void> => {
                    if (++arrived === 2) open()
                    await Promise.race([met, new Promise<void>((resolve: () => void): void => {
                        setTimeout(resolve, 5000)
                    })])
                }}
                const answers: number[] = await Promise.all([0, 1].map(() => server.connect().bind(user, 'graced-password').then(() => 0, (error: unknown) => error instanceof LDAPResultException ? error.code : -1)))
                meanwhile = undefined
                assert.deepEqual(answers.sort(), [0, 49])
                assert.equal((await admin.search(user, {scope: 'base', attributes: ['pwdGraceUseTime']})).entries[0].get('pwdGraceUseTime').length, 1)
            } finally {
                meanwhile = undefined
                await admin.delete(user).catch((): undefined => undefined)
            }
        })

        it('does not hold a bind behind a write to its entry, the authTimestamp of the bind left out', {timeout: 60000}, async () => {
            const user: string = `uid=binding,${people}`
            await admin.add(user, {objectClass: 'inetOrgPerson', uid: 'binding', cn: 'Binding', sn: 'Binding'})
            await admin.passwordModify({userIdentity: user, newPassword: 'binding-password'})
            const holding: LDAPServer = await holdingServer()
            try {
                const holdOn: {reached: Promise<void>, release: () => void} = holdNext()
                const modifying: Promise<unknown> = holding.connect(ADMIN).modify(user, {operation: 'replace', attribute: 'description', values: 'held'})
                await holdOn.reached
                //The bind answered while the write holds the entry
                const binding: Promise<unknown> = ldap.connect().bind(user, 'binding-password')
                const answered: unknown = await Promise.race([binding.then((): string => 'answered'), new Promise<string>((resolve: (value: string) => void): void => {
                    setTimeout((): void => resolve('waiting'), 3000)
                })])
                holdOn.release()
                await modifying
                await binding
                //A server that cannot skip a row another write holds (MySQL before 8.0, MariaDB before 10.6): the bind
                //waits for the write, and its time is written
                const version: string = ['mysql', 'mariadb'].includes(String(databaseOptions.type)) ? String(((await (await container.get<Database>('database')).query('SELECT VERSION() AS version')) as {version?: unknown}[])[0]?.version ?? '') : ''
                const [major, minor] = version.split(/[.-]/).map((part: string): number => parseInt(part, 10) || 0)
                const skips: boolean = !version || (/mariadb/i.test(version) ? major > 10 || (major === 10 && minor >= 6) : major >= 8)
                assert.equal(answered, skips ? 'answered' : 'waiting')
                if (!skips) assert.match((await admin.search(user, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp') ?? '', /^\d{14}Z$/)
            } finally {
                held = undefined
                await admin.delete(user).catch((): undefined => undefined)
            }
        })

        it('counts each of the failed binds made at once, in the password policy and in the throttle the instances share', {timeout: 60000}, async () => {
            const db: Database = await container.get<Database>('database')
            const user: string = `uid=counted,${people}`
            await admin.add(user, {objectClass: 'inetOrgPerson', uid: 'counted', cn: 'Counted', sn: 'Counted'})
            await admin.passwordModify({userIdentity: user, newPassword: 'counted-password'})
            const counting: Container = new Container()
            try {
                await counting.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await counting.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN]},
                    passwords: {iterations: 1000},
                    bindThrottle: {maxFailures: 3, ipMaxFailures: 0, delay: 0, lockout: 60000},
                    passwordPolicy: {default: {lockout: true, maxFailure: 5, lockoutDuration: 0}}
                })
                const server: LDAPServer = await counting.get<LDAPServer>('ldap')
                await Promise.allSettled(Array.from({length: 10}, () => server.connect().bind(user, 'wrong')))
                const entry = (await admin.search(user, {scope: 'base', attributes: ['pwdAccountLockedTime', 'pwdFailureTime']})).entries[0]
                assert.ok(entry.first('pwdAccountLockedTime'))
                assert.equal(new Set(entry.get('pwdFailureTime')).size, 5)
                const state: LDAPBindStateRecord | undefined = (await db.getRepository(LDAPBindStateRecord).find()).find((row: LDAPBindStateRecord): boolean => row.key.startsWith('dn:') && row.key.includes('uid=counted'))
                assert.ok(state?.lockedUntil, JSON.stringify(state))
                await assert.rejects(server.connect().bind(user, 'counted-password'), LDAPInvalidCredentialsException)
            } finally {
                await counting.destroy()
                await admin.delete(user).catch((): undefined => undefined)
            }
        })

        it('keeps one value when an internal write adds a value the attribute has (two instances recording one time)', {timeout: 60000}, async () => {
            const dn: string = `cn=same-value,${BASE}`
            await admin.add(dn, {objectClass: 'device', cn: 'same-value'})
            const capturing: Container = new Container()
            try {
                await capturing.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await capturing.setNamed('ldap', LDAPServer, {port: false, schema: schema, backends: [{class: CapturedBackend, suffix: BASE, database: 'database'}], access: {admins: [ADMIN]}})
                const server: LDAPServer = await capturing.get<LDAPServer>('ldap')
                //As the engine writes the state it keeps (the failures of the binds): an internal write, twice the same value
                const context = (): never => ({schema: server.engine.schema, internal: true, operation: 'modify', state: new Map()}) as never
                for (let time: number = 0; time < 2; time++) await captured!.modify(context(), DN.parse(dn), [{operation: 'add', attribute: {type: 'description', values: [Buffer.from('20261111102915.325Z')]}}])
                assert.deepEqual((await admin.search(dn, {scope: 'base'})).entries[0].get('description'), ['20261111102915.325Z'])
            } finally {
                captured = undefined
                await capturing.destroy()
                await admin.delete(dn).catch((): undefined => undefined)
            }
        })

        it('tells the errors of its work once a write is committed as errors of the server, the write done', {timeout: 60000}, async () => {
            const failing: Container = new Container()
            const dn: string = `cn=failing-after-commit,${BASE}`
            try {
                await failing.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await failing.setNamed('ldap', LDAPServer, {port: false, schema: schema, backends: [{class: FailingAfterCommitBackend, suffix: BASE, database: 'database'}], access: {admins: [ADMIN]}})
                const server: LDAPServer = await failing.get<LDAPServer>('ldap')
                const errors: unknown[] = []
                server.engine.events.on('error', (error: unknown): void => {
                    errors.push(error)
                })
                //A value naming no entry: its references resolved once committed
                await server.connect(ADMIN).add(dn, {objectClass: 'device', cn: 'failing-after-commit', seeAlso: `cn=nobody,${BASE}`})
                assert.equal((await admin.search(dn, {scope: 'base'})).entries.length, 1)
                assert.deepEqual(errors.map((error: unknown): string => (error as Error).message), ['the references not resolved'])
            } finally {
                await failing.destroy()
                await admin.delete(dn).catch((): undefined => undefined)
            }
        })

        it('answers busy one of two writes naming the entry of each other, their locks in a cycle', {timeout: 60000, skip: label === 'SQLite' ? 'SQLite takes one write at a time' : false}, async () => {
            const [one, two] = ['cycle-1', 'cycle-2'].map((name: string): string => `cn=${name},${groups}`)
            for (const dn of [one, two]) await admin.add(dn, {objectClass: 'groupOfNames', cn: DN.parse(dn).rdn()!.attributes[0].value, member: `uid=user1,${people}`})
            const meetingContainer: Container = new Container()
            try {
                await meetingContainer.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await meetingContainer.setNamed('ldap', LDAPServer, {port: false, schema: schema, backends: [{class: MeetingBackend, suffix: BASE, database: 'database'}], access: {admins: [ADMIN]}})
                const server: LDAPServer = await meetingContainer.get<LDAPServer>('ldap')
                let meet: () => void = (): void => undefined
                meeting = {arrived: 0, met: new Promise<void>((resolve: () => void): void => {
                    meet = resolve
                }), meet: (): void => meet()}
                //Each write holds its group and waits for the group of the other, which its values name
                const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
                    server.connect(ADMIN).modify(one, {operation: 'add', attribute: 'member', values: two}),
                    server.connect(ADMIN).modify(two, {operation: 'add', attribute: 'member', values: one})
                ])
                const refused: PromiseRejectedResult[] = results.filter((result: PromiseSettledResult<unknown>): result is PromiseRejectedResult => result.status === 'rejected')
                assert.equal(refused.length, 1, JSON.stringify(results.map((result: PromiseSettledResult<unknown>): string => result.status)))
                assert.ok(refused[0].reason instanceof LDAPUnavailableException && refused[0].reason.code === 51, String(refused[0].reason))
                //The other is written, the refused one left nothing
                const members = async (dn: string): Promise<string[]> => (await admin.search(dn, {scope: 'base'})).entries[0].get('member').map((value: string): string => value.toLowerCase()).sort()
                const [kept, lost] = results[0].status === 'fulfilled' ? [one, two] : [two, one]
                assert.deepEqual(await members(kept), [lost, `uid=user1,${people}`].sort())
                assert.deepEqual(await members(lost), [`uid=user1,${people}`])
            } finally {
                meeting = undefined
                await meetingContainer.destroy()
                for (const dn of [one, two]) await admin.delete(dn).catch((): undefined => undefined)
            }
        })

        it('fails the whole write whose transaction a deadlock of a write made in it ended, as busy, whether it caught the error or not', {timeout: 60000, skip: label === 'SQLite' ? 'SQLite takes one write at a time' : false}, async () => {
            for (const catching of [true, false]) {
                const names: string[] = ['deadlock-x', 'deadlock-y', 'deadlock-p', 'deadlock-q']
                const [x, y, p, q] = names.map((name: string): string => `cn=${name},${BASE}`)
                for (const [index, dn] of [x, y, p, q].entries()) await admin.add(dn, {objectClass: 'device', cn: names[index]})
                //Two writes each making two writes in its transaction, in the opposite orders: the database ends one of them
                const latch = (): {open: () => void, wait: () => Promise<void>} => {
                    let open: () => void = (): void => undefined
                    const opened: Promise<void> = new Promise<void>((resolve: () => void): void => {
                        open = resolve
                    })
                    return {open: (): void => open(), wait: (): Promise<void> => Promise.race([opened, new Promise<void>((resolve: () => void): void => {
                        setTimeout(resolve, 5000)
                    })])}
                }
                const xHasP = latch()
                const yHasQ = latch()
                const caught: Record<string, unknown> = {}
                const deadlocking: Container = new Container()
                try {
                    await deadlocking.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                    await deadlocking.setNamed('ldap', LDAPServer, {
                        port: false,
                        schema: schema,
                        backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}],
                        access: {admins: [ADMIN]},
                        interceptors: [{name: 'deadlocking', operations: ['modify'], beforeCommit: async (_context: unknown, request: {dn?: {toString(): string}}): Promise<void> => {
                            const server: LDAPServer = await deadlocking.get<LDAPServer>('ldap')
                            const own: string | undefined = request.dn?.toString() === x ? 'x' : request.dn?.toString() === y ? 'y' : undefined
                            if (!own) return
                            const [first, second, mine, theirs] = own === 'x' ? [p, q, xHasP, yHasQ] : [q, p, yHasQ, xHasP]
                            await server.connect(ADMIN).modify(first, {operation: 'add', attribute: 'description', values: own})
                            mine.open()
                            await theirs.wait()
                            //The error of the write ended by the deadlock caught, or not: the write it is made in fails all the same
                            const writing: Promise<unknown> = server.connect(ADMIN).modify(second, {operation: 'add', attribute: 'description', values: own})
                            if (!catching) await writing
                            await writing.catch((error: unknown): void => {
                                caught[own] = error
                            })
                        }}]
                    })
                    const server: LDAPServer = await deadlocking.get<LDAPServer>('ldap')
                    const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
                        server.connect(ADMIN).modify(x, {operation: 'add', attribute: 'description', values: 'outer'}),
                        server.connect(ADMIN).modify(y, {operation: 'add', attribute: 'description', values: 'outer'})
                    ])
                    const refused: PromiseRejectedResult[] = results.filter((result: PromiseSettledResult<unknown>): result is PromiseRejectedResult => result.status === 'rejected')
                    assert.equal(refused.length, 1, JSON.stringify(results.map((result: PromiseSettledResult<unknown>): string => result.status)))
                    assert.ok(refused[0].reason instanceof LDAPUnavailableException && refused[0].reason.code === 51, String(refused[0].reason))
                    //Nothing of the write ended: neither its value nor the values of the writes made in it; all of the other
                    const lost: string = results[0].status === 'rejected' ? 'x' : 'y'
                    const kept: string = lost === 'x' ? 'y' : 'x'
                    const description = async (dn: string): Promise<string[]> => (await admin.search(dn, {scope: 'base'})).entries[0].get('description').sort()
                    assert.deepEqual(await description(lost === 'x' ? x : y), [])
                    assert.deepEqual(await description(kept === 'x' ? x : y), ['outer'])
                    assert.deepEqual(await description(p), [kept])
                    assert.deepEqual(await description(q), [kept])
                } finally {
                    await deadlocking.destroy()
                    for (const dn of [x, y, p, q]) await admin.delete(dn).catch((): undefined => undefined)
                }
            }
        })

        it('runs nothing more of a write a deadlock ended: its statements queued behind a write made in it, the reads of a write made in it queued behind its statements', {timeout: 60000, skip: label === 'SQLite' ? 'SQLite takes one write at a time' : false}, async () => {
            const names: string[] = ['queued-p', 'queued-q', 'queued-x', 'queued-y', 'queued-z', 'queued-r']
            const [p, q, x, y, z, r] = names.map((name: string): string => `cn=${name},${BASE}`)
            const [addedA, addedB] = [`cn=queued-a,${BASE}`, `cn=queued-b,${BASE}`]
            for (const [index, dn] of [p, q, x, y, z, r].entries()) await admin.add(dn, {objectClass: 'device', cn: names[index]})
            const latch = (timeout: number = 5000): {open: () => void, wait: () => Promise<void>} => {
                let open: () => void = (): void => undefined
                const opened: Promise<void> = new Promise<void>((resolve: () => void): void => {
                    open = resolve
                })
                return {open: (): void => open(), wait: (): Promise<void> => Promise.race([opened, new Promise<void>((resolve: () => void): void => {
                    setTimeout(resolve, timeout)
                })])}
            }
            //What the test does once the backend has queued an operation, by the operation and its DN
            const once: Map<string, () => void> = new Map()
            queueing = (operation: string, dn: string): void => {
                const action: (() => void) | undefined = once.get(`${operation} ${dn}`)
                once.delete(`${operation} ${dn}`)
                action?.()
            }
            const description = async (dn: string): Promise<string[]> => (await admin.search(dn, {scope: 'base'})).entries[0].get('description').sort()
            const present = (dn: string): Promise<boolean> => admin.search(dn, {scope: 'base'}).then((): boolean => true, (): boolean => false)
            const busy = (results: PromiseSettledResult<unknown>[]): number => {
                const refused: number[] = results.flatMap((result: PromiseSettledResult<unknown>, index: number): number[] => result.status === 'rejected' ? [index] : [])
                assert.equal(refused.length, 1, JSON.stringify(results.map((result: PromiseSettledResult<unknown>): string => result.status === 'rejected' ? String(result.reason) : result.status)))
                const reason: unknown = (results[refused[0]] as PromiseRejectedResult).reason
                assert.ok(reason instanceof LDAPUnavailableException && reason.code === 51, String(reason))
                return refused[0]
            }
            let holds = {a: latch(), b: latch()}
            const rQueued = latch()
            let rQueuedSeen: boolean = false
            const nested: Promise<unknown>[] = []
            const queuedContainer: Container = new Container()
            try {
                await queuedContainer.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await queuedContainer.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: QueueingBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN]},
                    interceptors: [{name: 'queueing', operations: ['add', 'modify'], beforeCommit: async (_context: unknown, request: {type: string, dn?: {toString(): string}, entry?: {dn: {toString(): string}}, changes?: {attribute: {values: unknown[]}}[]}): Promise<void> => {
                        //The writes of the test, not those made in them
                        if (request.type === 'modify' && String(request.changes?.[0]?.attribute.values[0]) !== 'outer') return
                        const server: LDAPServer = await queuedContainer.get<LDAPServer>('ldap')
                        const modify = (dn: string, ...values: string[]): Promise<unknown> => server.connect(ADMIN).modify(dn, {operation: 'add', attribute: 'description', values: values})
                        //A write made in the transaction, not waited for
                        const start = (dn: string, value: string): void => {
                            const writing: Promise<unknown> = modify(dn, value)
                            writing.catch((): undefined => undefined)
                            nested.push(writing)
                        }
                        const target: string = String(request.type === 'add' ? request.entry?.dn : request.dn)
                        if (target === addedA || target === addedB) {
                            //Each holds one entry, then writes the other's without waiting for it, and goes on once that write
                            //has queued its lock: its add is queued behind it
                            const [first, second, mine, theirs, value] = target === addedA ? [p, q, holds.a, holds.b, 'a'] : [q, p, holds.b, holds.a, 'b']
                            await modify(first, value)
                            mine.open()
                            await theirs.wait()
                            const queued = latch()
                            once.set(`lock ${second}`, queued.open)
                            start(second, value)
                            await queued.wait()
                        } else if (target === x) {
                            //Holds y; once its lock of x (which the other holds) is queued, writes r without waiting for it:
                            //the read of r the engine makes first is queued behind the lock
                            await modify(y, 'a')
                            holds.a.open()
                            await holds.b.wait()
                            once.set(`lock ${x}`, (): void => {
                                once.set(`get ${r}`, (): void => {
                                    rQueuedSeen = true
                                    rQueued.open()
                                })
                                start(r, 'a')
                            })
                        } else if (target === z) {
                            //Holds x, and writes more rows (the database ends the lighter transaction: the other), then
                            //writes y once r is queued
                            await modify(x, 'b')
                            await modify(z, ...Array.from({length: 20}, (_value: unknown, index: number): string => `b${index}`))
                            holds.b.open()
                            await holds.a.wait()
                            await rQueued.wait()
                            await modify(y, 'b')
                        }
                    }}]
                })
                const server: LDAPServer = await queuedContainer.get<LDAPServer>('ldap')
                //Its add queued behind a write made in it which the deadlock ends: nothing of it is left
                const adds: PromiseSettledResult<unknown>[] = await Promise.allSettled([addedA, addedB].map((dn: string): Promise<unknown> => server.connect(ADMIN).add(dn, {objectClass: 'device', cn: DN.parse(dn).rdn()!.attributes[0].value})))
                const lost: number = busy(adds)
                await Promise.allSettled(nested)
                assert.deepEqual([await present(addedA), await present(addedB)], [lost !== 0, lost !== 1])
                const kept: string = lost === 0 ? 'b' : 'a'
                assert.deepEqual([await description(p), await description(q)], [[kept], [kept]])
                //The read of a write made in it queued behind its lock, which the deadlock ends: nothing of that write
                //is left
                holds = {a: latch(), b: latch()}
                nested.length = 0
                const modifies: PromiseSettledResult<unknown>[] = await Promise.allSettled([x, z].map((dn: string): Promise<unknown> => server.connect(ADMIN).modify(dn, {operation: 'add', attribute: 'description', values: 'outer'})))
                const ended: number = busy(modifies)
                assert.ok(rQueuedSeen, 'the read of r was not queued before the deadlock')
                await Promise.allSettled(nested)
                if (ended === 0) {
                    assert.deepEqual([await description(x), await description(y), await description(r)], [['b'], ['b'], []])
                } else {
                    assert.deepEqual([await description(x), await description(y), await description(r)], [['outer'], ['a'], ['a']])
                }
            } finally {
                queueing = undefined
                await queuedContainer.destroy()
                for (const dn of [p, q, x, y, z, r, addedA, addedB]) await admin.delete(dn).catch((): undefined => undefined)
            }
        })

        it('runs a beforeCommit() writing the entry of the write, or adding below it, through another connection (refused on SQLite)', {timeout: 60000}, async () => {
            const target: string = `ou=through-other,${BASE}`
            await admin.add(target, {objectClass: 'organizationalUnit', ou: 'through-other'})
            //Another Database component on the same database (on SQLite, the same file)
            const otherContainer: Container = new Container()
            const outerContainer: Container = new Container()
            try {
                await otherContainer.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await otherContainer.setNamed('ldap', LDAPServer, {port: false, schema: schema, backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}], access: {admins: [ADMIN]}})
                const other: LDAPServer = await otherContainer.get<LDAPServer>('ldap')
                await outerContainer.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await outerContainer.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN]},
                    interceptors: [{name: 'through-other', operations: ['modify'], beforeCommit: async (_context: unknown, request: {dn?: {toString(): string}}): Promise<void> => {
                        if (request.dn?.toString() !== target) return
                        await other.connect(ADMIN).modify(target, {operation: 'add', attribute: 'description', values: 'by the other'})
                        await other.connect(ADMIN).add(`cn=child,${target}`, {objectClass: 'device', cn: 'child'})
                    }}]
                })
                const writing: Promise<unknown> = (await outerContainer.get<LDAPServer>('ldap')).connect(ADMIN).modify(target, {operation: 'add', attribute: 'description', values: 'outer'})
                if (label === 'SQLite') {
                    //The other connection would wait for the turn of the file this write holds
                    await assert.rejects(writing, LDAPUnwillingToPerformException)
                    return
                }
                await writing
                assert.deepEqual((await admin.search(target, {scope: 'base'})).entries[0].get('description').sort(), ['by the other', 'outer'])
                assert.equal((await admin.search(`cn=child,${target}`, {scope: 'base'})).entries.length, 1)
            } finally {
                await outerContainer.destroy()
                await otherContainer.destroy()
                await admin.delete(target, {controls: [TreeDeleteControl.encode()]}).catch((): undefined => undefined)
            }
        })

        it('runs the writes made in the transaction of a write it does not wait for, none of them alongside its statements', {timeout: 60000}, async () => {
            const outer: string = `cn=not-awaiting,${BASE}`
            const others: string[] = [`cn=unawaited1,${BASE}`, `cn=unawaited2,${BASE}`]
            for (const dn of [outer, ...others]) await admin.add(dn, {objectClass: 'device', cn: DN.parse(dn).rdn()!.attributes[0].value})
            const errors: unknown[] = []
            const notAwaiting: Container = new Container()
            try {
                await notAwaiting.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await notAwaiting.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN]},
                    interceptors: [{name: 'not-awaiting', operations: ['modify'], beforeCommit: async (_context: unknown, request: {dn?: {toString(): string}}): Promise<void> => {
                        if (request.dn?.toString() !== outer) return
                        const server: LDAPServer = await notAwaiting.get<LDAPServer>('ldap')
                        //Started, not waited for
                        for (const dn of others) void server.connect(ADMIN).modify(dn, {operation: 'add', attribute: 'description', values: 'unawaited'}).catch((error: unknown): void => {
                            errors.push(error)
                        })
                    }}]
                })
                const server: LDAPServer = await notAwaiting.get<LDAPServer>('ldap')
                server.engine.events.on('error', (error: unknown): void => {
                    errors.push(error)
                })
                await server.connect(ADMIN).modify(outer, {operation: 'add', attribute: 'description', values: 'outer'})
                //Each made in the transaction of the write (before its commit) or, reaching the backend once it is done,
                //in a transaction of its own; none of them on its connection alongside its statements
                const made = async (): Promise<boolean> => {
                    for (const dn of others) if (!(await admin.search(dn, {scope: 'base'})).entries[0].get('description').includes('unawaited')) return false
                    return true
                }
                for (let attempt: number = 0; attempt < 50 && !(await made()); attempt++) await new Promise((resolve) => setTimeout(resolve, 100))
                assert.ok(await made())
                assert.deepEqual((await admin.search(outer, {scope: 'base'})).entries[0].get('description'), ['outer'])
                assert.deepEqual(errors.map(String), [])
            } finally {
                await notAwaiting.destroy()
                for (const dn of [outer, ...others]) await admin.delete(dn).catch((): undefined => undefined)
            }
        })

        it('commits with a write the writes made in its transaction it does not wait for, once they reached the backend', {timeout: 60000}, async () => {
            const outer: string = `cn=reaching-outer,${BASE}`
            const others: string[] = [`cn=reaching1,${BASE}`, `cn=reaching2,${BASE}`]
            for (const dn of [outer, ...others]) await admin.add(dn, {objectClass: 'device', cn: DN.parse(dn).rdn()!.attributes[0].value})
            const errors: unknown[] = []
            const reachingContainer: Container = new Container()
            try {
                await reachingContainer.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await reachingContainer.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: ReachingBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN]},
                    interceptors: [{name: 'not-awaiting', operations: ['modify'], beforeCommit: async (_context: unknown, request: {dn?: {toString(): string}}): Promise<void> => {
                        if (request.dn?.toString() !== outer) return
                        const server: LDAPServer = await reachingContainer.get<LDAPServer>('ldap')
                        const reached: Set<string> = new Set()
                        const all: Promise<void> = new Promise<void>((resolve: () => void): void => {
                            reaching = (dn: string): void => {
                                reached.add(dn)
                                if (others.every((other: string): boolean => reached.has(other))) resolve()
                            }
                        })
                        //Started, not waited for; this write goes on once they are in its transaction
                        for (const dn of others) void server.connect(ADMIN).modify(dn, {operation: 'add', attribute: 'description', values: 'reached'}).catch((error: unknown): void => {
                            errors.push(error)
                        })
                        await Promise.race([all, new Promise<void>((resolve: () => void): void => {
                            setTimeout(resolve, 5000)
                        })])
                        reaching = undefined
                    }}]
                })
                const server: LDAPServer = await reachingContainer.get<LDAPServer>('ldap')
                server.engine.events.on('error', (error: unknown): void => {
                    errors.push(error)
                })
                await server.connect(ADMIN).modify(outer, {operation: 'add', attribute: 'description', values: 'outer'})
                //Committed with it: there once it is answered
                for (const dn of others) assert.deepEqual((await admin.search(dn, {scope: 'base'})).entries[0].get('description'), ['reached'])
                assert.deepEqual((await admin.search(outer, {scope: 'base'})).entries[0].get('description'), ['outer'])
                assert.deepEqual(errors.map(String), [])
            } finally {
                reaching = undefined
                await reachingContainer.destroy()
                for (const dn of [outer, ...others]) await admin.delete(dn).catch((): undefined => undefined)
            }
        })

        it('undoes with a write that fails the writes made in its transaction it did not wait for, and goes on', {timeout: 60000}, async () => {
            const outer: string = `cn=failing-outer,${BASE}`
            const others: string[] = [`cn=failing-nested1,${BASE}`, `cn=failing-nested2,${BASE}`]
            for (const dn of [outer, ...others]) await admin.add(dn, {objectClass: 'device', cn: DN.parse(dn).rdn()!.attributes[0].value})
            const nested: Promise<unknown>[] = []
            const failingContainer: Container = new Container()
            try {
                await failingContainer.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await failingContainer.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: ReachingBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN]},
                    interceptors: [{name: 'failing', operations: ['modify'], beforeCommit: async (_context: unknown, request: {dn?: {toString(): string}}): Promise<void> => {
                        if (request.dn?.toString() !== outer) return
                        const server: LDAPServer = await failingContainer.get<LDAPServer>('ldap')
                        const one: Promise<void> = new Promise<void>((resolve: () => void): void => {
                            reaching = (): void => resolve()
                        })
                        //Started, not waited for; the write fails once the first is in its transaction
                        for (const dn of others) {
                            const writing: Promise<unknown> = server.connect(ADMIN).modify(dn, {operation: 'add', attribute: 'description', values: 'nested'})
                            writing.catch((): undefined => undefined)
                            nested.push(writing)
                        }
                        await Promise.race([one, new Promise<void>((resolve: () => void): void => {
                            setTimeout(resolve, 5000)
                        })])
                        reaching = undefined
                        throw new Error('refused by the interceptor')
                    }}]
                })
                const server: LDAPServer = await failingContainer.get<LDAPServer>('ldap')
                await assert.rejects(server.connect(ADMIN).modify(outer, {operation: 'add', attribute: 'description', values: 'outer'}))
                //Each of them done or refused (those not started when it failed: unwillingToPerform); nothing of them, nor
                //of the write, left
                const settled: PromiseSettledResult<unknown>[] = await Promise.allSettled(nested)
                for (const result of settled) if (result.status === 'rejected') assert.ok(result.reason instanceof LDAPUnwillingToPerformException, String(result.reason))
                for (const dn of [outer, ...others]) assert.deepEqual((await admin.search(dn, {scope: 'base'})).entries[0].get('description'), [], dn)
                //The server goes on
                await server.connect(ADMIN).modify(others[0], {operation: 'add', attribute: 'description', values: 'after'})
                assert.deepEqual((await admin.search(others[0], {scope: 'base'})).entries[0].get('description'), ['after'])
            } finally {
                reaching = undefined
                await failingContainer.destroy()
                for (const dn of [outer, ...others]) await admin.delete(dn).catch((): undefined => undefined)
            }
        })

        it('runs the writes made in the transaction of another write, to its entry and to another one, and the writes they make', {timeout: 60000}, async () => {
            const target: string = `cn=nesting,${BASE}`
            const other: string = `cn=nested,${BASE}`
            const third: string = `cn=nested-twice,${BASE}`
            await admin.add(target, {objectClass: 'device', cn: 'nesting'})
            await admin.add(other, {objectClass: 'device', cn: 'nested'})
            await admin.add(third, {objectClass: 'device', cn: 'nested-twice'})
            const nesting: Container = new Container()
            try {
                await nesting.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await nesting.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN]},
                    interceptors: [{name: 'nesting', operations: ['modify'], beforeCommit: async (_context: unknown, request: {dn?: {toString(): string}}): Promise<void> => {
                        const server: LDAPServer = await nesting.get<LDAPServer>('ldap')
                        //A write made by the nested write: it does not wait behind the write it is made by
                        if (request.dn?.toString() === other) await server.connect(ADMIN).modify(third, {operation: 'add', attribute: 'description', values: 'nested twice'})
                        if (request.dn?.toString() !== target) return
                        //An operational attribute of the entry being modified, as a plugin keeps its state; a write to another entry
                        await server.engine.writeOperational(target, [{operation: 'replace', attribute: {type: 'modifyTimestamp', values: [Buffer.from('20260101000000Z')]}}])
                        await server.connect(ADMIN).modify(other, {operation: 'add', attribute: 'description', values: 'nested'})
                    }}]
                })
                //The state of an entry that is not there is not written, without an error (a bind answers the same)
                await (await nesting.get<LDAPServer>('ldap')).engine.writeOperational(`cn=missing,${BASE}`, [{operation: 'replace', attribute: {type: 'modifyTimestamp', values: [Buffer.from('20260101000000Z')]}}])
                await (await nesting.get<LDAPServer>('ldap')).connect(ADMIN).modify(target, {operation: 'add', attribute: 'description', values: 'outer'})
                assert.deepEqual((await admin.search(target, {scope: 'base'})).entries[0].get('description'), ['outer'])
                assert.deepEqual((await admin.search(other, {scope: 'base'})).entries[0].get('description'), ['nested'])
                assert.deepEqual((await admin.search(third, {scope: 'base'})).entries[0].get('description'), ['nested twice'])
            } finally {
                await nesting.destroy()
                await admin.delete(target)
                await admin.delete(other)
                await admin.delete(third)
            }
        })

        it('reads in a write made in the transaction of another what the writes made before it there wrote', {timeout: 60000}, async () => {
            const target: string = `cn=reading-outer,${BASE}`
            const unit: string = `ou=reading-unit,${BASE}`
            const child: string = `cn=reading-child,${unit}`
            const users: string[] = [1, 2].map((index: number): string => `uid=reading-user${index},${unit}`)
            await admin.add(target, {objectClass: 'device', cn: 'reading-outer'})
            const seen: Record<string, unknown> = {}
            const readingContainer: Container = new Container()
            try {
                await readingContainer.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await readingContainer.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN]},
                    interceptors: [{name: 'reading', operations: ['modify'], beforeCommit: async (_context: unknown, request: {dn?: {toString(): string}}): Promise<void> => {
                        const connection: LDAPInProcessConnection = (await readingContainer.get<LDAPServer>('ldap')).connect(ADMIN)
                        if (request.dn?.toString() === child) {
                            //Made by a write made in the transaction: it reads and writes there too
                            seen.parent = (await connection.search(unit, {scope: 'base'})).entries.length
                            await connection.modify(unit, {operation: 'add', attribute: 'description', values: 'by the child'})
                            return
                        }
                        if (request.dn?.toString() !== target) return
                        await connection.add(unit, {objectClass: 'organizationalUnit', ou: 'reading-unit'})
                        //Below the entry added before, which the engine checks is there; then modified, which it checks too
                        await connection.add(child, {objectClass: 'device', cn: 'reading-child'})
                        await connection.modify(child, {operation: 'add', attribute: 'description', values: 'nested'})
                        seen.child = (await connection.search(unit, {scope: 'one', filter: '(cn=reading-child)'})).entries.length
                        //Their numbers allocated from those of the entries added before
                        for (const [index, dn] of users.entries()) await connection.add(dn, {objectClass: ['inetOrgPerson', 'posixAccount'], uid: `reading-user${index + 1}`, cn: `Reading ${index + 1}`, sn: 'Reading', homeDirectory: `/home/reading-user${index + 1}`})
                        //Not a leaf: the entries added below it are seen
                        seen.leaf = await connection.delete(unit).then((): string => 'deleted', (error: unknown): unknown => error)
                    }}]
                })
                await (await readingContainer.get<LDAPServer>('ldap')).connect(ADMIN).modify(target, {operation: 'add', attribute: 'description', values: 'outer'})
                assert.deepEqual([seen.parent, seen.child], [1, 1])
                assert.ok(seen.leaf instanceof LDAPNotAllowedOnNonLeafException, String(seen.leaf))
                assert.deepEqual((await admin.search(unit, {scope: 'base'})).entries[0].get('description'), ['by the child'])
                assert.deepEqual((await admin.search(child, {scope: 'base'})).entries[0].get('description'), ['nested'])
                const numbers: string[] = (await admin.search(unit, {scope: 'one', filter: '(objectClass=posixAccount)'})).entries.map((entry) => entry.first('uidNumber')!)
                assert.equal(new Set(numbers).size, 2, JSON.stringify(numbers))
                assert.deepEqual((await admin.search(target, {scope: 'base'})).entries[0].get('description'), ['outer'])
            } finally {
                await readingContainer.destroy()
                await admin.delete(unit, {controls: [TreeDeleteControl.encode()]}).catch((): undefined => undefined)
                await admin.delete(target).catch((): undefined => undefined)
            }
        })

        it('reads a search made in a write whole: its pages read after the write, by a write made two levels down, or after the write it was made in', {timeout: 120000}, async () => {
            const unit: string = `ou=paging,${BASE}`
            const [outer, middle, inner] = ['paging-outer', 'paging-middle', 'paging-inner'].map((name: string): string => `cn=${name},${BASE}`)
            //More entries than a batch of the backend (200): the later pages need the entries read after the first
            const names: string[] = Array.from({length: 205}, (_value: unknown, index: number): string => `entry${String(index).padStart(3, '0')}`)
            await admin.add(unit, {objectClass: 'organizationalUnit', ou: 'paging'})
            for (const name of names) await admin.add(`cn=${name},${unit}`, {objectClass: 'device', cn: name})
            for (const dn of [outer, middle, inner]) await admin.add(dn, {objectClass: 'device', cn: DN.parse(dn).rdn()!.attributes[0].value})
            //A paged search started in a beforeCommit(), its first page read; the rest read later, by whoever has it
            let kept: {iterator: AsyncIterableIterator<Entry>, first: string} | undefined
            const rest = async (): Promise<string[]> => {
                const read: string[] = [kept!.first]
                for await (const entry of kept!.iterator) read.push(entry.first('cn')!)
                return read
            }
            const seen: Record<string, unknown> = {}
            const pagingContainer: Container = new Container()
            try {
                await pagingContainer.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await pagingContainer.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: DirectoryBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN]},
                    interceptors: [{name: 'continuing', operations: ['modify'], beforeCommit: async (_context: unknown, request: {dn?: {toString(): string}, changes?: {attribute: {values: unknown[]}}[]}): Promise<void> => {
                        const connection: LDAPInProcessConnection = (await pagingContainer.get<LDAPServer>('ldap')).connect(ADMIN)
                        const value: string = String(request.changes?.[0]?.attribute.values[0])
                        const dn: string = String(request.dn)
                        const start = async (sorted: boolean): Promise<void> => {
                            const iterator: AsyncIterableIterator<Entry> = connection.searchIterator(unit, {scope: 'one', attributes: ['cn'], paged: {pageSize: 50}, ...sorted ? {sort: [{attribute: 'cn'}]} : {}})
                            kept = {iterator: iterator, first: (await iterator.next()).value.first('cn')}
                        }
                        const modify = (target: string): Promise<unknown> => connection.modify(target, {operation: 'add', attribute: 'description', values: value})
                        if (dn === outer && value.startsWith('after')) await start(value === 'after sorted')
                        if (dn === outer && value.startsWith('deep')) {
                            await start(value === 'deep sorted')
                            await modify(middle)
                        }
                        //Two levels down: the write made in the one made in the outer write reads the rest
                        if (dn === middle && value.startsWith('deep')) await modify(inner)
                        if (dn === inner && value.startsWith('deep')) {
                            seen[value] = await Promise.race([rest(), new Promise<string>((resolve: (value: string) => void): void => {
                                setTimeout((): void => resolve('waited for itself'), 10000)
                            })])
                        }
                        //Started in the write made in the outer write, read by the outer write once that one is done: the
                        //entry added before in the transaction among them, with its values
                        if (dn === outer && value.startsWith('nested')) {
                            await connection.add(`cn=zz-${value.replace(' ', '-')},${unit}`, {objectClass: 'device', cn: `zz-${value.replace(' ', '-')}`})
                            await modify(middle)
                            seen[value] = await rest()
                        }
                        if (dn === middle && value.startsWith('nested')) await start(value === 'nested')
                    }}]
                })
                const server: LDAPServer = await pagingContainer.get<LDAPServer>('ldap')
                const write = (value: string): Promise<unknown> => server.connect(ADMIN).modify(outer, {operation: 'add', attribute: 'description', values: value})
                //Read once the write is done
                for (const sorted of [true, false]) {
                    await write(sorted ? 'after sorted' : 'after')
                    const read: string[] = await rest()
                    assert.equal(read.length, names.length)
                    if (sorted) assert.deepEqual(read, names)
                }
                //Read two levels down, without waiting for itself
                for (const value of ['deep sorted', 'deep']) {
                    await write(value)
                    assert.ok(Array.isArray(seen[value]), String(seen[value]))
                    assert.equal((seen[value] as string[]).length, names.length)
                }
                await write('nested')
                assert.deepEqual(seen.nested, [...names, 'zz-nested'])
                await write('nested unsorted')
                assert.deepEqual([...seen['nested unsorted'] as string[]].sort(), [...names, 'zz-nested', 'zz-nested-unsorted'])
            } finally {
                await pagingContainer.destroy()
                await admin.delete(unit, {controls: [TreeDeleteControl.encode()]}).catch((): undefined => undefined)
                for (const dn of [outer, middle, inner]) await admin.delete(dn).catch((): undefined => undefined)
            }
        })

        it('stops reading a search made in a write at its time limit, and an internal exact one past its size limit', {timeout: 120000}, async () => {
            const unit: string = `ou=limited,${BASE}`
            const outer: string = `cn=limited-outer,${BASE}`
            //More entries than a batch of the backend (200)
            await admin.add(unit, {objectClass: 'organizationalUnit', ou: 'limited'})
            for (let index: number = 0; index < 205; index++) await admin.add(`cn=limited${index},${unit}`, {objectClass: 'device', cn: `limited${index}`})
            await admin.add(outer, {objectClass: 'device', cn: 'limited-outer'})
            const seen: Record<string, unknown> = {}
            const now: () => number = Date.now
            //When asked, the access control hides the entries but the last
            let hiding: boolean = false
            const limitedContainer: Container = new Container()
            try {
                await limitedContainer.setNamed('database', Database, {options: {...databaseOptions, entities: directoryEntities(String(databaseOptions.type))}})
                await limitedContainer.setNamed('ldap', LDAPServer, {
                    port: false,
                    schema: schema,
                    backends: [{class: CountingBackend, suffix: BASE, database: 'database'}],
                    access: {admins: [ADMIN], check: (request: {operation: string, dn?: {toString(): string}}): boolean | undefined => hiding && request.operation === 'read' && /^cn=limited\d+,/.test(String(request.dn)) && !String(request.dn).startsWith('cn=limited204,') ? false : undefined},
                    interceptors: [{name: 'limited', operations: ['modify'], beforeCommit: async (_context: unknown, request: {dn?: {toString(): string}}): Promise<void> => {
                        if (String(request.dn) !== outer) return
                        const server: LDAPServer = await limitedContainer.get<LDAPServer>('ldap')
                        //A time limit of a second, the clock moving on by five at each batch read
                        let batches: number = 0
                        let offset: number = 0
                        Date.now = (): number => now() + offset
                        readingEntries = (): void => {
                            batches++
                            offset += 5000
                        }
                        try {
                            seen.time = await server.connect(ADMIN).search(unit, {scope: 'one', timeLimit: 1, paged: false}).then((result): number => result.entries.length, (error: unknown): number => (error as LDAPResultException).code)
                        } finally {
                            Date.now = now
                            readingEntries = undefined
                        }
                        seen.timeBatches = batches
                        //The entries read before the time limit all left out by the access control (the first read is
                        //cn=limited0, the siblings read in the order they were added): timeLimitExceeded all the same,
                        //not success without entries
                        offset = 0
                        hiding = true
                        Date.now = (): number => now() + offset
                        readingEntries = (): void => {
                            offset += 5000
                        }
                        try {
                            seen.hidden = await server.connect(ADMIN).search(unit, {scope: 'one', timeLimit: 1, paged: false}).then((result): number => result.entries.length, (error: unknown): number => (error as LDAPResultException).code)
                        } finally {
                            Date.now = now
                            readingEntries = undefined
                            hiding = false
                        }
                        //Paged, cut once more entries were read than its first page gives (the clock past the time limit
                        //at the second batch): timeLimitExceeded, no cookie to page on with
                        offset = 0
                        let read: number = 0
                        Date.now = (): number => now() + offset
                        readingEntries = (): void => {
                            if (++read >= 2) offset += 5000
                        }
                        try {
                            seen.paged = await server.connect(ADMIN).search(unit, {scope: 'one', timeLimit: 1, paged: false, controls: [PagedResultsControl.encode({size: 50, cookie: Buffer.alloc(0)})]}).then((): string => 'answered', (error: unknown): [number, number] => {
                                const control = findControl((error as LDAPResultException).controls, PagedResultsControl)
                                return [(error as LDAPResultException).code, control ? PagedResultsControl.decode(control).cookie.length : 0]
                            })
                        } finally {
                            Date.now = now
                            readingEntries = undefined
                        }
                        //An internal search of an exact filter, one entry asked for
                        batches = 0
                        readingEntries = (): void => {
                            batches++
                        }
                        try {
                            const result = await server.engine.connect({internal: true}).search(unit, {scope: 'one', filter: '(objectClass=*)', sizeLimit: 1, paged: false})
                            seen.size = [result.entries.length, result.truncated]
                        } finally {
                            readingEntries = undefined
                        }
                        seen.sizeBatches = batches
                    }}]
                })
                await (await limitedContainer.get<LDAPServer>('ldap')).connect(ADMIN).modify(outer, {operation: 'add', attribute: 'description', values: 'limited'})
                //timeLimitExceeded, the batch after the time limit not read
                assert.deepEqual([seen.time, seen.timeBatches], [3, 1])
                assert.equal(seen.hidden, 3)
                assert.deepEqual(seen.paged, [3, 0])
                assert.deepEqual([seen.size, seen.sizeBatches], [[1, true], 1])
            } finally {
                Date.now = now
                readingEntries = undefined
                await limitedContainer.destroy()
                await admin.delete(unit, {controls: [TreeDeleteControl.encode()]}).catch((): undefined => undefined)
                await admin.delete(outer).catch((): undefined => undefined)
            }
        })
    })
}

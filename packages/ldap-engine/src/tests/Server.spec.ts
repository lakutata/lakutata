import assert from 'node:assert/strict'
import {before, describe, it} from 'node:test'
import {
    createDirectory,
    createHandlerBackend,
    createLDAPServer,
    type DirectoryEntry,
    Filter,
    findControl,
    GroupPresentationPlugin,
    LDAPAttributeOrValueExistsException,
    LDAPConstraintViolationException,
    LDAPEntryAlreadyExistsException,
    type LDAPInProcessConnection,
    LDAPInsufficientAccessException,
    type LDAPInterceptor,
    LDAPInvalidCredentialsException,
    LDAPNoSuchAttributeException,
    LDAPNoSuchObjectException,
    LDAPNotAllowedOnNonLeafException,
    LDAPObjectClassViolationException,
    LDAPResultException,
    type LDAPServerEngine,
    LDAPUnavailableCriticalExtensionException,
    LDAPUnwillingToPerformException,
    MemoryBackend,
    PagedResultsControl,
    readSchema,
    type Schema,
    SortRequestControl,
    SortResponseControl,
    TreeDeleteControl,
    type WriteContext
} from '../exports/LDAPEngine.js'
import {
    DEFAULTS,
    RFC2307BIS
} from '../exports/Schemas.js'

const BASE: string = 'dc=example,dc=com'
const ADMIN: string = 'cn=admin,dc=example,dc=com'

/**
 * Whether an error is a result exception with a code
 * @param code The code.
 */
function code(code: number): (error: unknown) => boolean {
    return (error: unknown): boolean => error instanceof LDAPResultException && error.code === code
}

/**
 * A server with a directory of people and groups
 */
async function directory(options: Partial<Parameters<typeof createLDAPServer>[0]> = {}): Promise<{server: LDAPServerEngine, backend: MemoryBackend, admin: LDAPInProcessConnection}> {
    const backend: MemoryBackend = new MemoryBackend(BASE)
    const server: LDAPServerEngine = createLDAPServer({backends: [backend], access: {admins: [ADMIN]}, passwords: {iterations: 1000}, bindThrottle: {delay: 0}, ...options})
    const admin: LDAPInProcessConnection = server.connect({as: ADMIN})
    await admin.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
    await admin.add(`ou=people,${BASE}`, {objectClass: 'organizationalUnit', ou: 'people'})
    await admin.add(`ou=groups,${BASE}`, {objectClass: 'organizationalUnit', ou: 'groups'})
    for (let index: number = 0; index < 30; index++) {
        await admin.add(`uid=user${index},ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: `user${index}`, cn: `User ${String(index).padStart(2, '0')}`, sn: `Surname${index % 3}`, mail: `user${index}@example.com`, userPassword: `password${index}`, employeeNumber: String(100 - index)})
    }
    await admin.add(`cn=developers,ou=groups,${BASE}`, {objectClass: 'groupOfNames', cn: 'developers', member: [`uid=user1,ou=people,${BASE}`, `uid=user2,ou=people,${BASE}`]})
    return {server, backend, admin}
}

describe('the server engine', () => {
    let server: LDAPServerEngine
    let backend: MemoryBackend
    let admin: LDAPInProcessConnection

    before(async () => {
        ({server, backend, admin} = await directory())
    })

    it('adds entries checked against the schema, their passwords hashed and their operational attributes written', async () => {
        const stored: DirectoryEntry = backend.entries().find((entry) => entry.dn.toString() === `uid=user0,ou=people,${BASE}`)!
        const password: string = stored.attributes.find((attribute) => attribute.type === 'userPassword')!.values[0].toString()
        assert.match(password, /^\{PBKDF2-SHA512\}1000\$/)
        const classes: string[] = stored.attributes.find((attribute) => attribute.type === 'objectClass')!.values.map((value) => value.toString())
        assert.deepEqual(classes.sort(), ['inetOrgPerson', 'organizationalPerson', 'person', 'top'])
        const {entries} = await admin.search(`uid=user0,ou=people,${BASE}`, {scope: 'base', attributes: ['+']})
        const entry = entries[0]
        assert.match(entry.first('createTimestamp')!, /^\d{14}Z$/)
        assert.equal(entry.first('creatorsName'), ADMIN)
        assert.match(entry.first('entryUUID')!, /^[0-9a-f-]{36}$/)
        assert.equal(entry.first('entryDN'), `uid=user0,ou=people,${BASE}`)
        assert.equal(entry.first('structuralObjectClass'), 'inetOrgPerson')
        assert.equal(entry.first('subschemaSubentry'), 'cn=Subschema')
        assert.equal(entry.first('hasSubordinates'), 'FALSE')
        assert.equal(entry.has('cn'), false)
    })

    it('adds the entries of a structural class defined without a superclass, top added to their object classes', async () => {
        const schema: string = 'attributetype ( 1.2.3.1 NAME \'deviceId\' EQUALITY caseExactMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )\nobjectclass ( 1.2.3.2 NAME \'appDevice\' STRUCTURAL MUST deviceId )'
        const {admin: owner} = await directory({schema: [...DEFAULTS, {name: 'app', text: schema}]})
        await owner.add(`deviceId=d1,${BASE}`, {objectClass: 'appDevice', deviceId: 'd1'})
        const {entries} = await owner.search(`deviceId=d1,${BASE}`, {scope: 'base'})
        assert.deepEqual(entries[0].get('objectClass').sort(), ['appDevice', 'top'])
    })

    it('gives entryUUIDs of version 7, in the order the entries were added', async () => {
        const {entries} = await admin.search(`ou=people,${BASE}`, {scope: 'one', attributes: ['entryUUID', 'uid'], paged: false})
        const byUid: Map<string, string> = new Map(entries.map((entry) => [entry.first('uid')!, entry.first('entryUUID')!]))
        const uuids: string[] = Array.from({length: 30}, (_, index) => byUid.get(`user${index}`)!)
        for (const uuid of uuids) assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        assert.deepEqual([...uuids].sort(), uuids)
    })

    it('refuses what the schema does not allow, with its result code', async () => {
        const dn: string = `uid=bad,ou=people,${BASE}`
        await assert.rejects(admin.add(dn, {objectClass: 'inetOrgPerson', uid: 'bad', cn: 'Bad'}), (error: unknown) => error instanceof LDAPObjectClassViolationException && /sn/.test(error.message))
        await assert.rejects(admin.add(dn, {objectClass: 'inetOrgPerson', uid: 'bad', cn: 'Bad', sn: 'B', shoeSize: '42'}), code(17))
        await assert.rejects(admin.add(dn, {objectClass: ['inetOrgPerson', 'spaceship'], uid: 'bad', cn: 'Bad', sn: 'B'}), LDAPObjectClassViolationException)
        await assert.rejects(admin.add(dn, {objectClass: 'person', uid: 'bad', cn: 'Bad', sn: 'B'}), LDAPObjectClassViolationException)
        await assert.rejects(admin.add(dn, {objectClass: 'inetOrgPerson', uid: 'bad', cn: 'Bad', sn: 'B', displayName: ['one', 'two']}), LDAPConstraintViolationException)
        await assert.rejects(admin.add(dn, {objectClass: 'inetOrgPerson', uid: 'bad', cn: ['Bad', 'BAD'], sn: 'B'}), LDAPAttributeOrValueExistsException)
        await assert.rejects(admin.add(dn, {objectClass: 'inetOrgPerson', uid: 'other', cn: 'Bad', sn: 'B'}), code(64))
        await assert.rejects(admin.add(dn, {objectClass: ['organizationalUnit', 'inetOrgPerson'], uid: 'bad', cn: 'Bad', sn: 'B', ou: 'x'}), LDAPObjectClassViolationException)
        await assert.rejects(admin.add(`uid=user1,ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: 'user1', cn: 'x', sn: 'x'}), LDAPEntryAlreadyExistsException)
        await assert.rejects(admin.add(`uid=x,ou=nowhere,${BASE}`, {objectClass: 'inetOrgPerson', uid: 'x', cn: 'x', sn: 'x'}), (error: unknown) => error instanceof LDAPNoSuchObjectException && error.matchedDN === BASE)
        await assert.rejects(admin.add('dc=other,dc=com', {objectClass: 'dcObject', dc: 'other'}), LDAPNoSuchObjectException)
        await assert.rejects(admin.add('not a dn', {objectClass: 'top'}), code(34))
    })

    it('searches by the matching rules of the schema, in every scope, with the attributes asked for', async () => {
        assert.equal((await admin.search(BASE, {filter: '(&(objectClass=person)(mail=USER1@EXAMPLE.COM))'})).entries.length, 1)
        assert.equal((await admin.search(BASE, {filter: '(cn=user 1*)'})).entries.length, 10)
        assert.equal((await admin.search(BASE, {filter: '(createTimestamp>=20000101000000Z)'})).entries.length, 34)
        //cn has no ordering rule (RFC 4519): the item is Undefined
        assert.equal((await admin.search(BASE, {filter: '(cn>=user 25)'})).entries.length, 0)
        assert.equal((await admin.search(`ou=people,${BASE}`, {scope: 'one'})).entries.length, 30)
        assert.equal((await admin.search(BASE, {scope: 'one'})).entries.length, 2)
        assert.equal((await admin.search(BASE, {scope: 'children', filter: '(objectClass=organizationalUnit)'})).entries.length, 2)
        assert.equal((await admin.search(BASE, {filter: '(commonName=User 05)'})).entries[0].dn, `uid=user5,ou=people,${BASE}`)
        const named = (await admin.search(`uid=user3,ou=people,${BASE}`, {scope: 'base', attributes: ['name', 'MAIL']})).entries[0]
        assert.deepEqual(named.names().sort(), ['cn', 'mail', 'sn'])
        const none = (await admin.search(`uid=user3,ou=people,${BASE}`, {scope: 'base', attributes: ['1.1']})).entries[0]
        assert.deepEqual(none.names(), [])
        const types = (await admin.search(`uid=user3,ou=people,${BASE}`, {scope: 'base', typesOnly: true})).entries[0]
        assert.deepEqual(types.get('cn'), [])
        assert.equal((await admin.search(BASE, {filter: '(&)'})).entries.length, 34)
        assert.equal((await admin.search(BASE, {filter: '(|)'})).entries.length, 0)
        await assert.rejects(admin.search(`ou=nowhere,${BASE}`), (error: unknown) => error instanceof LDAPNoSuchObjectException && error.matchedDN === BASE)
    })

    it('never gives userPassword, nor finds entries by it', async () => {
        const all = (await admin.search(`uid=user4,ou=people,${BASE}`, {scope: 'base', attributes: ['*', 'userPassword']})).entries[0]
        assert.equal(all.has('userPassword'), false)
        assert.equal((await admin.search(BASE, {filter: '(userPassword=*)'})).entries.length, 0)
        assert.equal((await admin.search(BASE, {filter: '(!(userPassword=*))'})).entries.length, 0)
        await assert.rejects(admin.compare(`uid=user4,ou=people,${BASE}`, 'userPassword', 'password4'), LDAPInsufficientAccessException)
    })

    it('modifies entries: values added, deleted, replaced, incremented, the RDN kept', async () => {
        const dn: string = `uid=user5,ou=people,${BASE}`
        await admin.modify(dn, [{operation: 'add', attribute: 'mail', values: 'second@example.com'}, {operation: 'replace', attribute: 'description', values: ['a', 'b']}])
        await assert.rejects(admin.modify(dn, {operation: 'add', attribute: 'mail', values: 'SECOND@example.com'}), LDAPAttributeOrValueExistsException)
        await assert.rejects(admin.modify(dn, {operation: 'delete', attribute: 'mail', values: 'nobody@example.com'}), LDAPNoSuchAttributeException)
        await assert.rejects(admin.modify(dn, {operation: 'delete', attribute: 'uid'}), code(67))
        await assert.rejects(admin.modify(dn, {operation: 'delete', attribute: 'sn'}), LDAPObjectClassViolationException)
        await assert.rejects(admin.modify(dn, {operation: 'replace', attribute: 'objectClass', values: ['organizationalUnit']}), LDAPResultException)
        await admin.modify(dn, [{operation: 'delete', attribute: 'mail', values: 'Second@Example.com'}, {operation: 'increment' as never, attribute: 'employeeNumber', values: '5'}])
        const entry = (await admin.search(dn, {scope: 'base', attributes: ['*', 'modifiersName', 'modifyTimestamp']})).entries[0]
        assert.deepEqual(entry.get('mail'), ['user5@example.com'])
        assert.deepEqual(entry.get('employeeNumber'), ['100'])
        assert.deepEqual(entry.get('description').sort(), ['a', 'b'])
        assert.equal(entry.first('modifiersName'), ADMIN)
        await assert.rejects(admin.modify(`uid=nobody,${BASE}`, {operation: 'replace', attribute: 'mail', values: 'x'}), LDAPNoSuchObjectException)
    })

    it('renames and moves entries, the entries below them following', async () => {
        await admin.add(`ou=temp,${BASE}`, {objectClass: 'organizationalUnit', ou: 'temp'})
        await admin.add(`ou=inner,ou=temp,${BASE}`, {objectClass: 'organizationalUnit', ou: 'inner'})
        await admin.add(`cn=leaf,ou=inner,ou=temp,${BASE}`, {objectClass: 'device', cn: 'leaf'})
        await admin.modifyDN(`ou=temp,${BASE}`, 'ou=moved', {deleteOldRDN: true})
        assert.equal((await admin.search(`cn=leaf,ou=inner,ou=moved,${BASE}`, {scope: 'base'})).entries.length, 1)
        const moved = (await admin.search(`ou=moved,${BASE}`, {scope: 'base'})).entries[0]
        assert.deepEqual(moved.get('ou'), ['moved'])
        await admin.modifyDN(`ou=inner,ou=moved,${BASE}`, 'ou=inner', {newSuperior: `ou=groups,${BASE}`})
        assert.equal((await admin.search(`cn=leaf,ou=inner,ou=groups,${BASE}`, {scope: 'base'})).entries.length, 1)
        await assert.rejects(admin.modifyDN(`ou=moved,${BASE}`, 'ou=people'), LDAPEntryAlreadyExistsException)
        await assert.rejects(admin.modifyDN(`ou=moved,${BASE}`, 'ou=x', {newSuperior: `ou=nowhere,${BASE}`}), LDAPNoSuchObjectException)
        await assert.rejects(admin.modifyDN(`ou=groups,${BASE}`, 'ou=x', {newSuperior: `ou=inner,ou=groups,${BASE}`}), LDAPUnwillingToPerformException)
        await admin.modifyDN(`ou=moved,${BASE}`, 'ou=kept', {deleteOldRDN: false})
        assert.deepEqual((await admin.search(`ou=kept,${BASE}`, {scope: 'base'})).entries[0].get('ou').sort(), ['kept', 'moved'])
        await assert.rejects(admin.delete(`ou=groups,${BASE}`), LDAPNotAllowedOnNonLeafException)
        await admin.delete(`ou=inner,ou=groups,${BASE}`, {controls: [TreeDeleteControl.encode()]})
        await admin.delete(`ou=kept,${BASE}`)
        assert.equal((await admin.search(BASE, {filter: '(cn=leaf)'})).entries.length, 0)
    })

    it('compares by the equality rule, subtypes included', async () => {
        const dn: string = `uid=user6,ou=people,${BASE}`
        assert.equal(await admin.compare(dn, 'cn', 'user 06'), true)
        assert.equal(await admin.compare(dn, 'name', 'USER 06'), true)
        assert.equal(await admin.compare(dn, 'cn', 'someone'), false)
        await assert.rejects(admin.compare(dn, 'description', 'x'), LDAPNoSuchAttributeException)
        await assert.rejects(admin.compare(dn, 'shoeSize', 'x'), code(17))
    })

    it('controls who reads and writes: anonymous, users, administrators', async () => {
        const anonymous: LDAPInProcessConnection = server.connect()
        await assert.rejects(anonymous.search(BASE), LDAPInsufficientAccessException)
        assert.deepEqual((await anonymous.search('', {scope: 'base', attributes: ['namingContexts']})).entries[0].get('namingContexts'), [BASE])
        await anonymous.bind(`uid=user7,ou=people,${BASE}`, 'password7')
        assert.equal(await anonymous.whoAmI(), `dn:uid=user7,ou=people,${BASE}`)
        assert.equal((await anonymous.search(BASE, {filter: '(uid=user8)'})).entries.length, 1)
        await assert.rejects(anonymous.add(`uid=new,ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: 'new', cn: 'n', sn: 'n'}), LDAPInsufficientAccessException)
        await assert.rejects(anonymous.modify(`uid=user7,ou=people,${BASE}`, {operation: 'replace', attribute: 'mail', values: 'x@example.com'}), LDAPInsufficientAccessException)
        await assert.rejects(anonymous.bind(`uid=user7,ou=people,${BASE}`, 'wrong'), LDAPInvalidCredentialsException)
        assert.equal(await anonymous.whoAmI(), '')
        await assert.rejects(anonymous.bind(`uid=nobody,ou=people,${BASE}`, 'x'), LDAPInvalidCredentialsException)
        await assert.rejects(anonymous.bind(`uid=user7,ou=people,${BASE}`, '', {allowUnauthenticated: true}), LDAPUnwillingToPerformException)
    })

    it('changes passwords: one\'s own, another\'s by an administrator, one generated', async () => {
        const user: LDAPInProcessConnection = server.connect()
        await user.bind(`uid=user9,ou=people,${BASE}`, 'password9')
        await user.passwordModify({oldPassword: 'password9', newPassword: 'changed9'})
        await assert.rejects(user.passwordModify({oldPassword: 'wrong', newPassword: 'x'}), LDAPInvalidCredentialsException)
        await assert.rejects(user.passwordModify({userIdentity: `uid=user10,ou=people,${BASE}`, newPassword: 'x'}), LDAPInsufficientAccessException)
        await user.modify(`uid=user9,ou=people,${BASE}`, [{operation: 'delete', attribute: 'userPassword', values: 'changed9'}, {operation: 'add', attribute: 'userPassword', values: 'again9'}])
        const check: LDAPInProcessConnection = server.connect()
        await check.bind(`uid=user9,ou=people,${BASE}`, 'again9')
        const generated: string | undefined = await admin.passwordModify({userIdentity: `uid=user10,ou=people,${BASE}`})
        assert.ok(generated && generated.length >= 12)
        await check.bind(`uid=user10,ou=people,${BASE}`, generated)
        await assert.rejects(server.connect().passwordModify({newPassword: 'x'}), LDAPUnwillingToPerformException)
    })

    it('hashes a password again after a bind with a weaker one, and keeps the hashes an administrator imports', async () => {
        const dn: string = `uid=imported,ou=people,${BASE}`
        await admin.add(dn, {objectClass: 'inetOrgPerson', uid: 'imported', cn: 'Imported', sn: 'I', userPassword: '{SSHA}0H+zTv8o4MR4H43n03eCsvw1luG8LdB7'})
        const before = backend.entries().find((entry) => entry.dn.toString() === dn)!.attributes.find((attribute) => attribute.type === 'userPassword')!.values[0].toString()
        assert.equal(before, '{SSHA}0H+zTv8o4MR4H43n03eCsvw1luG8LdB7')
        await server.connect().bind(dn, 'secret')
        const after = backend.entries().find((entry) => entry.dn.toString() === dn)!.attributes.find((attribute) => attribute.type === 'userPassword')!.values[0].toString()
        assert.match(after, /^\{PBKDF2-SHA512\}1000\$/)
        await server.connect().bind(dn, 'secret')
    })

    it('pages, sorts and windows the entries itself', async () => {
        const users: string = '(uid=user*)'
        const {entries} = await admin.search(`ou=people,${BASE}`, {scope: 'one', filter: users, paged: {pageSize: 7}})
        assert.equal(entries.length, 30)
        const sorted = await admin.search(`ou=people,${BASE}`, {scope: 'one', filter: users, sort: [{attribute: 'cn'}], paged: false})
        assert.deepEqual(sorted.entries.slice(0, 3).map((entry) => entry.first('cn')), ['User 00', 'User 01', 'User 02'])
        assert.equal(SortResponseControl.decode(findControl(sorted.controls, SortResponseControl)!).result, 0)
        const unsorted = await admin.search(`ou=people,${BASE}`, {scope: 'one', filter: users, sort: [{attribute: 'jpegPhoto'}], paged: false})
        assert.equal(unsorted.entries.length, 30)
        assert.deepEqual(SortResponseControl.decode(findControl(unsorted.controls, SortResponseControl)!), {result: 18, attribute: 'jpegPhoto'})
        await assert.rejects(admin.search(`ou=people,${BASE}`, {scope: 'one', paged: false, controls: [{...SortRequestControl.encode([{attribute: 'jpegPhoto'}]), critical: true}]}), LDAPUnavailableCriticalExtensionException)
        const reverse = await admin.search(`ou=people,${BASE}`, {scope: 'one', filter: users, sort: [{attribute: 'sn', reverse: true}, {attribute: 'cn'}], paged: false})
        assert.deepEqual(reverse.entries.slice(0, 2).map((entry) => entry.first('cn')), ['User 02', 'User 05'])
        const window = await admin.search(`ou=people,${BASE}`, {scope: 'one', filter: users, sort: [{attribute: 'cn'}], window: {offset: 11, limit: 5}})
        assert.deepEqual(window.entries.map((entry) => entry.first('cn')), ['User 10', 'User 11', 'User 12', 'User 13', 'User 14'])
        assert.equal(window.total, 30)
        const names: string[] = []
        for await (const entry of admin.searchIterator(`ou=people,${BASE}`, {scope: 'one', paged: {pageSize: 4}})) {
            names.push(entry.dn)
            if (names.length === 6) break
        }
        assert.equal(names.length, 6)
    })

    it('limits the searches of users, not of administrators', async () => {
        const small = await directory({limits: {sizeLimit: 10}})
        const user: LDAPInProcessConnection = small.server.connect()
        await user.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        await assert.rejects(user.search(`ou=people,${BASE}`, {paged: false}), code(4))
        //The pages of a paged search count together
        await assert.rejects(user.search(`ou=people,${BASE}`, {paged: {pageSize: 4}}), code(4))
        const paging = await directory({limits: {sizeLimit: 10, pagedSizeLimit: 0}})
        const pager: LDAPInProcessConnection = paging.server.connect()
        await pager.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        assert.equal((await pager.search(`ou=people,${BASE}`, {paged: {pageSize: 4}})).entries.length, 31)
        assert.equal((await pager.search(`ou=people,${BASE}`, {paged: {pageSize: 20}})).entries.length, 31)
        assert.equal((await small.admin.search(`ou=people,${BASE}`, {paged: false})).entries.length, 31)
        const filter = Filter.or(...Array.from({length: 1001}, (_, index) => Filter.equal('uid', `user${index}`)))
        await assert.rejects(user.search(BASE, {filter: filter, paged: {pageSize: 10}}), LDAPUnwillingToPerformException)
        assert.equal((await small.admin.search(`ou=people,${BASE}`, {filter: filter, paged: false})).entries.length, 30)
    })

    it('counts the entries of all the pages of a paged search in its size limit, as they are sent', async () => {
        //The pages of a search, asked for with the control itself (not the client's paging, which counts on its own)
        const pages = async (connection: LDAPInProcessConnection, size: number, sizeLimit: number = 0): Promise<{counts: number[], exceeded: boolean}> => {
            const counts: number[] = []
            let cookie: Buffer = Buffer.alloc(0)
            for (;;) {
                const controls = [PagedResultsControl.encode({size: size, cookie: cookie})]
                let entries: number
                let responseControls
                let exceeded: boolean
                try {
                    const result = await connection.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user*)', paged: false, controls: controls, ...sizeLimit ? {sizeLimit: sizeLimit} : {}})
                    entries = result.entries.length
                    responseControls = result.controls
                    exceeded = result.truncated === true
                } catch (error) {
                    if (!code(4)(error)) throw error
                    entries = ((error as {partial?: unknown[]}).partial ?? []).length
                    responseControls = (error as LDAPResultException).controls
                    exceeded = true
                }
                counts.push(entries)
                cookie = PagedResultsControl.decode(findControl(responseControls, PagedResultsControl)!).cookie
                if (!cookie.length) return {counts: counts, exceeded: exceeded}
                assert.equal(exceeded, false, 'a page answered sizeLimitExceeded gives no cookie')
            }
        }
        const {server: limited, admin: owner} = await directory({limits: {sizeLimit: 10}})
        //The size limit of the search: within a page, at the end of one, the search ending with its entries
        assert.deepEqual(await pages(owner, 10, 15), {counts: [10, 5], exceeded: true})
        assert.deepEqual(await pages(owner, 10, 20), {counts: [10, 10], exceeded: true})
        assert.deepEqual(await pages(owner, 10, 30), {counts: [10, 10, 10], exceeded: false})
        //A page as large as the size limit: one page
        assert.deepEqual(await pages(owner, 10, 5), {counts: [5], exceeded: true})
        assert.deepEqual(await pages(owner, 7), {counts: [7, 7, 7, 7, 2], exceeded: false})
        //The size limit of the server for a user, across the pages
        const user: LDAPInProcessConnection = limited.connect()
        await user.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        assert.deepEqual(await pages(user, 4), {counts: [4, 4, 2], exceeded: true})
        assert.deepEqual(await pages(user, 20), {counts: [10], exceeded: true})
        //pagedSizeLimit apart from sizeLimit
        const {server: wider} = await directory({limits: {sizeLimit: 10, pagedSizeLimit: 25}})
        const other: LDAPInProcessConnection = wider.connect()
        await other.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        assert.deepEqual(await pages(other, 10), {counts: [10, 10, 5], exceeded: true})
        //The entries the access control leaves out are not counted
        const {server: hiding} = await directory({access: {admins: [ADMIN], check: (request: {operation: string, dn?: {toString(): string}}): boolean | undefined => request.operation === 'read' && /^uid=user\d*[02468],/i.test(String(request.dn)) ? false : undefined}})
        const reader: LDAPInProcessConnection = hiding.connect()
        await reader.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        const seen: {counts: number[], exceeded: boolean} = await pages(reader, 4, 10)
        assert.equal(seen.counts.reduce((sum: number, count: number): number => sum + count, 0), 10)
        assert.equal(seen.exceeded, true)
        //The client's own paging still tells it was cut
        const cut = await owner.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user*)', sizeLimit: 15, paged: {pageSize: 10}})
        assert.deepEqual([cut.entries.length, cut.truncated], [15, true])
    })

    it('sorts strings by their code points, a character above U+FFFF after U+FA0E', async () => {
        const {admin: owner} = await directory()
        await owner.add(`cn=astral,${BASE}`, {objectClass: 'device', cn: 'astral', description: '\u{20000}'})
        await owner.add(`cn=bmp,${BASE}`, {objectClass: 'device', cn: 'bmp', description: '\uFA0E'})
        const {entries} = await owner.search(BASE, {scope: 'one', filter: '(objectClass=device)', sort: [{attribute: 'description'}], paged: false})
        assert.deepEqual(entries.map((entry) => entry.first('cn')), ['bmp', 'astral'])
    })

    it('fails a window it cannot sort rather than giving every entry', async () => {
        const small = await directory({limits: {sortCandidates: 10}})
        await assert.rejects(small.admin.search(`ou=people,${BASE}`, {scope: 'one', sort: [{attribute: 'cn'}], window: {offset: 1, limit: 5}}), LDAPUnavailableCriticalExtensionException)
        const unsorted = await small.admin.search(`ou=people,${BASE}`, {scope: 'one', sort: [{attribute: 'cn'}], paged: false})
        assert.equal(unsorted.entries.length, 30)
        assert.equal(SortResponseControl.decode(findControl(unsorted.controls, SortResponseControl)!).result, 11)
    })

    it('refuses a critical control it does not know', async () => {
        await assert.rejects(admin.search(BASE, {controls: [{oid: '1.2.3.4.5', critical: true}]}), LDAPUnavailableCriticalExtensionException)
        assert.ok((await admin.search(BASE, {scope: 'base', controls: [{oid: '1.2.3.4.5', critical: false}]})).entries.length)
    })

    it('publishes its root DSE and its schema', async () => {
        const root = (await admin.search('', {scope: 'base', attributes: ['+']})).entries[0]
        assert.ok(root.get('supportedControl').includes('1.2.840.113556.1.4.319'))
        //The control of the password policy comes with the policy
        assert.ok(!root.get('supportedControl').includes('1.3.6.1.4.1.42.2.27.8.5.1'))
        assert.deepEqual(root.get('supportedExtension').sort(), ['1.3.6.1.4.1.4203.1.11.1', '1.3.6.1.4.1.4203.1.11.3'])
        assert.deepEqual(root.get('supportedLDAPVersion'), ['3'])
        assert.equal(root.first('subschemaSubentry'), 'cn=Subschema')
        const schema: Schema = await readSchema(admin)
        assert.ok(schema.objectClass('inetOrgPerson'))
        assert.equal(schema.equality('mail')?.names[0], 'caseIgnoreIA5Match')
    })

    it('keeps its own copies of the values given by the application', async () => {
        const value: Buffer = Buffer.from('original')
        await admin.add(`cn=copied,${BASE}`, {objectClass: 'device', cn: 'copied', description: value})
        value.write('mutated!')
        assert.equal((await admin.search(`cn=copied,${BASE}`, {scope: 'base'})).entries[0].first('description'), 'original')
    })

    it('runs the interceptors of the application where they are placed', async () => {
        const calls: string[] = []
        const stamp: LDAPInterceptor = {
            name: 'stamp',
            operations: ['add', 'search'],
            before: (context, request) => {
                if (request.type === 'add' && !request.entry.attributes.some((attribute) => attribute.type.toLowerCase() === 'description')) request.entry.attributes.push({type: 'description', values: [Buffer.from('stamped')]})
            },
            transformEntry: (context, entry) => entry.dn.toString().startsWith('cn=hidden') ? undefined : entry,
            beforeCommit: () => {
                calls.push('beforeCommit')
            }
        }
        const {admin: own} = await directory({interceptors: [{interceptor: stamp, before: 'schema'}]})
        calls.length = 0
        await own.add(`cn=device1,${BASE}`, {objectClass: 'device', cn: 'device1'})
        await own.add(`cn=hidden,${BASE}`, {objectClass: 'device', cn: 'hidden'})
        assert.equal((await own.search(`cn=device1,${BASE}`, {scope: 'base'})).entries[0].first('description'), 'stamped')
        assert.equal((await own.search(BASE, {filter: '(objectClass=device)'})).entries.length, 1)
        assert.deepEqual(calls, ['beforeCommit', 'beforeCommit'])
        assert.throws(() => createLDAPServer({backends: [new MemoryBackend(BASE)], interceptors: [{interceptor: stamp, after: 'nothing'}]}), /not in the chain/)
    })

    it('serves the entries of handlers written operation by operation', async () => {
        const handlers = createLDAPServer({
            backends: [createHandlerBackend({
                suffix: 'ou=devices,dc=example,dc=com',
                search: () => [
                    {dn: 'ou=devices,dc=example,dc=com', attributes: {objectClass: 'organizationalUnit', ou: 'devices'}},
                    {dn: 'cn=printer1,ou=devices,dc=example,dc=com', attributes: {objectClass: 'device', cn: 'printer1', description: '10.0.0.5'}},
                    {dn: 'cn=printer2,ou=devices,dc=example,dc=com', attributes: {objectClass: 'device', cn: 'printer2', description: '10.0.0.6'}}
                ]
            })],
            access: {anonymousRead: true}
        })
        const reader: LDAPInProcessConnection = handlers.connect()
        assert.deepEqual((await reader.search('ou=devices,dc=example,dc=com', {filter: '(description=10.0.0.6)'})).entries.map((entry) => entry.dn), ['cn=printer2,ou=devices,dc=example,dc=com'])
        assert.equal(await reader.compare('cn=printer1,ou=devices,dc=example,dc=com', 'cn', 'PRINTER1'), true)
        await assert.rejects(reader.add('cn=x,ou=devices,dc=example,dc=com', {objectClass: 'device', cn: 'x'}), LDAPInsufficientAccessException)
    })

    it('forgets the in-process connections it closes', async () => {
        const before: number = server.inProcessCount
        const connection: LDAPInProcessConnection = server.connect()
        assert.equal(server.inProcessCount, before + 1)
        await connection.close()
        assert.equal(server.inProcessCount, before)
        const directory = createDirectory(admin)
        for (let index: number = 0; index < 5; index++) await directory.verifyPassword(`uid=user20,ou=people,${BASE}`, 'password20')
        assert.equal(server.inProcessCount, before)
    })

    it('runs the interceptors before the commit and the write in a transaction of the backend', async () => {
        const order: string[] = []
        class TransactionalBackend extends MemoryBackend {
            public async transaction(context: WriteContext, run: () => Promise<void>): Promise<void> {
                context.transaction = 'transaction'
                order.push('begin')
                try {
                    await run()
                    order.push('commit')
                } catch (error) {
                    order.push('rollback')
                    throw error
                }
            }

            public async add(context: WriteContext, entry: DirectoryEntry): Promise<void> {
                order.push(`add in ${String(context.transaction)}`)
                return super.add(context, entry)
            }
        }
        let refuse: boolean = false
        const own = createLDAPServer({
            backends: [new TransactionalBackend(BASE)],
            access: {admins: [ADMIN]},
            interceptors: [{name: 'check', operations: ['add'], beforeCommit: (context) => {
                order.push(`beforeCommit in ${String((context as WriteContext).transaction)}`)
                if (refuse) throw new LDAPUnwillingToPerformException('refused')
            }}]
        })
        const connection: LDAPInProcessConnection = own.connect({as: ADMIN})
        await connection.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
        refuse = true
        await assert.rejects(connection.add(`cn=x,${BASE}`, {objectClass: 'device', cn: 'x'}), LDAPUnwillingToPerformException)
        assert.deepEqual(order, ['begin', 'beforeCommit in transaction', 'add in transaction', 'commit', 'begin', 'beforeCommit in transaction', 'rollback'])
    })

    it('keeps the operational attributes an administrator imports, and drops those the server computes', async () => {
        const uuid: string = '5e4a7c2e-1f2b-4c3d-9e8f-0a1b2c3d4e5f'
        await admin.add(`cn=imported-device,${BASE}`, {objectClass: 'device', cn: 'imported-device', entryUUID: uuid, createTimestamp: '20200102030405Z', creatorsName: 'cn=old,dc=example,dc=com', entryDN: 'cn=whatever', hasSubordinates: 'TRUE', structuralObjectClass: 'person'})
        const entry = (await admin.search(`cn=imported-device,${BASE}`, {scope: 'base', attributes: ['+']})).entries[0]
        assert.deepEqual([entry.first('entryUUID'), entry.first('createTimestamp'), entry.first('creatorsName'), entry.first('entryDN'), entry.first('structuralObjectClass'), entry.first('hasSubordinates')], [uuid, '20200102030405Z', 'cn=old,dc=example,dc=com', `cn=imported-device,${BASE}`, 'device', 'FALSE'])
        const writer = createLDAPServer({backends: [new MemoryBackend(BASE)], access: {check: () => true}})
        const user: LDAPInProcessConnection = writer.connect({as: `uid=someone,${BASE}`})
        await assert.rejects(user.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example', entryUUID: uuid}), LDAPConstraintViolationException)
    })

    it('shows the groups of one class as groups of the other too, when asked to', async () => {
        const {admin: shown} = await directory({plugins: [new GroupPresentationPlugin()]})
        await shown.add(`cn=unique,ou=groups,${BASE}`, {objectClass: 'groupOfUniqueNames', cn: 'unique', uniqueMember: `uid=user3,ou=people,${BASE}`})
        const names = (await shown.search(`ou=groups,${BASE}`, {filter: '(objectClass=groupOfNames)', attributes: ['objectClass', 'member', 'uniqueMember']})).entries
        assert.deepEqual(names.map((entry) => entry.first('cn') ?? entry.dn).length, 2)
        const unique = names.find((entry) => entry.dn.startsWith('cn=unique'))!
        assert.deepEqual([unique.get('objectClass').includes('groupOfNames'), unique.get('member')], [true, [`uid=user3,ou=people,${BASE}`]])
        assert.equal((await shown.search(`ou=groups,${BASE}`, {filter: `(uniqueMember=uid=user1,ou=people,${BASE})`})).entries[0].dn, `cn=developers,ou=groups,${BASE}`)
        const developers = (await shown.search(`cn=developers,ou=groups,${BASE}`, {scope: 'base'})).entries[0]
        assert.deepEqual(developers.get('uniqueMember').sort(), [`uid=user1,ou=people,${BASE}`, `uid=user2,ou=people,${BASE}`])
        const plain = (await admin.search(`cn=developers,ou=groups,${BASE}`, {scope: 'base'})).entries[0]
        assert.equal(plain.has('uniqueMember'), false)
    })

    it('shows the schema files as OpenLDAP does, when asked', async () => {
        const viewing = createLDAPServer({backends: [new MemoryBackend(BASE)], schemaConfigView: true, access: {anonymousRead: true}, schema: [...DEFAULTS, RFC2307BIS]})
        const {entries} = await viewing.connect().search('cn=schema,cn=config', {scope: 'one'})
        assert.deepEqual(entries.map((entry) => entry.first('cn')), ['{0}system', '{1}core', '{2}cosine', '{3}inetorgperson', '{4}rfc2307bis'])
        assert.ok(entries[1].get('olcAttributeTypes').some((definition) => definition.startsWith('{') && definition.includes('\'sn\'')))
    })
})

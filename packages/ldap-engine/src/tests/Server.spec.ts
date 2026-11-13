import assert from 'node:assert/strict'
import {createHash, randomBytes} from 'node:crypto'
import {argon2Function} from '../lib/server/Passwords.js'
import {before, describe, it} from 'node:test'
import {
    afterBind,
    createDirectory,
    createHandlerBackend,
    createLDAPServer,
    type DirectoryEntry,
    type SearchContext,
    DN,
    Filter,
    findControl,
    formatGeneralizedTime,
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
    LastBindPlugin,
    LDAPResultException,
    LDAPUsageException,
    type LDAPServerEngine,
    LDAPUnavailableCriticalExtensionException,
    LDAPUnwillingToPerformException,
    MemoryBackend,
    ManageDsaITControl,
    PagedResultsControl,
    PasswordPolicyRequestControl,
    PasswordSchemes,
    plainMechanism,
    type OperationContext,
    readSchema,
    type Schema,
    SortRequestControl,
    SortResponseControl,
    TreeDeleteControl,
    VLVRequestControl,
    VLVResponseControl,
    type WriteContext
} from '../exports/LDAPEngine.js'
import {
    DEFAULTS,
    PPOLICY,
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

    it('asks the access check about where a rename takes the entry, so that a rename does not escape it', async () => {
        //The helpdesk of the guide: it writes the entries of the people, and nothing else
        const WRITES: string[] = ['add', 'modify', 'delete', 'modifyDN']
        const HELPDESK: string = `cn=helpdesk,${BASE}`
        const {server: guarded, admin: owner} = await directory({access: {
            admins: [ADMIN],
            check: (request: {operation: string, identity?: {equals(dn: string): boolean}, dn: {isDescendantOf(dn: string): boolean}}): boolean | undefined => request.identity?.equals(HELPDESK) && WRITES.includes(request.operation) ? request.dn.isDescendantOf(`ou=people,${BASE}`) : undefined
        }})
        await owner.add(HELPDESK, {objectClass: ['organizationalRole', 'simpleSecurityObject'], cn: 'helpdesk', userPassword: 'helpdesk-password'})
        const helpdesk: LDAPInProcessConnection = guarded.connect()
        await helpdesk.bind(HELPDESK, 'helpdesk-password')
        //Within the people: allowed
        await helpdesk.modify(`uid=user5,ou=people,${BASE}`, {operation: 'replace', attribute: 'userPassword', values: 'chosen-by-helpdesk'})
        await helpdesk.modifyDN(`uid=user6,ou=people,${BASE}`, 'uid=user6b', {deleteOldRDN: false})
        //Out of the people, to the DN of the administrator (which has no entry): refused, and no bind as the administrator
        await assert.rejects(helpdesk.modifyDN(`uid=user5,ou=people,${BASE}`, 'cn=admin', {deleteOldRDN: false, newSuperior: BASE}), code(50))
        await assert.rejects(helpdesk.modifyDN(`uid=user5,ou=people,${BASE}`, 'uid=user5', {newSuperior: `ou=groups,${BASE}`}), code(50))
        await assert.rejects(guarded.connect().bind(ADMIN, 'chosen-by-helpdesk'), LDAPInvalidCredentialsException)
        assert.equal((await owner.search(`uid=user5,ou=people,${BASE}`, {scope: 'base'})).entries.length, 1)
        //A check knowing the entry a rename comes from
        const seen: string[] = []
        const {server: watched, admin: watcher} = await directory({access: {admins: [ADMIN], check: (request: {operation: string, dn: {toString(): string}, from?: {toString(): string}}): boolean | undefined => {
            if (request.operation === 'modifyDN') seen.push(`${request.dn.toString()} from ${String(request.from)}`)
            return undefined
        }}})
        void watched
        await watcher.modifyDN(`uid=user7,ou=people,${BASE}`, 'uid=user7b')
        assert.deepEqual(seen, [`uid=user7,ou=people,${BASE} from undefined`, `uid=user7b,ou=people,${BASE} from uid=user7,ou=people,${BASE}`])
        //The attributes a rename writes, asked as a modify: a user renaming its entry, writing its description only
        const USER8: string = `uid=user8,ou=people,${BASE}`
        const {server: selfRenaming} = await directory({access: {admins: [ADMIN], check: (request: {operation: string, identity?: {equals(dn: string): boolean}, attributes?: string[]}): boolean | undefined => {
            if (!request.identity?.equals(USER8)) return undefined
            if (request.operation === 'modifyDN') return true
            return request.operation === 'modify' ? (request.attributes ?? []).every((attribute: string): boolean => attribute === 'description') : undefined
        }}})
        const renamer: LDAPInProcessConnection = selfRenaming.connect()
        await renamer.bind(USER8, 'password8')
        await assert.rejects(renamer.modifyDN(USER8, 'uid=user8+employeeType=admin', {deleteOldRDN: false}), code(50))
        await assert.rejects(renamer.modifyDN(USER8, 'uid=user8b'), code(50))
        //A move keeping its RDN writes no attribute
        await renamer.modifyDN(USER8, 'uid=user8', {newSuperior: `ou=groups,${BASE}`})
    })

    it('checks the values a rename writes as a write of the session: no attribute users cannot write, no password', async () => {
        //Anyone may rename entries here, and write the attributes of their RDNs
        const {server: renaming, admin: owner} = await directory({schema: [...DEFAULTS, PPOLICY], access: {admins: [ADMIN], check: (request: {operation: string}): boolean | undefined => request.operation === 'modifyDN' || request.operation === 'modify' ? true : undefined}})
        const user: LDAPInProcessConnection = renaming.connect()
        await user.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        //An attribute users cannot write (no policy to apply to the user then), given by the new RDN
        await assert.rejects(user.modifyDN(`uid=user1,ou=people,${BASE}`, 'uid=user1+pwdPolicySubentry=cn\\=none\\,dc\\=example\\,dc\\=com', {deleteOldRDN: false}), code(19))
        await assert.rejects(user.modifyDN(`uid=user1,ou=people,${BASE}`, 'uid=user1+entryUUID=00000000-0000-7000-8000-000000000000', {deleteOldRDN: false}), code(19))
        //A password in an RDN: in clear in the DN, not hashed
        await assert.rejects(user.modifyDN(`uid=user1,ou=people,${BASE}`, 'uid=user1+userPassword=clear-text', {deleteOldRDN: false}), code(64))
        await assert.rejects(owner.modifyDN(`uid=user2,ou=people,${BASE}`, 'uid=user2+userPassword=clear-text', {deleteOldRDN: false}), code(64))
        //The entry left as it was; a rename of user attributes still allowed
        assert.equal((await owner.search(`uid=user1,ou=people,${BASE}`, {scope: 'base', attributes: ['pwdPolicySubentry']})).entries[0].has('pwdPolicySubentry'), false)
        await user.modifyDN(`uid=user1,ou=people,${BASE}`, 'uid=user1+cn=User 01', {deleteOldRDN: false})
    })

    it('compares only in the entries a search would show the session, a hidden one answered as one not there', async () => {
        //uid=user3 hidden from the users
        const {server: hiding, admin: owner} = await directory({access: {admins: [ADMIN], check: (request: {operation: string, identity?: {toString(): string}, dn: {toString(): string}}): boolean | undefined => request.operation === 'read' && String(request.identity) !== ADMIN && String(request.dn).startsWith('uid=user3,') ? false : undefined}})
        const user: LDAPInProcessConnection = hiding.connect()
        await user.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        assert.equal((await user.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user3)'})).entries.length, 0)
        //As an entry that is not there: noSuchObject, the same matched DN, whatever the value
        const answer = (dn: string, value: string): Promise<unknown> => user.compare(dn, 'mail', value).then((result: boolean): string => String(result), (error: unknown): string => `${(error as LDAPResultException).code} ${(error as LDAPResultException).matchedDN}`)
        const missing: unknown = await answer(`uid=nobody,ou=people,${BASE}`, 'x@example.com')
        assert.equal(missing, `32 ou=people,${BASE}`)
        assert.equal(await answer(`uid=user3,ou=people,${BASE}`, 'user3@example.com'), missing)
        assert.equal(await answer(`uid=user3,ou=people,${BASE}`, 'other@example.com'), missing)
        //The entries it sees, and an administrator
        assert.equal(await user.compare(`uid=user4,ou=people,${BASE}`, 'mail', 'user4@example.com'), true)
        assert.equal(await owner.compare(`uid=user3,ou=people,${BASE}`, 'mail', 'user3@example.com'), true)
    })

    it('checks a password given to delete only on one\'s own entry, so that a writer of others\' passwords does not learn them', async () => {
        //A manager writing the passwords of the people
        const MANAGER: string = `cn=manager,${BASE}`
        const {server: managed, admin: owner, backend: stored} = await directory({access: {admins: [ADMIN], check: (request: {operation: string, identity?: {toString(): string}, dn: {isDescendantOf(dn: string): boolean}}): boolean | undefined => String(request.identity) === MANAGER && request.operation === 'modify' ? request.dn.isDescendantOf(`ou=people,${BASE}`) : undefined}})
        await owner.add(MANAGER, {objectClass: ['organizationalRole', 'simpleSecurityObject'], cn: 'manager', userPassword: 'manager-password'})
        const manager: LDAPInProcessConnection = managed.connect()
        await manager.bind(MANAGER, 'manager-password')
        const guess = (value: string): Promise<unknown> => manager.modify(`uid=user5,ou=people,${BASE}`, [{operation: 'delete', attribute: 'userPassword', values: value}, {operation: 'add', attribute: 'userPassword', values: value}]).then((): string => 'success', (error: unknown): number => (error as LDAPResultException).code)
        //The right password and a wrong one answered alike, the password left as it was
        assert.deepEqual([await guess('password5'), await guess('wrong-guess')], [16, 16])
        await managed.connect().bind(`uid=user5,ou=people,${BASE}`, 'password5')
        //A password stored in clear by an older directory, not yet hashed again by a bind: the same
        const carried: DirectoryEntry = stored.entries().find((entry: DirectoryEntry): boolean => entry.dn.toString() === `uid=user7,ou=people,${BASE}`)!
        stored.load([{dn: carried.dn, attributes: carried.attributes.map((attribute) => attribute.type === 'userPassword' ? {type: attribute.type, values: [Buffer.from('carried-in-clear')]} : attribute)}])
        const guessClear = (value: string): Promise<unknown> => manager.modify(`uid=user7,ou=people,${BASE}`, [{operation: 'delete', attribute: 'userPassword', values: value}, {operation: 'add', attribute: 'userPassword', values: 'by-manager'}]).then((): string => 'success', (error: unknown): string => `${(error as LDAPResultException).code} ${(error as LDAPResultException).diagnosticMessage}`)
        assert.equal(await guessClear('carried-in-clear'), await guessClear('wrong-guess'))
        //Nor told by where it fails: a change before it failing on its own fails alike
        const guessOrdered = (value: string): Promise<unknown> => manager.modify(`uid=user7,ou=people,${BASE}`, [{operation: 'add', attribute: 'mail', values: 'user7@example.com'}, {operation: 'delete', attribute: 'userPassword', values: value}]).then((): string => 'success', (error: unknown): string => `${(error as LDAPResultException).code} ${(error as LDAPResultException).diagnosticMessage}`)
        assert.equal(await guessOrdered('carried-in-clear'), await guessOrdered('wrong-guess'))
        await managed.connect().bind(`uid=user7,ou=people,${BASE}`, 'carried-in-clear')
        //Replacing it is what a writer of passwords does
        await manager.modify(`uid=user5,ou=people,${BASE}`, {operation: 'replace', attribute: 'userPassword', values: 'set-by-manager'})
        await managed.connect().bind(`uid=user5,ou=people,${BASE}`, 'set-by-manager')
        //One's own: the old password given to delete, the new one added
        const self: LDAPInProcessConnection = managed.connect()
        await self.bind(`uid=user6,ou=people,${BASE}`, 'password6')
        await self.modify(`uid=user6,ou=people,${BASE}`, [{operation: 'delete', attribute: 'userPassword', values: 'password6'}, {operation: 'add', attribute: 'userPassword', values: 'new-password-6'}])
        await managed.connect().bind(`uid=user6,ou=people,${BASE}`, 'new-password-6')
    })

    it('runs an operation under the identity it started with, a bind on the session meanwhile', async () => {
        //A modify held before its access check, a bind as a user made on the session meanwhile
        let holding: boolean = false
        let reached: () => void = (): void => undefined
        const reachedPromise: Promise<void> = new Promise<void>((resolve: () => void): void => {
            reached = resolve
        })
        let release: () => void = (): void => undefined
        const released: Promise<void> = new Promise<void>((resolve: () => void): void => {
            release = resolve
        })
        const {server: held, admin: owner} = await directory({interceptors: [{interceptor: {name: 'held', operations: ['modify'], before: async (): Promise<void> => {
            if (!holding) return
            holding = false
            reached()
            await released
        }}, before: 'access'}]})
        const session: LDAPInProcessConnection = held.connect({as: ADMIN})
        holding = true
        const writing: Promise<unknown> = session.modify(`uid=user3,ou=people,${BASE}`, {operation: 'replace', attribute: 'description', values: 'by the administrator'})
        await reachedPromise
        await session.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        release()
        //Done as the administrator who sent it, not as the user bound since
        await writing
        const entry = (await owner.search(`uid=user3,ou=people,${BASE}`, {scope: 'base', attributes: ['description', 'modifiersName']})).entries[0]
        assert.deepEqual([entry.first('description'), entry.first('modifiersName')?.toLowerCase()], ['by the administrator', ADMIN.toLowerCase()])
        //The session is the user's now
        assert.equal(await session.whoAmI(), `dn:uid=user1,ou=people,${BASE}`)
    })

    it('keeps no paged search a bind ended, its page still being read when the bind came', async () => {
        //The entries of a search held as its first page is read, a bind made on the session meanwhile
        let holding: boolean = false
        let reached: () => void = (): void => undefined
        const reachedPromise: Promise<void> = new Promise<void>((resolve: () => void): void => {
            reached = resolve
        })
        let release: () => void = (): void => undefined
        const released: Promise<void> = new Promise<void>((resolve: () => void): void => {
            release = resolve
        })
        const {server: held} = await directory({interceptors: [{name: 'held', operations: ['search'], around: async (_context: unknown, _request: unknown, next: () => Promise<{entries?: AsyncIterable<DirectoryEntry>}>): Promise<unknown> => {
            const outcome = await next()
            const entries: AsyncIterable<DirectoryEntry> | undefined = outcome.entries
            if (!holding || !entries) return outcome
            holding = false
            return {...outcome, entries: (async function* () {
                reached()
                await released
                yield* entries
            })()}
        }} as never]})
        const session: LDAPInProcessConnection = held.connect()
        await session.bind(`uid=user2,ou=people,${BASE}`, 'password2')
        holding = true
        const paging = session.search(`ou=people,${BASE}`, {scope: 'one', paged: false, controls: [PagedResultsControl.encode({size: 2, cookie: Buffer.alloc(0)})]})
        await reachedPromise
        await session.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        release()
        //Its page sent (read under the identity it started with), with a cookie the server no longer takes: not an empty
        //one, which would say the search is done
        const page = await paging
        const cookie: Buffer = PagedResultsControl.decode(findControl(page.controls, PagedResultsControl)!).cookie
        assert.deepEqual([page.entries.length, cookie.length > 0], [2, true])
        await assert.rejects(session.search(`ou=people,${BASE}`, {scope: 'one', paged: false, controls: [PagedResultsControl.encode({size: 2, cookie: cookie})]}), code(53))
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
        const pages = async (connection: LDAPInProcessConnection, size: number | number[], sizeLimit: number = 0): Promise<{counts: number[], exceeded: boolean}> => {
            const counts: number[] = []
            let cookie: Buffer = Buffer.alloc(0)
            for (;;) {
                //The page size of each page, the last one going on
                const sizes: number[] = Array.isArray(size) ? size : [size]
                const controls = [PagedResultsControl.encode({size: sizes[Math.min(counts.length, sizes.length - 1)], cookie: cookie})]
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
        //Reached at the end of a page with entries left: sizeLimitExceeded there
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
        //The limit reached with only entries the session does not see left: success
        const {server: tail} = await directory({access: {admins: [ADMIN], check: (request: {operation: string, dn?: {toString(): string}}): boolean | undefined => request.operation === 'read' && /^uid=user(1[5-9]|2\d),/i.test(String(request.dn)) ? false : undefined}})
        const tailReader: LDAPInProcessConnection = tail.connect()
        await tailReader.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        const ended: {counts: number[], exceeded: boolean} = await pages(tailReader, 4, 15)
        assert.equal(ended.counts.reduce((sum: number, count: number): number => sum + count, 0), 15)
        assert.equal(ended.exceeded, false)
        //A page as large as wished reads no more than what the size limit leaves, and one more
        let read: number = 0
        class CountingBackend extends MemoryBackend {
            public async search(context: Parameters<MemoryBackend['search']>[0]): ReturnType<MemoryBackend['search']> {
                const result = await super.search(context)
                return {...result, entries: (async function* () {
                    for await (const entry of result.entries) {
                        read++
                        yield entry
                    }
                })()}
            }
        }
        const {server: counted} = await directory({backends: [new CountingBackend(BASE)], limits: {sizeLimit: 10}})
        const counter: LDAPInProcessConnection = counted.connect()
        await counter.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        read = 0
        assert.deepEqual(await pages(counter, 100000), {counts: [10], exceeded: true})
        assert.ok(read <= 12, String(read))
        //A page size grown on a later page: still within the limit
        read = 0
        const first = await counter.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user*)', paged: false, controls: [PagedResultsControl.encode({size: 4, cookie: Buffer.alloc(0)})]})
        const cookie: Buffer = PagedResultsControl.decode(findControl(first.controls, PagedResultsControl)!).cookie
        await assert.rejects(counter.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user*)', paged: false, controls: [PagedResultsControl.encode({size: 100000, cookie: cookie})]}), code(4))
        assert.ok(read <= 17, String(read))
        //Most entries hidden, a page as large as the limit: one answer, not a page for each few entries read
        const {server: sparse} = await directory({access: {admins: [ADMIN], check: (request: {operation: string, dn?: {toString(): string}}): boolean | undefined => request.operation === 'read' && /^uid=user(\d|1\d|2[0-7]),/i.test(String(request.dn)) ? false : undefined}})
        const sparseReader: LDAPInProcessConnection = sparse.connect()
        await sparseReader.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        assert.deepEqual(await pages(sparseReader, 100, 2), {counts: [2], exceeded: false})
        //A page reads within the limit of the search, not what is left of it: a run of hidden entries after the first
        //page is passed in pages as large as the limit
        const {admin: gapped} = await directory({access: {admins: [ADMIN], check: (request: {operation: string, dn?: {toString(): string}}): boolean | undefined => request.operation === 'read' && /^uid=user([89]|1\d|2[0-7]),/i.test(String(request.dn)) ? false : undefined}})
        assert.deepEqual(await pages(gapped, [8, 100], 10), {counts: [8, 2], exceeded: false})
        //The client's own paging still tells it was cut
        const cut = await owner.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user*)', sizeLimit: 15, paged: {pageSize: 10}})
        assert.deepEqual([cut.entries.length, cut.truncated], [15, true])
    })

    it('leaves out the entries a session may not read before it pages, sorts, windows and counts', async () => {
        //The users of an even number hidden from all but user2
        const READER: string = `uid=user1,ou=people,${BASE}`
        let offset: number = 0
        let ticking: boolean = false
        const {server: hiding} = await directory({access: {admins: [ADMIN], check: (request: {operation: string, identity?: {toString(): string}, dn: {toString(): string}}): boolean | undefined => {
            if (request.operation !== 'read') return undefined
            if (ticking) offset += 600
            return String(request.identity) !== `uid=user2,ou=people,${BASE}` && /^uid=user\d*[02468],/i.test(String(request.dn)) ? false : undefined
        }}})
        const reader: LDAPInProcessConnection = hiding.connect()
        await reader.bind(READER, 'password1')
        //The virtual list view counts and windows what the session reads
        const window = await reader.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user*)', sort: [{attribute: 'cn'}], window: {offset: 1, limit: 5}})
        assert.deepEqual([window.total, window.entries.length], [15, 5])
        assert.ok(window.entries.every((entry) => /[13579]$/.test(entry.first('uid')!)), JSON.stringify(window.entries.map((entry) => entry.dn)))
        //A base it may not read: as one that is not there; nor told by the matched DN of an entry below it
        const answer = (dn: string): Promise<string> => reader.search(dn, {scope: 'base'}).then((result): string => `found ${result.entries.length}`, (error: unknown): string => `${(error as LDAPResultException).code} ${(error as LDAPResultException).matchedDN}`)
        assert.equal(await answer(`uid=user4,ou=people,${BASE}`), await answer(`uid=nobody,ou=people,${BASE}`))
        assert.equal(await answer(`cn=below,uid=user4,ou=people,${BASE}`), await answer(`cn=below,uid=nobody,ou=people,${BASE}`))
        const compared = (dn: string): Promise<string> => reader.compare(dn, 'cn', 'x').then(String, (error: unknown): string => `${(error as LDAPResultException).code} ${(error as LDAPResultException).matchedDN}`)
        assert.equal(await compared(`cn=below,uid=user4,ou=people,${BASE}`), await compared(`cn=below,uid=nobody,ou=people,${BASE}`))
        //Refused search on a DN: the same answer whether the entry is there or not
        const {server: guarded} = await directory({access: {admins: [ADMIN], check: (request: {operation: string, identity?: {toString(): string}, dn: {toString(): string}}): boolean | undefined => request.operation === 'search' && String(request.identity) !== ADMIN && [`uid=user4,ou=people,${BASE}`, `uid=ghost,ou=people,${BASE}`].includes(String(request.dn)) ? false : undefined}})
        const prober: LDAPInProcessConnection = guarded.connect()
        await prober.bind(READER, 'password1')
        const probe = (dn: string, scope: 'base' | 'sub'): Promise<string> => prober.search(dn, {scope: scope}).then((result): string => `found ${result.entries.length}`, (error: unknown): string => `${(error as LDAPResultException).code} ${(error as LDAPResultException).diagnosticMessage} ${(error as LDAPResultException).matchedDN}`)
        for (const scope of ['base', 'sub'] as const) assert.equal(await probe(`uid=user4,ou=people,${BASE}`, scope), await probe(`uid=ghost,ou=people,${BASE}`, scope))
        assert.match(await probe(`uid=user4,ou=people,${BASE}`, 'sub'), /^50 /)
        //A base it may not read, searched below: the entries it reads below it
        const {server: selves} = await directory({access: {admins: [ADMIN], check: (request: {operation: string, identity?: {toString(): string}, dn: {toString(): string}}): boolean | undefined => request.operation === 'read' && String(request.identity) !== ADMIN ? String(request.dn).toLowerCase() === String(request.identity).toLowerCase() : undefined}})
        const self: LDAPInProcessConnection = selves.connect()
        await self.bind(READER, 'password1')
        assert.deepEqual((await self.search(BASE, {filter: '(uid=user1)'})).entries.map((entry) => entry.dn), [READER])
        assert.equal((await self.search(BASE, {filter: '(uid=user2)'})).entries.length, 0)
        //A paged search does not go on after a bind on the session
        const session: LDAPInProcessConnection = hiding.connect()
        await session.bind(`uid=user2,ou=people,${BASE}`, 'password2')
        const first = await session.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user*)', paged: false, controls: [PagedResultsControl.encode({size: 4, cookie: Buffer.alloc(0)})]})
        const cookie: Buffer = PagedResultsControl.decode(findControl(first.controls, PagedResultsControl)!).cookie
        assert.ok(cookie.length)
        await session.bind(READER, 'password1')
        await assert.rejects(session.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user*)', paged: false, controls: [PagedResultsControl.encode({size: 4, cookie: cookie})]}), code(53))
        //Nor after a bind refused before it is done (a critical control it does not know): the session anonymous, its
        //paged search (entries read for the identity before) ended
        const {server: open} = await directory({access: {admins: [ADMIN], anonymousRead: true, check: (request: {operation: string, identity?: {toString(): string}, dn: {toString(): string}}): boolean | undefined => request.operation === 'read' && request.identity === undefined && String(request.dn).startsWith('uid=user1') ? false : undefined}})
        const refusing: LDAPInProcessConnection = open.connect()
        await refusing.bind(`uid=user2,ou=people,${BASE}`, 'password2')
        const begun = await refusing.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user*)', paged: false, controls: [PagedResultsControl.encode({size: 4, cookie: Buffer.alloc(0)})]})
        const kept: Buffer = PagedResultsControl.decode(findControl(begun.controls, PagedResultsControl)!).cookie
        await assert.rejects(refusing.bind(READER, 'password1', {controls: [{oid: '1.3.6.1.4.1.99999.1', critical: true}]}), code(12))
        await assert.rejects(refusing.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user*)', paged: false, controls: [PagedResultsControl.encode({size: 4, cookie: kept})]}), code(53))
        //Hidden entries read past the time limit: timeLimitExceeded, not success without entries
        const now: () => number = Date.now
        Date.now = (): number => now() + offset
        ticking = true
        try {
            const late: string = await reader.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user*0)', timeLimit: 1, paged: false}).then((result): string => `found ${result.entries.length}`, (error: unknown): string => String((error as LDAPResultException).code))
            assert.equal(late, '3')
        } finally {
            Date.now = now
            ticking = false
        }
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
        //A critical view with a sort it cannot do, not critical: refused, not every entry unsorted (RFC 4511 §4.1.11)
        const view = (sort: string) => [SortRequestControl.encode([{attribute: sort}]), VLVRequestControl.encode({beforeCount: 0, afterCount: 4, offset: {offset: 1, contentCount: 0}}, true)]
        await assert.rejects(admin.search(`ou=people,${BASE}`, {scope: 'one', paged: false, controls: view('jpegPhoto')}), LDAPUnavailableCriticalExtensionException)
        await assert.rejects(small.admin.search(`ou=people,${BASE}`, {scope: 'one', paged: false, controls: view('cn')}), LDAPUnavailableCriticalExtensionException)
        //The view not critical either: not applied, the entries as they come
        assert.equal((await small.admin.search(`ou=people,${BASE}`, {scope: 'one', paged: false, controls: [SortRequestControl.encode([{attribute: 'jpegPhoto'}]), VLVRequestControl.encode({beforeCount: 0, afterCount: 4, offset: {offset: 1, contentCount: 0}})]})).entries.length, 30)
    })

    it('ends a search at its time limit whatever it waits for, and ends its paging there', async () => {
        //A backend whose search never gives anything
        const stalled: LDAPServerEngine = createLDAPServer({backends: [createHandlerBackend({
            suffix: BASE,
            get: (_context, dn) => ({dn: dn, attributes: {objectClass: 'domain', dc: 'example'}}),
            search: async function* () {
                await new Promise<void>((): void => undefined)
                yield* []
            } as never
        })], access: {admins: [ADMIN]}})
        const started: number = Date.now()
        const answer: string = await Promise.race([
            stalled.connect({as: ADMIN}).search(BASE, {scope: 'one', timeLimit: 1, paged: false}).then((): string => 'answered', (error: unknown): string => String((error as LDAPResultException).code)),
            new Promise<string>((resolve: (value: string) => void): void => {
                setTimeout((): void => resolve('waited past it'), 4000)
            })
        ])
        assert.equal(answer, '3')
        assert.ok(Date.now() - started < 3000)
        //A backend answering once the search ended: the cursor it gives closed
        let closed: boolean = false
        const cursor = {[Symbol.asyncIterator]: () => ({
            next: async (): Promise<IteratorResult<DirectoryEntry>> => ({done: true, value: undefined}),
            return: async (): Promise<IteratorResult<DirectoryEntry>> => {
                closed = true
                return {done: true, value: undefined}
            }
        })}
        const late: LDAPServerEngine = createLDAPServer({backends: [{
            suffix: BASE,
            get: async (_context: unknown, dn: DN): Promise<DirectoryEntry> => ({dn: dn, attributes: [{type: 'objectClass', values: [Buffer.from('domain')]}, {type: 'dc', values: [Buffer.from('example')]}]}),
            search: async (): Promise<unknown> => {
                await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 1300))
                return {entries: cursor, exact: false}
            }
        } as never], access: {admins: [ADMIN]}})
        await assert.rejects(late.connect({as: ADMIN}).search(BASE, {scope: 'one', timeLimit: 1, paged: false}), code(3))
        await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 600))
        assert.equal(closed, true)
        //A page cut at the time limit as it is sent: no cookie to go on with
        let offset: number = 0
        let advancing: boolean = false
        const {server: timed} = await directory({interceptors: [{interceptor: {name: 'late', operations: ['search'], around: async (_context: unknown, _request: unknown, next: () => Promise<unknown>): Promise<unknown> => {
            const outcome: unknown = await next()
            if (advancing) offset += 5000
            return outcome
        }} as never, before: 'paging'}]})
        const session: LDAPInProcessConnection = timed.connect({as: ADMIN})
        const now: () => number = Date.now
        Date.now = (): number => now() + offset
        advancing = true
        let cookie: Buffer = Buffer.alloc(0)
        try {
            await assert.rejects(session.search(`ou=people,${BASE}`, {scope: 'one', timeLimit: 1, paged: false, controls: [PagedResultsControl.encode({size: 2, cookie: Buffer.alloc(0)})]}), (error: unknown) => {
                const control = findControl((error as LDAPResultException).controls, PagedResultsControl)
                cookie = control ? PagedResultsControl.decode(control).cookie : Buffer.alloc(0)
                return (error as LDAPResultException).code === 3
            })
        } finally {
            Date.now = now
            advancing = false
        }
        assert.equal(cookie.length, 0)
    })

    it('checks the entries an interceptor adds to a search, and pages each page within its own time limit', async () => {
        //An interceptor adding an entry to the people's searches: uid=user4, which the users may not read
        const {server: merging, admin: owner} = await directory({
            access: {admins: [ADMIN], check: (request: {operation: string, identity?: {toString(): string}, dn: {toString(): string}}): boolean | undefined => request.operation === 'read' && String(request.identity) !== ADMIN && String(request.dn).startsWith('uid=user4,') ? false : undefined},
            interceptors: [{name: 'merging', operations: ['search'], around: async (_context: unknown, _request: unknown, next: () => Promise<{entries?: AsyncIterable<DirectoryEntry>}>): Promise<unknown> => {
                const outcome = await next()
                const entries: AsyncIterable<DirectoryEntry> | undefined = outcome.entries
                const added: DirectoryEntry = {dn: DN.parse(`uid=user4,ou=people,${BASE}`), attributes: [{type: 'objectClass', values: [Buffer.from('inetOrgPerson')]}, {type: 'uid', values: [Buffer.from('user4')]}]}
                return {...outcome, entries: entries && (async function* () {
                    yield* entries
                    yield added
                })()}
            }} as never]
        })
        const reader: LDAPInProcessConnection = merging.connect()
        await reader.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        assert.deepEqual((await reader.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user1)'})).entries.map((entry) => entry.dn), [`uid=user1,ou=people,${BASE}`])
        assert.equal((await owner.search(`ou=people,${BASE}`, {scope: 'one', filter: '(uid=user1)'})).entries.length, 2)
        //Placed before the access step, outside it; and an entry swapped for another with the same DN: checked as well
        const {server: outside} = await directory({
            access: {admins: [ADMIN], check: (request: {operation: string, identity?: {toString(): string}, dn: {toString(): string}, entry?: DirectoryEntry}): boolean | undefined => request.operation === 'read' && String(request.identity) !== ADMIN && (String(request.dn).startsWith('uid=user4,') || request.entry?.attributes.some((attribute) => attribute.type === 'description' && attribute.values.some((value: Buffer) => value.toString() === 'secret'))) ? false : undefined},
            interceptors: [{interceptor: {name: 'outside', operations: ['search'], around: async (_context: unknown, _request: unknown, next: () => Promise<{entries?: AsyncIterable<DirectoryEntry>}>): Promise<unknown> => {
                const outcome = await next()
                const entries: AsyncIterable<DirectoryEntry> | undefined = outcome.entries
                const added: DirectoryEntry = {dn: DN.parse(`uid=user4,ou=people,${BASE}`), attributes: [{type: 'objectClass', values: [Buffer.from('inetOrgPerson')]}, {type: 'uid', values: [Buffer.from('user4')]}]}
                return {...outcome, entries: entries && (async function* () {
                    for await (const entry of entries) yield entry.dn.toString().startsWith('uid=user2,') ? {dn: entry.dn, attributes: [...entry.attributes, {type: 'description', values: [Buffer.from('secret')]}]} : entry
                    yield added
                })()}
            }}, before: 'access'} as never]
        })
        const outsider: LDAPInProcessConnection = outside.connect()
        await outsider.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        assert.deepEqual((await outsider.search(`ou=people,${BASE}`, {scope: 'one', filter: '(|(uid=user1)(uid=user2))'})).entries.map((entry) => entry.dn), [`uid=user1,ou=people,${BASE}`])
        //Each page within the time limit of its own request, however long the client waits between them
        const now: () => number = Date.now
        let offset: number = 0
        Date.now = (): number => now() + offset
        try {
            const first = await owner.search(`ou=people,${BASE}`, {scope: 'one', timeLimit: 1, paged: false, controls: [PagedResultsControl.encode({size: 2, cookie: Buffer.alloc(0)})]})
            const cookie: Buffer = PagedResultsControl.decode(findControl(first.controls, PagedResultsControl)!).cookie
            offset += 5000
            const second = await owner.search(`ou=people,${BASE}`, {scope: 'one', timeLimit: 1, paged: false, controls: [PagedResultsControl.encode({size: 2, cookie: cookie})]})
            assert.equal(second.entries.length, 2)
        } finally {
            Date.now = now
        }
    })

    it('leaves the window of a virtual list view to a backend doing it, with an interceptor changing the entries only', async () => {
        const seen: string[][] = []
        const windowing: LDAPServerEngine = createLDAPServer({
            backends: [createHandlerBackend({
                suffix: 'ou=devices,dc=example,dc=com',
                capabilities: {controls: [SortRequestControl.oid, VLVRequestControl.oid]},
                search: (context: SearchContext) => {
                    seen.push(context.controls.map((control) => control.oid))
                    return [{dn: 'ou=devices,dc=example,dc=com', attributes: {objectClass: 'organizationalUnit', ou: 'devices'}}]
                }
            })],
            access: {admins: [ADMIN]},
            plugins: [new GroupPresentationPlugin()]
        })
        await windowing.connect({as: ADMIN}).search('ou=devices,dc=example,dc=com', {scope: 'one', paged: false, controls: [SortRequestControl.encode([{attribute: 'cn'}]), VLVRequestControl.encode({beforeCount: 0, afterCount: 4, offset: {offset: 1, contentCount: 0}})]})
        assert.ok(seen.at(-1)?.includes(VLVRequestControl.oid))
    })

    it('ends a paged search at the size limit a later page asks for, without skipping entries', async () => {
        const first = await admin.search(`ou=people,${BASE}`, {scope: 'one', paged: false, controls: [PagedResultsControl.encode({size: 4, cookie: Buffer.alloc(0)})]})
        const cookie: Buffer = PagedResultsControl.decode(findControl(first.controls, PagedResultsControl)!).cookie
        //Its own size limit asked for: one entry, sizeLimitExceeded, and no cookie going on past the entries it left out
        const second = await admin.search(`ou=people,${BASE}`, {scope: 'one', sizeLimit: 1, paged: false, controls: [PagedResultsControl.encode({size: 4, cookie: cookie})]})
        assert.deepEqual([second.entries.length, second.truncated, PagedResultsControl.decode(findControl(second.controls, PagedResultsControl)!).cookie.length], [1, true, 0])
    })

    it('answers a control of the engine whose value cannot be read with protocolError, critical or not', async () => {
        const people: string = `ou=people,${BASE}`
        const raw = (oid: string, bytes: number[] | undefined, critical: boolean): {oid: string, critical: boolean, value?: Buffer} => ({oid, critical, ...bytes ? {value: Buffer.from(bytes)} : {}})
        for (const critical of [true, false]) {
            await assert.rejects(admin.search(people, {scope: 'one', paged: false, controls: [raw(SortRequestControl.oid, [0x30, 0x03, 0x04], critical)]}), code(2))
            await assert.rejects(admin.search(people, {scope: 'one', paged: false, controls: [raw(PagedResultsControl.oid, [0x02, 0x01], critical)]}), code(2))
            await assert.rejects(admin.search(people, {scope: 'one', paged: false, controls: [SortRequestControl.encode([{attribute: 'cn'}]), raw(VLVRequestControl.oid, [0x30, 0x00], critical)]}), code(2))
            //A page size, and the counts of a view, below zero
            await assert.rejects(admin.search(people, {scope: 'one', paged: false, controls: [{...PagedResultsControl.encode({size: -1, cookie: Buffer.alloc(0)}), critical}]}), code(2))
            await assert.rejects(admin.search(people, {scope: 'one', paged: false, controls: [SortRequestControl.encode([{attribute: 'cn'}]), VLVRequestControl.encode({beforeCount: -1, afterCount: 0, offset: {offset: 1, contentCount: 0}}, critical)]}), code(2))
            //A value for a control that has none
            await assert.rejects(admin.search(people, {scope: 'one', paged: false, controls: [raw(ManageDsaITControl.oid, [0x01], critical)]}), code(2))
        }
        //On an operation it does not apply to, not critical: ignored (RFC 4511 §4.1.11), whatever its value
        await admin.modify(`uid=user8,ou=people,${BASE}`, {operation: 'replace', attribute: 'description', values: 'controls ignored'}, {controls: [raw(SortRequestControl.oid, [0x30, 0x03, 0x04], false), raw(PagedResultsControl.oid, [0x02, 0x01], false)]})
        assert.equal((await admin.search(people, {scope: 'one', filter: '(uid=user8)', paged: false, controls: [raw(TreeDeleteControl.oid, [0x01], false)]})).entries.length, 1)
        //Critical there: refused as not applying
        await assert.rejects(admin.modify(`uid=user8,ou=people,${BASE}`, {operation: 'replace', attribute: 'description', values: 'x'}, {controls: [raw(SortRequestControl.oid, [0x30, 0x03, 0x04], true)]}), code(12))
    })

    it('pages none of the entries for a first page of size 0, with a cookie while entries are left', async () => {
        const people: string = `ou=people,${BASE}`
        const first = await admin.search(people, {scope: 'one', paged: false, controls: [PagedResultsControl.encode({size: 0, cookie: Buffer.alloc(0)})]})
        const cookie: Buffer = PagedResultsControl.decode(findControl(first.controls, PagedResultsControl)!).cookie
        assert.deepEqual([first.entries.length, cookie.length > 0], [0, true])
        const second = await admin.search(people, {scope: 'one', paged: false, controls: [PagedResultsControl.encode({size: 2, cookie: cookie})]})
        assert.equal(second.entries.length, 2)
        //Nothing to return: no cookie
        const none = await admin.search(people, {scope: 'one', filter: '(uid=nobody)', paged: false, controls: [PagedResultsControl.encode({size: 0, cookie: Buffer.alloc(0)})]})
        assert.equal(PagedResultsControl.decode(findControl(none.controls, PagedResultsControl)!).cookie.length, 0)
    })

    it('sorts and views the entries as RFC 2891 and the virtual list view draft say, as OpenLDAP does', async () => {
        //The entries of the differential test against OpenLDAP: d3 and d6 without uidNumber, d1 with two values of cn
        const viewing: LDAPServerEngine = createLDAPServer({backends: [new MemoryBackend(BASE)], schema: [...DEFAULTS, RFC2307BIS], access: {admins: [ADMIN]}})
        const owner: LDAPInProcessConnection = viewing.connect({as: ADMIN})
        await owner.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
        const numbers: Record<string, string> = {d1: '1040', d2: '1010', d4: '1030', d5: '1020', d7: '1060', d8: '1050'}
        const names: Record<string, string> = {d1: 'One', d2: 'Two', d3: 'Three', d4: 'Four', d5: 'Five', d6: 'Six', d7: 'Seven', d8: 'Eight'}
        for (const uid of Object.keys(names)) {
            const person: Record<string, string | string[]> = {uid: uid, cn: uid === 'd1' ? ['Delta One', 'Delta Uno'] : `Delta ${names[uid]}`, sn: names[uid]}
            await owner.add(`uid=${uid},${BASE}`, numbers[uid] ? {objectClass: ['inetOrgPerson', 'posixAccount'], ...person, uidNumber: numbers[uid], gidNumber: '100', homeDirectory: `/home/${uid}`} : {objectClass: 'inetOrgPerson', ...person})
        }
        const search = (controls: {oid: string, critical: boolean, value?: Buffer}[]) => owner.search(BASE, {scope: 'one', filter: '(objectClass=inetOrgPerson)', attributes: ['1.1'], paged: false, controls: controls}).then((result) => ({
            code: 0,
            uids: result.entries.map((entry) => entry.dn.split(',')[0].slice(4)),
            sort: findControl(result.controls, SortResponseControl) ? SortResponseControl.decode(findControl(result.controls, SortResponseControl)!).result : undefined,
            view: findControl(result.controls, VLVResponseControl) ? VLVResponseControl.decode(findControl(result.controls, VLVResponseControl)!) : undefined
        }), (error: LDAPResultException) => ({
            code: error.code,
            uids: [] as string[],
            sort: findControl(error.controls ?? [], SortResponseControl) ? SortResponseControl.decode(findControl(error.controls ?? [], SortResponseControl)!).result : undefined,
            view: findControl(error.controls ?? [], VLVResponseControl) ? VLVResponseControl.decode(findControl(error.controls ?? [], VLVResponseControl)!) : undefined
        }))
        const byNumber = (reverse?: boolean) => SortRequestControl.encode([{attribute: 'uidNumber', ...reverse ? {reverse} : {}}])
        const view = (value: Parameters<typeof VLVRequestControl.encode>[0]) => VLVRequestControl.encode(value)
        //No value is greater than every value: last, and first in reverse
        assert.deepEqual((await search([byNumber()])).uids, ['d2', 'd5', 'd4', 'd1', 'd8', 'd7', 'd3', 'd6'])
        assert.deepEqual((await search([byNumber(true)])).uids, ['d3', 'd6', 'd7', 'd8', 'd1', 'd4', 'd5', 'd2'])
        //An attribute the schema does not know: noSuchAttribute as the result of the sort; unsorted, or refused when critical
        assert.deepEqual(await search([SortRequestControl.encode([{attribute: 'shoeSize'}])]).then((answer) => [answer.code, answer.sort, answer.uids.length]), [0, 16, 8])
        assert.deepEqual(await search([SortRequestControl.encode([{attribute: 'shoeSize'}], true)]).then((answer) => [answer.code, answer.sort]), [12, 16])
        assert.deepEqual(await search([SortRequestControl.encode([{attribute: 'uid', orderingRule: '1.2.3.4.5'}])]).then((answer) => answer.sort), 18)
        //The offset scaled to the count (Si = Sc × Ci / Cc), an offset equal to the count the last entry
        const at = (offset: number, contentCount: number, afterCount: number = 0) => search([byNumber(), view({beforeCount: 0, afterCount: afterCount, offset: {offset, contentCount}})])
        assert.deepEqual(await at(2, 4, 1).then((answer) => [answer.uids, answer.view?.targetPosition]), [['d1', 'd8'], 4])
        assert.deepEqual(await at(4, 4).then((answer) => [answer.uids, answer.view?.targetPosition]), [['d6'], 8])
        assert.deepEqual(await at(3, 0).then((answer) => [answer.uids, answer.view?.targetPosition]), [['d4'], 3])
        //An offset of 1 is the first entry only when the client's count is not 1: 1 of 1 is the last (§5)
        assert.deepEqual(await at(1, 1).then((answer) => [answer.uids, answer.view?.targetPosition]), [['d6'], 8])
        assert.deepEqual(await at(1, 5).then((answer) => [answer.uids, answer.view?.targetPosition]), [['d2'], 1])
        //An offset below 1, or past the last entry: virtualListViewError, offsetRangeError as the result of the view
        for (const [offset, contentCount] of [[0, 0], [-1, 0], [9, 0], [5, 3], [9, 8]]) {
            assert.deepEqual(await at(offset, contentCount).then((answer) => [answer.code, answer.view?.result, answer.sort]), [76, 61, undefined], `${offset}/${contentCount}`)
        }
        //The window of the client past the last entry: no entries, the count of the server
        assert.deepEqual(await owner.search(BASE, {scope: 'one', filter: '(objectClass=inetOrgPerson)', sort: [{attribute: 'uidNumber'}], window: {offset: 20, limit: 5}}).then((result) => [result.entries.length, result.total]), [0, 8])
        //No entries: no target
        assert.deepEqual((await owner.search(BASE, {scope: 'one', filter: '(uid=nobody)', paged: false, controls: [byNumber(), view({beforeCount: 0, afterCount: 2, offset: {offset: 1, contentCount: 0}})]}).then((result) => VLVResponseControl.decode(findControl(result.controls, VLVResponseControl)!))), {targetPosition: 0, contentCount: 0, result: 0})
        //The first entry not less than a value, not greater in reverse; no value is greater than every value
        const from = (value: string, reverse?: boolean) => search([byNumber(reverse), view({beforeCount: 1, afterCount: 1, greaterThanOrEqual: Buffer.from(value)})]).then((answer) => [answer.uids, answer.view?.targetPosition])
        assert.deepEqual(await from('1030'), [['d5', 'd4', 'd1'], 3])
        assert.deepEqual(await from('1030', true), [['d1', 'd4', 'd5'], 6])
        assert.deepEqual(await from('2000'), [['d7', 'd3', 'd6'], 7])
        assert.deepEqual(await from('2000', true), [['d6', 'd7', 'd8'], 3])
        assert.deepEqual(await from('900', true), [['d2'], 9])
        //Of several values, the least one, as the sort takes it
        assert.deepEqual(await search([SortRequestControl.encode([{attribute: 'cn', orderingRule: '2.5.13.3'}]), view({beforeCount: 0, afterCount: 2, greaterThanOrEqual: Buffer.from('Delta T')})]).then((answer) => [answer.uids, answer.view?.targetPosition]), [['d3', 'd2'], 7])
        //A view without its sort: sortControlMissing; a context ID the server never gave: protocolError (2; the draft's
        //list gives it 3, the code of timeLimitExceeded, a slip)
        assert.deepEqual(await search([view({beforeCount: 0, afterCount: 1, offset: {offset: 1, contentCount: 0}})]).then((answer) => [answer.code, answer.view?.result]), [76, 60])
        assert.deepEqual(await search([byNumber(), view({beforeCount: 0, afterCount: 1, offset: {offset: 1, contentCount: 0}, contextId: Buffer.from('nonsense')})]).then((answer) => [answer.code, answer.view?.result]), [76, 2])
        //The result of the sort with every page
        const results: (number | undefined)[] = []
        let cookie: Buffer = Buffer.alloc(0)
        do {
            const page = await owner.search(BASE, {scope: 'one', filter: '(objectClass=inetOrgPerson)', attributes: ['1.1'], paged: false, controls: [byNumber(), PagedResultsControl.encode({size: 3, cookie: cookie})]})
            results.push(findControl(page.controls, SortResponseControl) ? SortResponseControl.decode(findControl(page.controls, SortResponseControl)!).result : undefined)
            cookie = PagedResultsControl.decode(findControl(page.controls, PagedResultsControl)!).cookie
        } while (cookie.length)
        assert.deepEqual(results, [0, 0, 0])
    })

    it('takes a time limit longer than a timer of Node.js counts', async () => {
        //2147483647 seconds, as ldapsearch -l max sends it: past the 2^31 - 1 milliseconds of a timer, which fires at once;
        //a backend taking 30 milliseconds to answer
        const slow: LDAPServerEngine = createLDAPServer({backends: [createHandlerBackend({
            suffix: 'ou=devices,dc=example,dc=com',
            search: async () => {
                await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 30))
                return [{dn: 'ou=devices,dc=example,dc=com', attributes: {objectClass: 'organizationalUnit', ou: 'devices'}}]
            }
        })], access: {anonymousRead: true}, limits: {timeLimit: 0}})
        for (const timeLimit of [2147483647, 2147484]) assert.equal((await slow.connect().search('ou=devices,dc=example,dc=com', {scope: 'base', timeLimit: timeLimit, paged: false})).entries.length, 1)
    })

    it('evaluates a presence of an attribute the schema does not know as undefined, in a not too', async () => {
        const people: string = `ou=people,${BASE}`
        assert.equal((await admin.search(people, {scope: 'one', filter: '(!(shoeSize=*))', paged: false})).entries.length, 0)
        assert.deepEqual((await admin.search(people, {scope: 'one', filter: '(!(&(shoeSize=*)(uid=user1)))', attributes: ['uid'], paged: false})).entries.some((entry) => entry.first('uid') === 'user1'), false)
        assert.equal((await admin.search(people, {scope: 'one', filter: '(|(shoeSize=*)(uid=user1))', paged: false})).entries.length, 1)
    })

    it('returns for an attribute asked with options the attributes having them, as OpenLDAP does', async () => {
        const {admin: owner} = await directory()
        const dn: string = `cn=tagged,${BASE}`
        await owner.add(dn, {objectClass: 'device', cn: 'tagged', description: 'plain', 'description;lang-en': 'english', 'description;lang-de': 'deutsch'})
        const asked = async (attribute: string): Promise<string[]> => (await owner.search(dn, {scope: 'base', attributes: [attribute]})).entries[0].attributes.map((item) => `${item.type}=${item.values.map(String).join('|')}`).sort()
        assert.deepEqual(await asked('description'), ['description;lang-de=deutsch', 'description;lang-en=english', 'description=plain'])
        assert.deepEqual(await asked('description;lang-en'), ['description;lang-en=english'])
        assert.deepEqual(await asked('DESCRIPTION;LANG-EN'), ['description;lang-en=english'])
        assert.deepEqual(await asked('description;x-unknown'), [])
        assert.deepEqual(await asked('cn;lang-en'), [])
        //binary is a transfer option, not one an attribute has: as without it
        assert.deepEqual(await asked('description;binary'), ['description;lang-de=deutsch', 'description;lang-en=english', 'description=plain'])
    })

    it('serves its own entries as OpenLDAP does: not the root DSE below the root, no critical control left unapplied', async () => {
        //The root DSE is not in a search below the root (RFC 4512 §5.1)
        await assert.rejects(admin.search('', {scope: 'sub', paged: false}), code(32))
        await assert.rejects(admin.search('', {scope: 'one', paged: false}), code(32))
        //A critical sort or view, which these entries do not go through: refused; paged: in one page
        await assert.rejects(admin.search('', {scope: 'base', paged: false, controls: [SortRequestControl.encode([{attribute: 'cn'}], true)]}), code(12))
        await assert.rejects(admin.search('cn=Subschema', {scope: 'base', paged: false, controls: [SortRequestControl.encode([{attribute: 'cn'}]), VLVRequestControl.encode({beforeCount: 0, afterCount: 1, offset: {offset: 1, contentCount: 0}}, true)]}), code(12))
        assert.equal((await admin.search('', {scope: 'base', paged: false, controls: [SortRequestControl.encode([{attribute: 'cn'}])]})).entries.length, 1)
        const paged = await admin.search('', {scope: 'base', paged: false, controls: [PagedResultsControl.encode({size: 5, cookie: Buffer.alloc(0)}, true)]})
        assert.deepEqual([paged.entries.length, PagedResultsControl.decode(findControl(paged.controls, PagedResultsControl)!).cookie.length], [1, 0])
        //A critical control of a plugin saying it applies it to these entries (around the request): taken there too; one
        //of a plugin applying it in the chain of the backends only: refused
        const OID: string = '1.3.6.1.4.1.99999.11'
        const CHAINED: string = '1.3.6.1.4.1.99999.12'
        const applied: string[] = []
        const {admin: owner} = await directory({plugins: [{name: 'marker', controls: [{oid: OID, operations: ['search'], serverEntries: true}, {oid: CHAINED, operations: ['search']}], aroundRequest: async (context, _request, next) => {
            if (findControl(context.controls, OID)) applied.push(context.operation)
            return next()
        }}]})
        assert.equal((await owner.search('', {scope: 'base', paged: false, controls: [{oid: OID, critical: true}]})).entries.length, 1)
        assert.deepEqual(applied, ['search'])
        await assert.rejects(owner.search('', {scope: 'base', paged: false, controls: [{oid: CHAINED, critical: true}]}), code(12))
        assert.equal((await owner.search(`ou=people,${BASE}`, {scope: 'base', paged: false, controls: [{oid: CHAINED, critical: true}]})).entries.length, 1)
    })

    it('refuses a critical control of a backend on another backend', async () => {
        const OID: string = '1.3.6.1.4.1.99999.5'
        const mixed: LDAPServerEngine = createLDAPServer({backends: [new MemoryBackend('dc=a,dc=example,dc=com'), createHandlerBackend({
            suffix: 'dc=b,dc=example,dc=com',
            capabilities: {controls: [OID]},
            search: () => [{dn: 'dc=b,dc=example,dc=com', attributes: {objectClass: 'domain', dc: 'b'}}]
        })], access: {admins: [ADMIN]}})
        const owner: LDAPInProcessConnection = mixed.connect({as: ADMIN})
        await owner.add('dc=a,dc=example,dc=com', {objectClass: 'domain', dc: 'a'})
        const critical = [{oid: OID, critical: true}]
        assert.equal((await owner.search('dc=b,dc=example,dc=com', {scope: 'base', paged: false, controls: critical})).entries.length, 1)
        await assert.rejects(owner.search('dc=a,dc=example,dc=com', {scope: 'base', paged: false, controls: critical}), code(12))
        await assert.rejects(owner.modify('dc=a,dc=example,dc=com', {operation: 'replace', attribute: 'description', values: 'x'}, {controls: critical}), code(12))
        //Every write and the compare as well
        await assert.rejects(owner.add('dc=c,dc=a,dc=example,dc=com', {objectClass: 'domain', dc: 'c'}, {controls: critical}), code(12))
        await assert.rejects(owner.compare('dc=a,dc=example,dc=com', 'dc', 'a', {controls: critical}), code(12))
        await assert.rejects(owner.modifyDN('dc=a,dc=example,dc=com', 'dc=a', {controls: critical}), code(12))
        await assert.rejects(owner.delete('dc=a,dc=example,dc=com', {controls: critical}), code(12))
    })

    it('renames an entry within its backend only, the entry at its suffix keeping its DN', async () => {
        const {server: nested, admin: owner} = await directory({backends: [new MemoryBackend(BASE), new MemoryBackend(`ou=inner,${BASE}`)]})
        await owner.add(`ou=inner,${BASE}`, {objectClass: 'organizationalUnit', ou: 'inner'})
        //The entry at the suffix: out of every backend once renamed
        await assert.rejects(owner.modifyDN(BASE, 'dc=other'), code(71))
        await assert.rejects(owner.modifyDN(`ou=inner,${BASE}`, 'ou=renamed'), code(71))
        //At or below the suffix of another backend
        await assert.rejects(owner.modifyDN(`ou=groups,${BASE}`, 'ou=inner'), code(71))
        await assert.rejects(owner.modifyDN(`uid=user9,ou=people,${BASE}`, 'uid=user9', {newSuperior: `ou=inner,${BASE}`}), code(71))
        assert.equal((await nested.connect({as: ADMIN}).search(BASE, {scope: 'base'})).entries.length, 1)
        assert.equal((await owner.search(`uid=user9,ou=people,${BASE}`, {scope: 'base'})).entries.length, 1)
    })

    it('checks the entries of GroupPresentationPlugin as they are stored, not as it shows them', async () => {
        //Groups of unique names hidden from the users: a groupOfNames group, which the plugin also shows as one, is not
        const {server: presented} = await directory({plugins: [new GroupPresentationPlugin()], access: {admins: [ADMIN], check: (request: {operation: string, identity?: {toString(): string}, entry?: DirectoryEntry}): boolean | undefined => request.operation === 'read' && String(request.identity) !== ADMIN && request.entry?.attributes.some((attribute) => attribute.type.toLowerCase() === 'objectclass' && attribute.values.some((value: Buffer) => value.toString().toLowerCase() === 'groupofuniquenames')) ? false : undefined}})
        const reader: LDAPInProcessConnection = presented.connect()
        await reader.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        const found = await reader.search(`ou=groups,${BASE}`, {scope: 'one', filter: '(cn=developers)'})
        assert.deepEqual(found.entries.map((entry) => entry.dn), [`cn=developers,ou=groups,${BASE}`])
        assert.ok(found.entries[0].get('objectClass').some((value: string) => value.toLowerCase() === 'groupofuniquenames'))
    })

    it('checks a critical control of a backend on binds and extended operations too, and gives it to the write of a Password Modify', async () => {
        const OID: string = '1.3.6.1.4.1.99999.6'
        const seen: string[][] = []
        class Listing extends MemoryBackend {
            public readonly capabilities = {controls: [OID]}

            public async modify(context: WriteContext, dn: DN, changes: Parameters<MemoryBackend['modify']>[2]): Promise<void> {
                seen.push(context.controls.map((control) => control.oid))
                return super.modify(context, dn, changes)
            }
        }
        const mixed: LDAPServerEngine = createLDAPServer({backends: [new MemoryBackend('dc=a,dc=example,dc=com'), new Listing('dc=b,dc=example,dc=com')], access: {admins: [ADMIN]}, passwords: {iterations: 1000}})
        const owner: LDAPInProcessConnection = mixed.connect({as: ADMIN})
        for (const name of ['a', 'b']) {
            await owner.add(`dc=${name},dc=example,dc=com`, {objectClass: 'domain', dc: name})
            await owner.add(`uid=u,dc=${name},dc=example,dc=com`, {objectClass: ['account', 'simpleSecurityObject'], uid: 'u', userPassword: 'secret-u'})
        }
        const critical = [{oid: OID, critical: true}]
        //A bind and a Password Modify on the backend listing it: taken, the write of the Password Modify given it
        await mixed.connect().bind('uid=u,dc=b,dc=example,dc=com', 'secret-u', {controls: critical})
        seen.length = 0
        await owner.passwordModify({userIdentity: 'uid=u,dc=b,dc=example,dc=com', newPassword: 'changed-u', controls: critical})
        assert.ok(seen.some((oids) => oids.includes(OID)))
        //On the other backend, and on an extended operation no backend runs: refused
        await assert.rejects(mixed.connect().bind('uid=u,dc=a,dc=example,dc=com', 'secret-u', {controls: critical}), code(12))
        await assert.rejects(owner.passwordModify({userIdentity: 'uid=u,dc=a,dc=example,dc=com', newPassword: 'changed-u', controls: critical}), code(12))
        await assert.rejects(owner.whoAmI({controls: critical}), code(12))
        //An extended operation of one's own reaches no backend either
        const extending: LDAPServerEngine = createLDAPServer({backends: [new Listing('dc=b,dc=example,dc=com')], access: {admins: [ADMIN]}, extendedOperations: {'1.3.6.1.4.1.99999.22': () => ({resultCode: 0})}})
        await assert.rejects(extending.connect({as: ADMIN}).extended('1.3.6.1.4.1.99999.22', undefined, {controls: critical}), code(12))
        //A SASL PLAIN bind checks the backend of the DN it verifies the password of
        const plain = (dn: string, password: string): Buffer => Buffer.from(`\0dn:${dn}\0${password}`)
        await mixed.connect().saslBind('PLAIN', plain('uid=u,dc=b,dc=example,dc=com', 'changed-u'), {controls: critical})
        await assert.rejects(mixed.connect().saslBind('PLAIN', plain('uid=u,dc=a,dc=example,dc=com', 'secret-u'), {controls: critical}), code(12))
        //An anonymous bind reaches no backend
        await assert.rejects(mixed.connect().bind('', '', {controls: critical}), code(12))
        //A SASL exchange of several steps: each step checked, against the backend reached in the exchange so far
        const twoSteps = (name: string, verifyFirst: boolean) => ({
            name: name,
            requiresTLS: false,
            start: async (context: {state: Map<string, unknown>, verifyPassword: (dn: DN, password: Buffer) => Promise<boolean>}, credentials?: Buffer) => {
                const [dn, password] = String(credentials).split('\0')
                context.state.set('dn', dn)
                context.state.set('password', password)
                if (verifyFirst && !await context.verifyPassword(DN.parse(dn), Buffer.from(password))) throw new LDAPResultException(49, 'Invalid credentials')
                return {done: false, serverCredentials: Buffer.from('next')}
            },
            step: async (context: {state: Map<string, unknown>, verifyPassword: (dn: DN, password: Buffer) => Promise<boolean>}) => {
                const dn: string = String(context.state.get('dn'))
                if (!verifyFirst && !await context.verifyPassword(DN.parse(dn), Buffer.from(String(context.state.get('password'))))) throw new LDAPResultException(49, 'Invalid credentials')
                return {done: true, identity: DN.parse(dn)}
            }
        })
        let starts: number = 0
        const counted = {
            name: 'COUNTED',
            requiresTLS: false,
            start: async () => {
                starts++
                return {done: false, serverCredentials: Buffer.from('next')}
            },
            step: async () => ({done: true, identity: DN.parse('uid=u,dc=b,dc=example,dc=com')})
        }
        const stepping: LDAPServerEngine = createLDAPServer({backends: [new Listing('dc=b,dc=example,dc=com')], access: {admins: [ADMIN]}, passwords: {iterations: 1000}, sasl: [twoSteps('VERIFY-FIRST', true), twoSteps('VERIFY-LAST', false), counted]})
        await stepping.connect({as: ADMIN}).add('dc=b,dc=example,dc=com', {objectClass: 'domain', dc: 'b'})
        await stepping.connect({as: ADMIN}).add('uid=u,dc=b,dc=example,dc=com', {objectClass: ['account', 'simpleSecurityObject'], uid: 'u', userPassword: 'secret-u'})
        const credentials: Buffer = Buffer.from('uid=u,dc=b,dc=example,dc=com\0secret-u')
        //The password verified on the first step: the last step, which verifies none, is checked against that backend
        await stepping.connect().saslBind('VERIFY-FIRST', credentials, {controls: critical, step: () => Buffer.from('more')})
        //A first step reaching no backend yet: refused there
        await assert.rejects(stepping.connect().saslBind('VERIFY-LAST', credentials, {controls: critical, step: () => Buffer.from('more')}), code(12))
        //A step refused for its controls ends the exchange: the mechanism starts again on the next bind
        const resumed: LDAPInProcessConnection = stepping.connect()
        await assert.rejects(resumed.saslBind('COUNTED', Buffer.from('first')), LDAPUsageException)
        await assert.rejects(resumed.saslBind('COUNTED', Buffer.from('second'), {controls: critical}), code(12))
        await resumed.saslBind('COUNTED', Buffer.from('first'), {step: () => Buffer.from('second')})
        assert.equal(starts, 2)
        //Refused before the mechanism runs (a critical control the server does not know): the exchange ends too
        const again: LDAPInProcessConnection = stepping.connect()
        await assert.rejects(again.saslBind('COUNTED', Buffer.from('first')), LDAPUsageException)
        await assert.rejects(again.saslBind('COUNTED', Buffer.from('second'), {controls: [{oid: '1.2.3.4.5.6', critical: true}]}), code(12))
        await again.saslBind('COUNTED', Buffer.from('first'), {step: () => Buffer.from('second')})
        assert.equal(starts, 4)
        //A Password Modify refuses the control before it checks the old password
        await assert.rejects(owner.passwordModify({userIdentity: 'uid=u,dc=a,dc=example,dc=com', oldPassword: 'wrong-old', newPassword: 'changed-u', controls: critical}), code(12))
    })

    it('closes the entries of an interceptor whose iterator does not return a promise when it closes', async () => {
        let closed: boolean = false
        const {server: custom} = await directory({interceptors: [{name: 'custom', operations: ['search'], around: async (_context: unknown, _request: unknown, next: () => Promise<{entries?: AsyncIterable<DirectoryEntry>}>): Promise<unknown> => {
            const outcome = await next()
            const inner: AsyncIterator<DirectoryEntry> | undefined = outcome.entries?.[Symbol.asyncIterator]()
            return {...outcome, entries: inner && {[Symbol.asyncIterator]: () => ({
                next: (): Promise<IteratorResult<DirectoryEntry>> => inner.next(),
                return: (): IteratorResult<DirectoryEntry> => {
                    closed = true
                    return {done: true, value: undefined}
                }
            })}}
        }} as never]})
        const session: LDAPInProcessConnection = custom.connect()
        await session.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        const first = await session.search(`ou=people,${BASE}`, {scope: 'one', paged: false, controls: [PagedResultsControl.encode({size: 2, cookie: Buffer.alloc(0)})]})
        assert.ok(PagedResultsControl.decode(findControl(first.controls, PagedResultsControl)!).cookie.length)
        //The bind ends the paged search, closing its entries
        await session.bind(`uid=user2,ou=people,${BASE}`, 'password2')
        await new Promise<void>((resolve: () => void): void => void setImmediate(resolve))
        assert.equal(closed, true)
    })

    it('gives the values of an attribute by ranges, as Active Directory does for member;range=0-*', async () => {
        const {admin: owner} = await directory()
        const group: string = `cn=ranged,ou=groups,${BASE}`
        await owner.add(group, {objectClass: 'groupOfNames', cn: 'ranged', member: [1, 2, 3, 4, 5].map((index: number): string => `uid=user${index},ou=people,${BASE}`)})
        //As the server answers (the client reads the ranges to their end unless told not to)
        const asked = async (attributes: string[], typesOnly?: boolean): Promise<string[]> => (await owner.search(group, {scope: 'base', attributes: attributes, ranges: false, ...typesOnly ? {typesOnly} : {}})).entries[0].attributes.map((item) => `${item.type}:${item.values.length}`).sort()
        assert.deepEqual(await asked(['member;range=0-*']), ['member;range=0-*:5'])
        assert.deepEqual(await asked(['member;range=0-1']), ['member;range=0-1:2'])
        assert.deepEqual(await asked(['member;range=2-*']), ['member;range=2-*:3'])
        //The last value given: the end of the range is *
        assert.deepEqual(await asked(['member;range=3-10']), ['member;range=3-*:2'])
        assert.deepEqual(await asked(['member;range=4-4']), ['member;range=4-*:1'])
        //Past the last value: nothing
        assert.deepEqual(await asked(['member;range=9-*']), [])
        //With the attribute itself: the attribute whole, once (RFC 4511 §4.5.1.8: an attribute at most once)
        assert.deepEqual(await asked(['member', 'MEMBER;Range=0-0']), ['member:5'])
        assert.deepEqual(await asked(['*', 'member;range=0-1']).then((items) => items.filter((item) => item.startsWith('member'))), ['member:5'])
        //The same range asked twice, or by a supertype as well: once
        assert.deepEqual(await asked(['member;range=0-1', 'member;range=0-1']), ['member;range=0-1:2'])
        //Two ranges of one attribute: the first asked for (the attribute once)
        assert.deepEqual(await asked(['member;range=0-0', 'member;range=1-1']), ['member;range=0-0:1'])
        assert.deepEqual(await asked(['cn;range=0-*', 'name;range=0-*']), ['cn;range=0-*:1'])
        //Names only
        assert.deepEqual(await asked(['member;range=0-1'], true), ['member;range=0-1:0'])
        //Not a range: an option the entry does not have
        assert.deepEqual(await asked(['member;range=x']), [])
        //An end before the start: not a range of any value
        assert.deepEqual(await asked(['member;range=3-1']), [])
        //The client reads them to the end, under the attribute's own name, once when the attribute is asked for too
        assert.equal((await owner.search(group, {scope: 'base', attributes: ['member;range=0-1']})).entries[0].get('member').length, 5)
        for (const attributes of [['member', 'member;range=0-1'], ['*', 'member;range=0-1']]) assert.equal((await owner.search(group, {scope: 'base', attributes: attributes})).entries[0].get('member').length, 5, attributes.join(' '))
        //Types only: the attribute without its values, no range read after
        assert.deepEqual((await owner.search(group, {scope: 'base', attributes: ['member;range=0-1'], typesOnly: true})).entries[0].attributes.map((item) => [item.type, item.values.length]), [['member', 0]])
    })

    it('runs the chain of the backend for a SASL bind verifying a password, as for a simple bind, and checks the extended operations given', async () => {
        //The time of the bind kept for PLAIN too
        const {server: kept, admin: owner} = await directory({plugins: [new LastBindPlugin()]})
        await kept.connect().saslBind('PLAIN', Buffer.from(`\0dn:uid=user3,ou=people,${BASE}\0password3`))
        assert.ok((await owner.search(`uid=user3,ou=people,${BASE}`, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp'))
        //A wrong password: invalidCredentials, no time kept
        await assert.rejects(kept.connect().saslBind('PLAIN', Buffer.from(`\0dn:uid=user4,ou=people,${BASE}\0wrong`)), code(49))
        assert.equal((await owner.search(`uid=user4,ou=people,${BASE}`, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp'), undefined)
        //A bind an interceptor answers without checking the password: no time kept either, simple or PLAIN
        const {server: refusing, admin: refuser} = await directory({plugins: [new LastBindPlugin()], interceptors: [{name: 'refusing', operations: ['bind'], around: async () => ({resultCode: 53, diagnosticMessage: 'Not now'})} as never]})
        await assert.rejects(refusing.connect().bind(`uid=user5,ou=people,${BASE}`, 'anything'), code(53))
        await assert.rejects(refusing.connect().saslBind('PLAIN', Buffer.from(`\0dn:uid=user5,ou=people,${BASE}\0anything`)), code(53))
        assert.equal((await refuser.search(`uid=user5,ou=people,${BASE}`, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp'), undefined)
        //An extended operation that is not a function: refused at the start
        assert.throws(() => createLDAPServer({backends: [new MemoryBackend(BASE)], extendedOperations: {'1.3.6.1.4.1.99999.23': {handler: () => ({})} as never}}), LDAPUsageException)
    })

    it('fails a bind with the outcome an interceptor of its chain returns, simple or SASL PLAIN', async () => {
        //An interceptor answering for a user instead of throwing; another counting the checks that failed
        const failed: string[] = []
        const {server: answering} = await directory({interceptors: [{name: 'answering', operations: ['bind'], around: async (_context: unknown, request: {type: string, dn?: DN, authentication: {type: string}}, next: () => Promise<{resultCode: number}>) => {
            try {
                const outcome = await next()
                return request.dn?.toString().startsWith('uid=user5,') ? {resultCode: 50, diagnosticMessage: 'Not this one'} : outcome
            } catch (error) {
                failed.push(request.authentication.type)
                throw error
            }
        }} as never]})
        await assert.rejects(answering.connect().bind(`uid=user5,ou=people,${BASE}`, 'password5'), code(50))
        await assert.rejects(answering.connect().saslBind('PLAIN', Buffer.from(`\0dn:uid=user5,ou=people,${BASE}\0password5`)), code(50))
        await answering.connect().bind(`uid=user6,ou=people,${BASE}`, 'password6')
        //A wrong password, by either: seen by the interceptor around its check
        await assert.rejects(answering.connect().bind(`uid=user6,ou=people,${BASE}`, 'wrong'), code(49))
        await assert.rejects(answering.connect().saslBind('PLAIN', Buffer.from(`\0dn:uid=user6,ou=people,${BASE}\0wrong`)), code(49))
        assert.deepEqual(failed, ['simple', 'sasl'])
        //Its answer whole on PLAIN too: its message with invalidCredentials
        const {server: holding} = await directory({interceptors: [{name: 'holding', operations: ['bind'], around: async () => ({resultCode: 49, diagnosticMessage: 'Held back for review'})} as never]})
        await assert.rejects(holding.connect().saslBind('PLAIN', Buffer.from(`\0dn:uid=user6,ou=people,${BASE}\0password6`)), (error: unknown) => error instanceof LDAPResultException && error.code === 49 && error.diagnosticMessage === 'Held back for review')
        //Thrown too: its message reaches the PLAIN client; a wrong password, or a refusal of the password policy, as the
        //server says it (the answer of a locked account unchanged)
        const {server: throwing} = await directory({interceptors: [{name: 'throwing', operations: ['bind'], around: async () => {
            throw new LDAPInvalidCredentialsException('Held back for review')
        }} as never]})
        await assert.rejects(throwing.connect().saslBind('PLAIN', Buffer.from(`\0dn:uid=user6,ou=people,${BASE}\0password6`)), (error: unknown) => error instanceof LDAPResultException && error.code === 49 && error.diagnosticMessage === 'Held back for review')
        await assert.rejects(answering.connect().saslBind('PLAIN', Buffer.from(`\0dn:uid=user7,ou=people,${BASE}\0wrong`)), (error: unknown) => error instanceof LDAPResultException && error.code === 49 && error.diagnosticMessage === 'Invalid credentials')
    })

    it('binds only when the password was checked and the chain answers success: what a bind interceptor or a plugin does, simple and SASL PLAIN, with the time of the bind kept or not', async () => {
        const TARGET: string = `uid=user10,ou=people,${BASE}`
        const NO_ANSWER: RegExp = /gave no answer/
        const UNCHECKED: RegExp = /answered success without the password checked/
        //What an around() of the application does for the target, the password sent, the answer of the bind
        const rows: {name: string, password: string, around: (next: () => Promise<unknown>) => Promise<unknown>, code: number, message?: RegExp}[] = [
            {name: 'returns the outcome of next()', password: 'password10', around: (next) => next(), code: 0},
            {name: 'returns the outcome of next(), the password wrong', password: 'wrong', around: (next) => next(), code: 49},
            {name: 'calls next(), then answers a success of its own', password: 'password10', around: async (next) => {
                await next()
                return {resultCode: 0, diagnosticMessage: 'Welcome'}
            }, code: 0},
            {name: 'answers a refusal without next()', password: 'password10', around: async () => ({resultCode: 53}), code: 53},
            {name: 'answers success without next()', password: 'wrong', around: async () => ({resultCode: 0}), code: 80, message: UNCHECKED},
            {name: 'swallows the rejection of next() and answers success', password: 'wrong', around: (next) => next().catch(() => ({resultCode: 0})), code: 80, message: UNCHECKED},
            {name: 'returns nothing without next()', password: 'wrong', around: async () => undefined, code: 80, message: NO_ANSWER},
            {name: 'returns {} without next()', password: 'wrong', around: async () => ({}), code: 80, message: NO_ANSWER},
            {name: 'returns null without next()', password: 'wrong', around: async () => null, code: 80, message: NO_ANSWER},
            //An answer no bind has: in progress (a step of SASL is the mechanism's), or no result code there is
            {name: 'answers saslBindInProgress without next()', password: 'wrong', around: async () => ({resultCode: 14}), code: 80, message: NO_ANSWER},
            {name: 'answers saslBindInProgress after next()', password: 'password10', around: async (next) => {
                await next()
                return {resultCode: 14}
            }, code: 80, message: NO_ANSWER},
            {name: 'answers a negative result code', password: 'wrong', around: async () => ({resultCode: -1}), code: 80, message: NO_ANSWER},
            {name: 'calls next() and returns nothing', password: 'password10', around: async (next) => {
                await next()
            }, code: 80, message: NO_ANSWER},
            {name: 'swallows the rejection of next() and returns nothing', password: 'wrong', around: async (next) => {
                await next().catch(() => undefined)
            }, code: 80, message: NO_ANSWER},
            {name: 'throws a result', password: 'password10', around: async () => {
                throw new LDAPUnwillingToPerformException('Not now')
            }, code: 53}
        ]
        const answerOf = (binding: Promise<unknown>): Promise<{code: number, message: string}> => binding.then(() => ({code: 0, message: ''}), (error: unknown) => error instanceof LDAPResultException ? {code: error.code, message: error.diagnosticMessage} : {code: -1, message: String(error)})
        //Every cell checked, those answering otherwise listed
        const wrong: string[] = []
        for (const lastBind of [false, true]) {
            for (const row of rows) {
                for (const sasl of [false, true]) {
                    const label: string = `${row.name}, ${sasl ? 'PLAIN' : 'simple'}${lastBind ? ', LastBindPlugin' : ''}`
                    const {server: engine, admin: owner} = await directory({
                        ...lastBind ? {plugins: [new LastBindPlugin()]} : {},
                        interceptors: [{name: 'application', operations: ['bind'], around: (_context: unknown, request: {dn?: DN}, next: () => Promise<unknown>) => request.dn?.toString().startsWith('uid=user10,') ? row.around(next) : next()} as never]
                    })
                    const errors: unknown[] = []
                    engine.events.on('error', (error: unknown) => errors.push(error))
                    //A session bound before, which a failed bind leaves anonymous
                    const client: LDAPInProcessConnection = engine.connect()
                    await client.bind(`uid=user20,ou=people,${BASE}`, 'password20')
                    const answer: {code: number, message: string} = await answerOf(sasl ? client.saslBind('PLAIN', Buffer.from(`\0dn:${TARGET}\0${row.password}`)) : client.bind(TARGET, row.password))
                    const identity: string = await client.whoAmI()
                    const kept: boolean | undefined = lastBind ? (await owner.search(TARGET, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp') !== undefined : undefined
                    if (answer.code !== row.code || (row.message && !row.message.test(answer.message)) || identity !== (row.code ? '' : `dn:${TARGET}`) || (lastBind && kept !== !row.code) || errors.length) wrong.push(`${label}: ${answer.code} ${answer.message}, ${identity || 'anonymous'}${lastBind ? kept ? ', time kept' : ', no time' : ''}${errors.length ? `, ${errors.length} error events` : ''}`)
                }
            }
        }
        assert.deepEqual(wrong, [])
        //Placed outside the plugin's interceptor: one calling next() and returning nothing fails the bind, no time kept
        //(the plugin keeps it once the bind succeeds); one answering success without next() keeps no time either
        const plugin: LastBindPlugin = new LastBindPlugin()
        const {server: outside, admin: keeper} = await directory({plugins: [plugin], interceptors: [{interceptor: {name: 'application', operations: ['bind'], around: async (_context: unknown, request: {dn?: DN}, next: () => Promise<unknown>) => {
            if (request.dn?.toString().startsWith('uid=user11,')) return {resultCode: 0}
            await next()
        }}, before: plugin.name} as never]})
        await assert.rejects(outside.connect().bind(TARGET, 'password10'), code(80))
        assert.equal((await keeper.search(TARGET, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp'), undefined)
        await assert.rejects(outside.connect().bind(`uid=user11,ou=people,${BASE}`, 'wrong'), code(80))
        assert.equal((await keeper.search(`uid=user11,ou=people,${BASE}`, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp'), undefined)
        //A plugin's authenticate() returning without verify(), or swallowing its rejection, or an outer one skipping an
        //inner one that calls it: refused
        const PLUGIN: RegExp = /authenticate\(\) returned without its verify\(\) succeeding/
        for (const [name, plugins, password] of [
            ['returning without verify()', [{name: 'trusting', authenticate: async () => undefined}], 'password10'],
            ['swallowing the rejection of verify()', [{name: 'swallowing', authenticate: async (_context: unknown, _bind: unknown, verify: () => Promise<void>) => verify().catch(() => undefined)}], 'wrong'],
            ['skipping an inner one', [{name: 'outer', authenticate: async () => undefined}, {name: 'inner', authenticate: async (_context: unknown, _bind: unknown, verify: () => Promise<void>) => verify()}], 'password10']
        ] as [string, unknown[], string][]) {
            const {server: engine} = await directory({plugins: plugins as never})
            for (const sasl of [false, true]) {
                const client: LDAPInProcessConnection = engine.connect()
                const answer: {code: number, message: string} = await answerOf(sasl ? client.saslBind('PLAIN', Buffer.from(`\0dn:${TARGET}\0${password}`)) : client.bind(TARGET, password))
                assert.equal(answer.code, 80, `${name}, ${sasl ? 'PLAIN' : 'simple'}`)
                assert.match(answer.message, PLUGIN)
                assert.equal(await client.whoAmI(), '')
            }
        }
        //A plugin around the request answering a bind with success the server did not give: refused, the session left
        //anonymous (one bound before too), no bind event; so too an interceptor throwing a result of success, and a
        //plugin turning a step in progress into success
        const binds: string[] = []
        const answering = {name: 'answering', aroundRequest: async (_context: unknown, request: {type: string, name?: string}, next: () => Promise<{resultCode: number}>) => {
            if (request.type === 'bindRequest' && request.name === TARGET) return {resultCode: 0}
            const outcome = await next()
            return request.type === 'bindRequest' && outcome.resultCode === 14 ? {resultCode: 0} : outcome
        }}
        const stepping = {name: 'STEPPING', requiresTLS: false, start: async () => ({done: false, serverCredentials: Buffer.from('next')}), step: async () => ({done: true, identity: DN.parse(TARGET)})}
        const {server: overstepping} = await directory({plugins: [answering] as never, sasl: [stepping] as never})
        overstepping.events.on('bind', (event: {dn: string}) => binds.push(event.dn))
        const before: LDAPInProcessConnection = overstepping.connect()
        await before.bind(`uid=user20,ou=people,${BASE}`, 'password20')
        await assert.rejects(before.bind(TARGET, 'wrong'), code(80))
        assert.equal(await before.whoAmI(), '')
        await assert.rejects(overstepping.connect().saslBind('STEPPING', Buffer.from('first'), {step: () => Buffer.from('second')}), code(80))
        //(bound as itself, the plugin letting it through)
        await overstepping.connect().bind(`uid=user21,ou=people,${BASE}`, 'password21')
        assert.deepEqual(binds, [`uid=user20,ou=people,${BASE}`, `uid=user21,ou=people,${BASE}`])
        const {server: throwingSuccess} = await directory({interceptors: [{name: 'odd', operations: ['bind'], around: async () => {
            throw new LDAPResultException(0, 'Odd')
        }}] as never})
        const odd: LDAPInProcessConnection = throwingSuccess.connect()
        await assert.rejects(odd.bind(TARGET, 'wrong'), code(80))
        assert.equal(await odd.whoAmI(), '')
        //A plugin calling verify() more than once: the last call counts (a retry after a refusal binds; a refusal of the
        //last call swallowed after one that returned does not)
        const flaky = (refusedCall: number) => {
            let calls: number = 0
            return {name: 'flaky', authenticate: async (_context: unknown, _bind: unknown, verify: () => Promise<void>) => {
                await verify()
                if (++calls === refusedCall) throw new LDAPUnwillingToPerformException('Not now')
            }}
        }
        const {server: retrying} = await directory({plugins: [{name: 'retrying', authenticate: async (_context: unknown, _bind: unknown, verify: () => Promise<void>) => {
            await verify().catch(() => undefined)
            await verify()
        }}, flaky(1)] as never})
        await retrying.connect().bind(TARGET, 'password10')
        const {server: lastSwallowed} = await directory({plugins: [{name: 'swallowing-last', authenticate: async (_context: unknown, _bind: unknown, verify: () => Promise<void>) => {
            await verify()
            await verify().catch(() => undefined)
        }}, flaky(2)] as never})
        await assert.rejects(lastSwallowed.connect().bind(TARGET, 'password10'), code(80))
        //(one returning while a call it made is still running: refused too)
        const {server: unawaited} = await directory({plugins: [{name: 'not-awaiting', authenticate: async (_context: unknown, _bind: unknown, verify: () => Promise<void>) => {
            await verify()
            void verify().catch(() => undefined)
        }}, flaky(2)] as never})
        await assert.rejects(unawaited.connect().bind(TARGET, 'password10'), code(80))
        //An outer plugin catching what an inner hook threw once verify() had returned (the password policy refusing a
        //locked account, its right password; a plugin refusing): refused, no time kept; one awaiting verify() and
        //returning: bound, a wrong password refused for itself
        const catching = {name: 'catching', authenticate: async (_context: unknown, _bind: unknown, verify: () => Promise<void>) => verify().catch(() => undefined)}
        const GUARD: string = `cn=default,ou=policies,${BASE}`
        const guardedBy = async (plugins: unknown[]): Promise<{server: LDAPServerEngine, admin: LDAPInProcessConnection}> => {
            const made = await directory({schema: [...DEFAULTS, PPOLICY], passwordPolicy: {default: GUARD}, plugins: plugins as never})
            await made.admin.add(`ou=policies,${BASE}`, {objectClass: 'organizationalUnit', ou: 'policies'})
            await made.admin.add(GUARD, {objectClass: ['organizationalRole', 'pwdPolicy'], cn: 'default', pwdAttribute: 'userPassword', pwdLockout: 'TRUE'})
            return made
        }
        const {server: guarded, admin: guard} = await guardedBy([catching, new LastBindPlugin()])
        await guard.modify(TARGET, {operation: 'add', attribute: 'pwdAccountLockedTime', values: '000001010000Z'})
        const {server: layered} = await directory({plugins: [catching, {name: 'refusing', authenticate: async (_context: unknown, _bind: unknown, verify: () => Promise<void>) => {
            await verify()
            throw new LDAPUnwillingToPerformException('Not now')
        }}] as never})
        for (const [name, engine] of [['the password policy refusing a locked account', guarded], ['an inner plugin refusing', layered]] as [string, LDAPServerEngine][]) {
            for (const sasl of [false, true]) {
                const client: LDAPInProcessConnection = engine.connect()
                const answer: {code: number, message: string} = await answerOf(sasl ? client.saslBind('PLAIN', Buffer.from(`\0dn:${TARGET}\0password10`)) : client.bind(TARGET, 'password10'))
                assert.equal(answer.code, 80, `${name}, ${sasl ? 'PLAIN' : 'simple'}: ${answer.message}`)
                assert.match(answer.message, PLUGIN)
                assert.equal(await client.whoAmI(), '')
            }
        }
        assert.equal((await guard.search(TARGET, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp'), undefined)
        const {server: awaited} = await guardedBy([{name: 'awaiting', authenticate: async (_context: unknown, _bind: unknown, verify: () => Promise<void>) => {
            await verify()
        }}])
        for (const sasl of [false, true]) {
            await (sasl ? awaited.connect().saslBind('PLAIN', Buffer.from(`\0dn:uid=user11,ou=people,${BASE}\0password11`)) : awaited.connect().bind(`uid=user11,ou=people,${BASE}`, 'password11'))
            await assert.rejects(sasl ? awaited.connect().saslBind('PLAIN', Buffer.from(`\0dn:uid=user11,ou=people,${BASE}\0wrong`)) : awaited.connect().bind(`uid=user11,ou=people,${BASE}`, 'wrong'), code(49))
        }
        //An interceptor swallowing the refusal of the password policy (a locked account, its right password) or of the
        //bind throttle (the DN locked after its failures), and answering success: refused
        const swallowing = {name: 'swallowing', operations: ['bind'], around: (_context: unknown, _request: unknown, next: () => Promise<unknown>) => next().catch(() => ({resultCode: 0}))}
        const POLICY: string = `cn=default,ou=policies,${BASE}`
        const {server: policed, admin: officer} = await directory({schema: [...DEFAULTS, PPOLICY], passwordPolicy: {default: POLICY}, interceptors: [swallowing as never]})
        await officer.add(`ou=policies,${BASE}`, {objectClass: 'organizationalUnit', ou: 'policies'})
        await officer.add(POLICY, {objectClass: ['organizationalRole', 'pwdPolicy'], cn: 'default', pwdAttribute: 'userPassword', pwdLockout: 'TRUE'})
        await policed.connect().bind(TARGET, 'password10')
        await officer.modify(TARGET, {operation: 'add', attribute: 'pwdAccountLockedTime', values: '000001010000Z'})
        await assert.rejects(policed.connect().bind(TARGET, 'password10'), code(80))
        const {server: throttled} = await directory({bindThrottle: {maxFailures: 3, ipMaxFailures: 0, delay: 0}, interceptors: [swallowing as never]})
        await throttled.connect().bind(TARGET, 'password10')
        for (let index: number = 0; index < 3; index++) await assert.rejects(throttled.connect().bind(TARGET, `wrong-${index}`), code(80))
        await assert.rejects(throttled.connect().bind(TARGET, 'password10'), code(80))
        //An outer interceptor answering success where an inner one refused, the password checked: bound (the outer decides)
        const {server: overruling} = await directory({interceptors: [
            {name: 'overruling', operations: ['bind'], around: async (_context: unknown, _request: unknown, next: () => Promise<{resultCode: number}>) => {
                const outcome: {resultCode: number} = await next()
                return outcome.resultCode === 53 ? {resultCode: 0} : outcome
            }},
            {name: 'refusing', operations: ['bind'], around: async (_context: unknown, _request: unknown, next: () => Promise<unknown>) => {
                await next()
                return {resultCode: 53}
            }}
        ] as never})
        const overruled: LDAPInProcessConnection = overruling.connect()
        await overruled.bind(TARGET, 'password10')
        assert.equal(await overruled.whoAmI(), `dn:${TARGET}`)
    })

    it('binds an administrator by the password its options give, with no entry, whatever an entry at its DN holds', async () => {
        const ROOT: string = 'cn=root,o=configuration'
        const BOSS: string = `cn=boss,${BASE}`
        const POLICY: string = `cn=default,ou=policies,${BASE}`
        const errors: unknown[] = []
        const hashed: string = await new PasswordSchemes({iterations: 1000}).hash('boss-secret')
        const {server: rooted, admin: owner} = await directory({
            schema: [...DEFAULTS, PPOLICY],
            access: {admins: [ADMIN, ROOT, BOSS], adminPasswords: {[ROOT]: 'root-secret', [BOSS.toUpperCase()]: hashed}},
            passwordPolicy: {default: POLICY},
            plugins: [new LastBindPlugin()],
            bindThrottle: {maxFailures: 3, ipMaxFailures: 0, delay: 0}
        })
        rooted.events.on('error', (error: unknown) => errors.push(error))
        //A DN in no backend: bound, an administrator
        const root: LDAPInProcessConnection = rooted.connect()
        await root.bind(ROOT, 'root-secret')
        assert.equal(await root.whoAmI(), `dn:${ROOT}`)
        await root.add(`cn=by-root,${BASE}`, {objectClass: 'device', cn: 'by-root'})
        await rooted.connect().saslBind('PLAIN', Buffer.from(`\0dn:${ROOT}\0root-secret`))
        await assert.rejects(rooted.connect().bind(ROOT, 'wrong'), code(49))
        //An entry at the DN, locked under a policy that wants its password changed, with a password of its own: only the
        //password of the options opens it, the policy left out
        await owner.add(`ou=policies,${BASE}`, {objectClass: 'organizationalUnit', ou: 'policies'})
        await owner.add(POLICY, {objectClass: ['organizationalRole', 'pwdPolicy'], cn: 'default', pwdAttribute: 'userPassword', pwdMustChange: 'TRUE', pwdLockout: 'TRUE'})
        await owner.add(BOSS, {objectClass: ['organizationalRole', 'simpleSecurityObject'], cn: 'boss', userPassword: 'entry-password'})
        //(set by the administrator's add under pwdMustChange: pwdReset)
        await owner.modify(BOSS, {operation: 'add', attribute: 'pwdAccountLockedTime', values: '000001010000Z'})
        //(the lock refuses an account the options give no password: its right password too)
        await owner.add(`cn=locked,${BASE}`, {objectClass: ['organizationalRole', 'simpleSecurityObject'], cn: 'locked', userPassword: 'locked-password'})
        await owner.modify(`cn=locked,${BASE}`, {operation: 'add', attribute: 'pwdAccountLockedTime', values: '000001010000Z'})
        await assert.rejects(rooted.connect().bind(`cn=locked,${BASE}`, 'locked-password'), code(49))
        const boss: LDAPInProcessConnection = rooted.connect()
        await boss.bind(BOSS, 'boss-secret')
        await boss.modify(`cn=by-root,${BASE}`, {operation: 'replace', attribute: 'description', values: 'not held back'})
        await assert.rejects(rooted.connect().bind(BOSS, 'entry-password'), code(49))
        //A Password Modify of a password the options give is refused, by the administrator itself (a new password, one
        //generated, the old one given) or by another (the password is changed in the options); refused for access first
        //to a session not allowed to change it, which does not learn the DN has one
        await assert.rejects(boss.passwordModify({newPassword: 'new-entry-password'}), code(53))
        await assert.rejects(boss.passwordModify({}), code(53))
        await assert.rejects(boss.passwordModify({oldPassword: 'boss-secret', newPassword: 'new-entry-password'}), code(53))
        await assert.rejects(owner.passwordModify({userIdentity: BOSS, newPassword: 'new-entry-password'}), code(53))
        await assert.rejects(root.passwordModify({newPassword: 'no-entry-to-hold-it'}), code(53))
        const user: LDAPInProcessConnection = rooted.connect()
        await user.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        await assert.rejects(user.passwordModify({userIdentity: BOSS, newPassword: 'new-entry-password'}), code(50))
        //A write of the entry's userPassword is taken, and does not change the password of the options
        await owner.modify(BOSS, {operation: 'replace', attribute: 'userPassword', values: 'written-entry-password'})
        await rooted.connect().bind(BOSS, 'boss-secret')
        await assert.rejects(rooted.connect().bind(BOSS, 'written-entry-password'), code(49))
        //The throttle still counts: locked after its failures, the right password too
        for (let index: number = 0; index < 3; index++) await assert.rejects(rooted.connect().bind(ROOT, `wrong-${index}`), code(49))
        await assert.rejects(rooted.connect().bind(ROOT, 'root-secret'), code(49))
        assert.deepEqual(errors, [])
        //A DN not among the administrators, or an empty password: refused at the start
        assert.throws(() => createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ADMIN], adminPasswords: {[ROOT]: 'x'}}}), LDAPUsageException)
        assert.throws(() => createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ROOT], adminPasswords: {[ROOT]: ''}}}), LDAPUsageException)
        //{ARGON2} of the server's own scheme where node:crypto does not run argon2 (Electron, Node.js before 24.7): refused,
        //as it could never bind; taken where it runs, and where an application registered its own ARGON2
        const argon2Value: string = '{ARGON2}$argon2id$v=19$m=65536,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g'
        const argon2Options = {backends: [new MemoryBackend(BASE)], access: {admins: [ROOT], adminPasswords: {[ROOT]: argon2Value}}}
        if (argon2Function()) createLDAPServer(argon2Options)
        else assert.throws(() => createLDAPServer(argon2Options), (error: unknown) => error instanceof LDAPUsageException && /argon2/i.test(error.message))
        createLDAPServer({...argon2Options, passwords: new PasswordSchemes({iterations: 1000}).register({name: 'ARGON2', verify: async () => false})})
        //One DN given twice (its case, its spaces): refused, not the last one taken
        assert.throws(() => createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ROOT], adminPasswords: {[ROOT]: 'first', [ROOT.toUpperCase().replace(',', ', ')]: 'second'}}}), LDAPUsageException)
        //A scheme the server does not have, or a mistyped one: refused too, not compared as it is (its text the password)
        //A hash without its {SCHEME} (a bare crypt or argon2 value), or a {SCHEME} after blanks: refused too, the text of
        //the hash not the password
        for (const value of ['$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234', '$2y$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234', '$6$salt$abcdefghij', '$5$rounds=5000$salt$abc', '$1$salt$abc', '$y$j9T$salt$abc', '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA', ' {PBKDF2-SHA512}1000$x$y', '\t{SSHA}abcd']) assert.throws(() => createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ROOT], adminPasswords: {[ROOT]: value}}}), LDAPUsageException, JSON.stringify(value))
        //The message names the scheme that verifies the hash, none for a hash the server's schemes do not verify, and
        //shows nothing of the value
        const refusal = (value: string): string => {
            try {
                createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ROOT], adminPasswords: {[ROOT]: value}}})
            } catch (error) {
                return (error as Error).message
            }
            return ''
        }
        for (const [value, scheme] of [['$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234', '{CRYPT}'], ['$6$salt$abcdefghij', '{CRYPT}'], ['$1$salt$abc', '{CRYPT}'], ['$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA', '{ARGON2}'], ['$7$abcdefgh', undefined], ['$y$j9T$salt$abc', undefined], ['$gy$j9T$salt$abc', undefined], ['$2x$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234', undefined]] as [string, string | undefined][]) {
            const message: string = refusal(value)
            assert.ok(message, value)
            assert.ok(!message.includes(value.slice(0, 3)), `${value}: ${message}`)
            if (scheme) assert.ok(message.includes(scheme), `${value}: ${message}`)
            //(argon2 as far as node:crypto has it; for the others, the schemes the server comes with, not one an
            //application registers)
            if (scheme === '{ARGON2}') assert.ok(message.includes('node:crypto'), `${value}: ${message}`)
            if (!scheme) assert.ok(!message.includes('{CRYPT}') && !message.includes('{ARGON2}') && /own schemes do not verify/.test(message), `${value}: ${message}`)
        }
        for (const value of ['{BCRYPT}$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234', '{SSHA_512}abcd', '{}abcd']) assert.throws(() => createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ROOT], adminPasswords: {[ROOT]: value}}}), LDAPUsageException, value)
        //A scheme registered with the server's schemes is taken
        createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ROOT], adminPasswords: {[ROOT]: '{OWN}secret'}}, passwords: new PasswordSchemes({iterations: 1000}).register({name: 'OWN', verify: async () => false})})
    })

    it('keeps the effects of a right password for a bind that succeeds: a bind refused after the check leaves none', async () => {
        const TARGET: string = `uid=user10,ou=people,${BASE}`
        const POLICY: string = `cn=default,ou=policies,${BASE}`
        const ASK = [PasswordPolicyRequestControl.encode()]
        const PPOLICY_RESPONSE: string = '1.3.6.1.4.1.42.2.27.8.5.1'
        const answerOf = (binding: Promise<unknown>): Promise<{code: number, controls: {oid: string}[]}> => binding.then((result: unknown) => ({code: 0, controls: (result as {controls?: {oid: string}[]}).controls ?? []}), (error: unknown) => error instanceof LDAPResultException ? {code: error.code, controls: (error as unknown as {controls?: {oid: string}[]}).controls ?? []} : {code: -1, controls: []})
        //A directory under a policy wanting a password an administrator set changed, the bind throttle locking at three
        //failures, the target's password set by the administrator and two wrong binds made
        const policed = async (options: Partial<Parameters<typeof createLDAPServer>[0]> = {}, rules: Record<string, string> = {pwdMustChange: 'TRUE'}): Promise<{server: LDAPServerEngine, admin: LDAPInProcessConnection, backend: MemoryBackend}> => {
            const made = await directory({schema: [...DEFAULTS, PPOLICY], passwordPolicy: {default: POLICY}, access: {admins: [ADMIN], anonymousRead: true}, bindThrottle: {maxFailures: 3, ipMaxFailures: 0, delay: 0}, ...options})
            await made.admin.add(`ou=policies,${BASE}`, {objectClass: 'organizationalUnit', ou: 'policies'})
            await made.admin.add(POLICY, {objectClass: ['organizationalRole', 'pwdPolicy'], cn: 'default', pwdAttribute: 'userPassword', ...rules})
            await made.admin.passwordModify({userIdentity: TARGET, newPassword: 'reset-password'})
            for (let index: number = 0; index < 2; index++) await assert.rejects(made.server.connect().bind(TARGET, `wrong-${index}`), code(49))
            return made
        }
        const state = async (owner: LDAPInProcessConnection): Promise<{lastSuccess: boolean, failures: number}> => {
            const entry = (await owner.search(TARGET, {scope: 'base', attributes: ['pwdLastSuccess', 'pwdFailureTime']})).entries[0]
            return {lastSuccess: entry.first('pwdLastSuccess') !== undefined, failures: entry.get('pwdFailureTime').length}
        }
        //Where a bind with the right password is refused after the check
        const refusals: [string, Partial<Parameters<typeof createLDAPServer>[0]>][] = [
            ['an interceptor answering 53 after next()', {interceptors: [{name: 'refusing', operations: ['bind'], around: async (_context: unknown, _request: unknown, next: () => Promise<unknown>) => {
                await next()
                return {resultCode: 53}
            }}] as never}],
            ['an interceptor throwing after next()', {interceptors: [{name: 'refusing', operations: ['bind'], around: async (_context: unknown, _request: unknown, next: () => Promise<unknown>) => {
                await next()
                throw new LDAPUnwillingToPerformException('Not now')
            }}] as never}],
            ['a plugin throwing after verify()', {plugins: [{name: 'refusing', authenticate: async (_context: unknown, _bind: unknown, verify: () => Promise<void>) => {
                await verify()
                throw new LDAPUnwillingToPerformException('Not now')
            }}] as never}],
            ['a plugin answering 53 after next() around the request', {plugins: [{name: 'refusing', aroundRequest: async (_context: unknown, request: {type: string}, next: () => Promise<unknown>) => {
                const outcome: unknown = await next()
                return request.type === 'bindRequest' ? {resultCode: 53} : outcome
            }}] as never}]
        ]
        const wrong: string[] = []
        for (const [name, options] of refusals) {
            for (const sasl of [false, true]) {
                const label: string = `${name}, ${sasl ? 'PLAIN' : 'simple'}`
                //(LastBindPlugin there too: the time of the bind is among the effects)
                const {server: engine, admin: owner} = await policed({...options, plugins: [...(options as {plugins?: unknown[]}).plugins ?? [], new LastBindPlugin()]} as never)
                const told: string[] = []
                engine.events.on('bind', (event: {dn: string}) => told.push(event.dn))
                const client: LDAPInProcessConnection = engine.connect()
                const answer = await answerOf(sasl ? client.saslBind('PLAIN', Buffer.from(`\0dn:${TARGET}\0reset-password`), {controls: ASK}) : client.bind(TARGET, 'reset-password', {controls: ASK}))
                if (answer.code !== 53) wrong.push(`${label}: answered ${answer.code}`)
                if (told.length) wrong.push(`${label}: a bind event`)
                if (answer.controls.some((control) => control.oid === PPOLICY_RESPONSE)) wrong.push(`${label}: the warning of the policy`)
                //The session not held to change the password: its anonymous search answered
                const searched: number = await client.search(BASE, {scope: 'base'}).then(() => 0, (error: unknown) => error instanceof LDAPResultException ? error.code : -1)
                if (searched !== 0) wrong.push(`${label}: the session held to change the password (${searched})`)
                const after = await state(owner)
                if (after.lastSuccess) wrong.push(`${label}: pwdLastSuccess written`)
                if ((await owner.search(TARGET, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp')) wrong.push(`${label}: the time of the bind kept`)
                if (after.failures !== 2) wrong.push(`${label}: ${after.failures} failures kept`)
                //The throttle not told: one more failure locks the DN
                await assert.rejects(engine.connect().bind(TARGET, 'wrong-2'), code(49))
                const locked: number = await answerOf(engine.connect().bind(TARGET, 'reset-password')).then((outcome) => outcome.code)
                if (locked !== 49) wrong.push(`${label}: the throttle told (${locked} after one more failure)`)
            }
        }
        assert.deepEqual(wrong, [])
        //Along a SASL exchange checking the password at its first step: applied when the exchange completes, none when a
        //later step refuses it
        const checkThenAsk = {
            name: 'CHECK-THEN-ASK',
            requiresTLS: false,
            start: async (context: {state: Map<string, unknown>, verifyPassword: (dn: DN, password: Buffer) => Promise<boolean>}, credentials?: Buffer) => {
                const [dn, password] = String(credentials).split('\0')
                context.state.set('dn', dn)
                if (!await context.verifyPassword(DN.parse(dn), Buffer.from(password))) throw new LDAPResultException(49, 'Invalid credentials')
                return {done: false, serverCredentials: Buffer.from('next')}
            },
            step: async (context: {state: Map<string, unknown>}, credentials?: Buffer) => {
                if (String(credentials) === 'refuse') throw new LDAPUnwillingToPerformException('Not now')
                return {done: true, identity: DN.parse(String(context.state.get('dn')))}
            }
        }
        for (const [last, completes] of [['complete', true], ['refuse', false]] as [string, boolean][]) {
            const {server: exchanging, admin: watcher} = await policed({sasl: [checkThenAsk] as never})
            const exchanged: string[] = []
            exchanging.events.on('bind', (event: {dn: string}) => exchanged.push(event.dn))
            const outcome = await answerOf(exchanging.connect().saslBind('CHECK-THEN-ASK', Buffer.from(`${TARGET}\0reset-password`), {step: () => Buffer.from(last)}))
            assert.deepEqual(exchanged, completes ? [TARGET] : [], `${last}: the bind events`)
            assert.equal(outcome.code, completes ? 0 : 53, last)
            assert.deepEqual(await state(watcher), completes ? {lastSuccess: true, failures: 0} : {lastSuccess: false, failures: 2}, last)
        }
        //The throttle locking the DN between the steps (failures meanwhile): still locked once the exchange completes
        const {server: throttling} = await directory({sasl: [checkThenAsk] as never, bindThrottle: {maxFailures: 3, ipMaxFailures: 0, delay: 0}})
        await throttling.connect().saslBind('CHECK-THEN-ASK', Buffer.from(`${TARGET}\0password10`), {step: async () => {
            for (let index: number = 0; index < 3; index++) await assert.rejects(throttling.connect().bind(TARGET, `wrong-${index}`), code(49))
            return Buffer.from('complete')
        }})
        await assert.rejects(throttling.connect().bind(TARGET, 'password10'), code(49))
        //The time of the last bind along such an exchange: kept once it completes, none when its second step refuses
        for (const [last, completes] of [['complete', true], ['refuse', false]] as [string, boolean][]) {
            const {server: timed, admin: timer} = await directory({sasl: [checkThenAsk] as never, plugins: [new LastBindPlugin()]})
            await timed.connect().saslBind('CHECK-THEN-ASK', Buffer.from(`${TARGET}\0password10`), {step: () => Buffer.from(last)}).catch(() => undefined)
            assert.equal((await timer.search(TARGET, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp') !== undefined, completes, last)
        }
        //What is written between the steps stays once the exchange completes: a failure meanwhile, a lock an
        //administrator set (the failure first: a locked account records none)
        const {server: locking, admin: locker} = await policed({sasl: [checkThenAsk] as never}, {pwdLockout: 'TRUE'})
        await locking.connect().saslBind('CHECK-THEN-ASK', Buffer.from(`${TARGET}\0reset-password`), {step: async () => {
            await assert.rejects(locking.connect().bind(TARGET, 'wrong-between'), code(49))
            await locker.modify(TARGET, {operation: 'add', attribute: 'pwdAccountLockedTime', values: '000001010000Z'})
            return Buffer.from('complete')
        }})
        const between = (await locker.search(TARGET, {scope: 'base', attributes: ['pwdAccountLockedTime', 'pwdFailureTime', 'pwdLastSuccess']})).entries[0]
        assert.deepEqual([between.first('pwdAccountLockedTime'), between.get('pwdFailureTime').length, between.first('pwdLastSuccess') !== undefined], ['000001010000Z', 1, true])
        await assert.rejects(locking.connect().bind(TARGET, 'reset-password'), code(49))
        //Held to change its password at the end of the exchange, a user whose password an administrator set; not held, a
        //user whose password it is, or an exchange refused at its last step
        const {server: holding} = await policed({sasl: [checkThenAsk] as never})
        const held: LDAPInProcessConnection = holding.connect()
        const finished = await answerOf(held.saslBind('CHECK-THEN-ASK', Buffer.from(`${TARGET}\0reset-password`), {controls: ASK, step: () => Buffer.from('complete')}))
        assert.equal(finished.code, 0)
        assert.ok(finished.controls.some((control) => control.oid === PPOLICY_RESPONSE))
        await assert.rejects(held.search(BASE, {scope: 'base'}), code(50))
        const free: LDAPInProcessConnection = holding.connect()
        await free.saslBind('CHECK-THEN-ASK', Buffer.from(`uid=user11,ou=people,${BASE}\0password11`), {step: () => Buffer.from('complete')})
        await free.search(BASE, {scope: 'base'})
        const stopped: LDAPInProcessConnection = holding.connect()
        await assert.rejects(stopped.saslBind('CHECK-THEN-ASK', Buffer.from(`${TARGET}\0reset-password`), {step: () => Buffer.from('refuse')}), code(53))
        await stopped.search(BASE, {scope: 'base'})
        //A bind that succeeds: the warning, the session held to change the password, the state of a right password, the
        //throttle told
        const {server: plain, admin: keeper} = await policed()
        const bound: LDAPInProcessConnection = plain.connect()
        const answer = await answerOf(bound.bind(TARGET, 'reset-password', {controls: ASK}))
        assert.equal(answer.code, 0)
        assert.ok(answer.controls.some((control) => control.oid === PPOLICY_RESPONSE))
        await assert.rejects(bound.search(BASE, {scope: 'base'}), code(50))
        assert.deepEqual(await state(keeper), {lastSuccess: true, failures: 0})
        for (let index: number = 0; index < 2; index++) await assert.rejects(plain.connect().bind(TARGET, `again-${index}`), code(49))
        await plain.connect().bind(TARGET, 'reset-password')
        //A write of that state failing: the bind refused, the session anonymous
        let failing: boolean = false
        class Failing extends MemoryBackend {
            public async modify(...args: Parameters<MemoryBackend['modify']>): Promise<void> {
                if (failing && args[2].some((change) => change.attribute.type === 'pwdLastSuccess')) throw new Error('The write of the state failed')
                return super.modify(...args)
            }
        }
        //(a plugin adding a record before the rest of the bind: none made either)
        const records: string[] = []
        const recording = {name: 'recording', aroundRequest: async (context: OperationContext, request: {type: string}, next: () => Promise<unknown>) => {
            if (request.type === 'bindRequest') await afterBind(context, (): void => {
                records.push('made')
            })
            return next()
        }}
        const {server: broken, admin: brokenOwner} = await policed({backends: [new Failing(BASE)], plugins: [recording, new LastBindPlugin()] as never})
        const brokenBinds: string[] = []
        broken.events.on('bind', (event: {dn: string}) => brokenBinds.push(event.dn))
        const refused: LDAPInProcessConnection = broken.connect()
        failing = true
        await assert.rejects(refused.bind(TARGET, 'reset-password'), code(80))
        failing = false
        assert.equal(await refused.whoAmI(), '')
        assert.deepEqual(brokenBinds, [])
        assert.deepEqual(records, [])
        assert.equal((await brokenOwner.search(TARGET, {scope: 'base', attributes: ['authTimestamp']})).entries[0].first('authTimestamp'), undefined)
        //Told at once where no bind is: the old password of a Password Modify; an administrator of the options
        const {server: changing} = await directory({bindThrottle: {maxFailures: 3, ipMaxFailures: 0, delay: 0}})
        const self: LDAPInProcessConnection = changing.connect()
        await self.bind(TARGET, 'password10')
        for (let index: number = 0; index < 2; index++) await assert.rejects(changing.connect().bind(TARGET, `wrong-${index}`), code(49))
        await self.passwordModify({oldPassword: 'password10', newPassword: 'changed-password'})
        await assert.rejects(changing.connect().bind(TARGET, 'wrong-2'), code(49))
        await changing.connect().bind(TARGET, 'changed-password')
        const ROOT: string = 'cn=root,o=configuration'
        const {server: rooted} = await directory({access: {admins: [ADMIN, ROOT], adminPasswords: {[ROOT]: 'root-secret'}}, bindThrottle: {maxFailures: 3, ipMaxFailures: 0, delay: 0}})
        for (let round: number = 0; round < 2; round++) {
            for (let index: number = 0; index < 2; index++) await assert.rejects(rooted.connect().bind(ROOT, `wrong-${index}`), code(49))
            await rooted.connect().bind(ROOT, 'root-secret')
        }
        //Left as they are, decided where the policy checks the password: a grace bind refused after the check keeps its
        //grace use; an expired password with no grace bind left clears the failures as it is refused
        const expired = async (limit: string, options: Partial<Parameters<typeof createLDAPServer>[0]> = {}): Promise<{server: LDAPServerEngine, admin: LDAPInProcessConnection}> => {
            const made = await directory({schema: [...DEFAULTS, PPOLICY], passwordPolicy: {default: POLICY}, ...options})
            await made.admin.add(`ou=policies,${BASE}`, {objectClass: 'organizationalUnit', ou: 'policies'})
            await made.admin.add(POLICY, {objectClass: ['organizationalRole', 'pwdPolicy'], cn: 'default', pwdAttribute: 'userPassword', pwdMaxAge: '86400', pwdGraceAuthNLimit: limit})
            await made.backend.modify({schema: made.server.schema} as never, DN.parse(TARGET), [{operation: 'replace', attribute: {type: 'pwdChangedTime', values: [Buffer.from(formatGeneralizedTime(Date.now() - 90000 * 1000))]}}])
            return made
        }
        const {server: graced, admin: grader} = await expired('2', refusals[0][1])
        await assert.rejects(graced.connect().bind(TARGET, 'password10'), code(53))
        assert.equal((await grader.search(TARGET, {scope: 'base', attributes: ['pwdGraceUseTime']})).entries[0].get('pwdGraceUseTime').length, 1)
        const {server: spent, admin: spender} = await expired('0')
        await assert.rejects(spent.connect().bind(TARGET, 'wrong'), code(49))
        assert.equal((await spender.search(TARGET, {scope: 'base', attributes: ['pwdFailureTime']})).entries[0].get('pwdFailureTime').length, 1)
        await assert.rejects(spent.connect().bind(TARGET, 'password10'), code(49))
        assert.equal((await spender.search(TARGET, {scope: 'base', attributes: ['pwdFailureTime']})).entries[0].get('pwdFailureTime').length, 0)
    })

    it('applies what plugins add to a bind once it succeeds, in order, the bind event last', async () => {
        const TARGET: string = `uid=user10,ou=people,${BASE}`
        //A plugin adding a record before and after the rest of the bind; the bind events after them
        const made = async (options: Partial<Parameters<typeof createLDAPServer>[0]> = {}, failing: boolean = false) => {
            const log: string[] = []
            const errors: unknown[] = []
            const recording = {name: 'recording', aroundRequest: async (context: OperationContext, request: {type: string}, next: () => Promise<{resultCode: number}>) => {
                if (request.type !== 'bindRequest') return next()
                if (failing) await afterBind(context, (): void => {
                    throw new Error('A record failing')
                })
                await afterBind(context, (): void => {
                    log.push('before')
                })
                const outcome = await next()
                if (outcome.resultCode === 0) await afterBind(context, (): void => {
                    log.push('after')
                })
                return outcome
            }}
            const {server: engine} = await directory({...options, plugins: [recording, ...(options as {plugins?: unknown[]}).plugins ?? []] as never})
            engine.events.on('bind', () => log.push('event'))
            engine.events.on('error', (error: unknown) => errors.push(error))
            return {engine, log, errors}
        }
        const stepping = {name: 'STEPPING', requiresTLS: false, start: async () => ({done: false, serverCredentials: Buffer.from('next')}), step: async (_context: unknown, credentials?: Buffer) => {
            if (String(credentials) === 'refuse') throw new LDAPUnwillingToPerformException('Not now')
            return {done: true, identity: DN.parse(TARGET)}
        }}
        //Once each on a simple bind, by PLAIN, along an exchange of two steps (added at both): the event after them all
        for (const [name, bind, expected] of [
            ['simple', (client: LDAPInProcessConnection) => client.bind(TARGET, 'password10'), ['before', 'after', 'event']],
            ['PLAIN', (client: LDAPInProcessConnection) => client.saslBind('PLAIN', Buffer.from(`\0dn:${TARGET}\0password10`)), ['before', 'after', 'event']],
            ['two steps', (client: LDAPInProcessConnection) => client.saslBind('STEPPING', Buffer.from('first'), {step: () => Buffer.from('second')}), ['before', 'before', 'after', 'event']]
        ] as [string, (client: LDAPInProcessConnection) => Promise<unknown>, string[]][]) {
            const {engine, log} = await made({sasl: [plainMechanism(), stepping] as never})
            await bind(engine.connect())
            assert.deepEqual(log, expected, name)
        }
        //None for a bind refused, an exchange refused at its second step, one given up for another bind
        for (const [name, bind] of [
            ['a wrong password', (client: LDAPInProcessConnection) => client.bind(TARGET, 'wrong').catch(() => undefined)],
            ['an exchange refused', (client: LDAPInProcessConnection) => client.saslBind('STEPPING', Buffer.from('first'), {step: () => Buffer.from('refuse')}).catch(() => undefined)]
        ] as [string, (client: LDAPInProcessConnection) => Promise<unknown>][]) {
            const {engine, log} = await made({sasl: [plainMechanism(), stepping] as never})
            await bind(engine.connect())
            assert.deepEqual(log, [], name)
        }
        //An exchange given up after its first step, then a bind that succeeds: only that bind's records
        const {engine: givenUp, log: givenUpLog} = await made({sasl: [plainMechanism(), stepping] as never})
        const quitting: LDAPInProcessConnection = givenUp.connect()
        await quitting.saslBind('STEPPING', Buffer.from('first'), {step: async () => {
            throw new Error('Given up')
        }}).catch(() => undefined)
        await quitting.bind(TARGET, 'password10')
        assert.deepEqual(givenUpLog, ['before', 'after', 'event'])
        //A record failing: an error event, the bind done, the other records and the event still applied
        const {engine: recordFailing, log: failingLog, errors} = await made({}, true)
        const failed: LDAPInProcessConnection = recordFailing.connect()
        await failed.bind(TARGET, 'password10')
        assert.equal(await failed.whoAmI(), `dn:${TARGET}`)
        assert.deepEqual(failingLog, ['before', 'after', 'event'])
        assert.equal(errors.length, 1)
        //A listener of the bind event failing: the bind done, one error event
        const {engine: listened, errors: listenerErrors} = await made()
        listened.events.on('bind', () => {
            throw new Error('A listener failing')
        })
        const told: LDAPInProcessConnection = listened.connect()
        await told.bind(TARGET, 'password10')
        assert.equal(await told.whoAmI(), `dn:${TARGET}`)
        assert.equal(listenerErrors.length, 1)
    })

    it('lets a password administrator change the passwords of the others, not those of the administrators', async () => {
        const BOSS: string = `cn=boss,${BASE}`
        const CHIEF: string = `cn=chief,${BASE}`
        const ROOT: string = 'cn=root,o=configuration'
        const HELPDESK: string = `uid=user20,ou=people,${BASE}`
        const USER: string = `uid=user21,ou=people,${BASE}`
        const OTHER: string = `uid=user22,ou=people,${BASE}`
        const DESK: string = `uid=user23,ou=people,${BASE}`
        const {server: engine, admin: owner} = await directory({access: {admins: [ADMIN, BOSS, CHIEF, ROOT], passwordAdmins: [HELPDESK, DESK], adminPasswords: {[ROOT]: 'root-secret'}}})
        for (const dn of [BOSS, CHIEF]) await owner.add(dn, {objectClass: ['organizationalRole', 'simpleSecurityObject'], cn: dn.slice(3, dn.indexOf(',')), userPassword: `${dn.slice(3, dn.indexOf(','))}-password`})
        const bound = async (dn: string, password: string): Promise<LDAPInProcessConnection> => {
            const connection: LDAPInProcessConnection = engine.connect()
            await connection.bind(dn, password)
            return connection
        }
        //Who changes whose password, by a Password Modify or a modify of userPassword, and what it is answered
        const actors: {name: string, dn: string, connection: LDAPInProcessConnection}[] = [
            {name: 'an administrator', dn: BOSS, connection: await bound(BOSS, 'boss-password')},
            {name: 'a password administrator', dn: HELPDESK, connection: await bound(HELPDESK, 'password20')},
            {name: 'a user', dn: USER, connection: await bound(USER, 'password21')}
        ]
        const expected: Record<string, Record<string, [number, number | undefined]>> = {
            'an administrator': {self: [0, 0], user: [0, 0], 'an administrator with an entry': [0, 0], 'an administrator of the options': [53, undefined], 'another password administrator': [0, 0]},
            'a password administrator': {self: [0, 0], user: [0, 50], 'an administrator with an entry': [50, 50], 'an administrator of the options': [50, undefined], 'another password administrator': [50, 50]},
            'a user': {self: [0, 0], user: [50, 50], 'an administrator with an entry': [50, 50], 'an administrator of the options': [50, undefined], 'another password administrator': [50, 50]}
        }
        const wrong: string[] = []
        for (const [index, actor] of actors.entries()) {
            for (const [target, dn] of [['self', actor.dn], ['user', OTHER], ['an administrator with an entry', CHIEF], ['an administrator of the options', ROOT], ['another password administrator', DESK]] as [string, string][]) {
                const [byPasswordModify, byModify] = expected[actor.name][target]
                const answerOf = (operation: Promise<unknown>): Promise<number> => operation.then(() => 0, (error: unknown) => error instanceof LDAPResultException ? error.code : -1)
                const answered: number = await answerOf(actor.connection.passwordModify(target === 'self' ? {newPassword: `set-by-${index}`} : {userIdentity: dn, newPassword: `set-by-${index}`}))
                if (answered !== byPasswordModify) wrong.push(`${actor.name}, ${target}, Password Modify: ${answered}`)
                if (byModify === undefined) continue
                const modified: number = await answerOf(actor.connection.modify(dn, {operation: 'replace', attribute: 'userPassword', values: `written-by-${index}`}))
                if (modified !== byModify) wrong.push(`${actor.name}, ${target}, modify: ${modified}`)
            }
        }
        assert.deepEqual(wrong, [])
        //The passwords of the administrators as the administrator left them, none of those the others tried
        await bound(ROOT, 'root-secret')
        await bound(CHIEF, 'written-by-0')
        for (const password of ['set-by-1', 'written-by-1', 'set-by-2', 'written-by-2']) await assert.rejects(engine.connect().bind(CHIEF, password), code(49), password)
    })

    it('answers other for a result code no operation has, thrown by an interceptor', async () => {
        const {server: engine} = await directory({access: {admins: [ADMIN], anonymousRead: true}, interceptors: [{name: 'negative', operations: ['search', 'bind'], before: async () => {
            throw new LDAPResultException(-1, 'Odd')
        }}] as never})
        const client: LDAPInProcessConnection = engine.connect()
        await assert.rejects(client.search(`ou=people,${BASE}`, {scope: 'one'}), code(80))
        await assert.rejects(client.bind(`uid=user10,ou=people,${BASE}`, 'password10'), code(80))
        assert.equal(await client.whoAmI(), '')
    })

    it('refuses a whole hash an administrator writes without its {SCHEME}, as a password in clear it would be', async () => {
        const {server: engine, admin: owner} = await directory()
        const bcrypt: string = `$2b$10$${'N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'}`
        const sha512: string = `$6$saltsalt$${'a'.repeat(86)}`
        //Refused, by an add and by a modify: its text would be the password
        await assert.rejects(owner.add(`uid=imported,ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: 'imported', cn: 'i', sn: 'i', userPassword: bcrypt}), code(19))
        await assert.rejects(owner.modify(`uid=user10,ou=people,${BASE}`, {operation: 'replace', attribute: 'userPassword', values: sha512}), code(19))
        //(an argon2 hash without its version, as version 1.0 wrote it, too)
        await assert.rejects(owner.modify(`uid=user10,ou=people,${BASE}`, {operation: 'replace', attribute: 'userPassword', values: '$argon2i$m=4096,t=3,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo'}), code(19))
        //With its {SCHEME}: imported as it is; a password in clear only starting like one: hashed, binding
        await owner.modify(`uid=user11,ou=people,${BASE}`, {operation: 'replace', attribute: 'userPassword', values: `{CRYPT}${bcrypt}`})
        await owner.modify(`uid=user12,ou=people,${BASE}`, {operation: 'replace', attribute: 'userPassword', values: '$5$chosen'})
        await engine.connect().bind(`uid=user12,ou=people,${BASE}`, '$5$chosen')
        //A user's own value is a password in clear, whatever it looks like
        const self: LDAPInProcessConnection = engine.connect()
        await self.bind(`uid=user13,ou=people,${BASE}`, 'password13')
        await self.modify(`uid=user13,ou=people,${BASE}`, {operation: 'replace', attribute: 'userPassword', values: bcrypt})
        await engine.connect().bind(`uid=user13,ou=people,${BASE}`, bcrypt)
    })

    it('checks a password of its own scheme for a DN with no entry or no password, as for a wrong one', async () => {
        //The checks the server makes, by the scheme of the value checked
        const schemes: PasswordSchemes = new PasswordSchemes({iterations: 1000})
        const own: PasswordSchemes['verify'] = schemes.verify.bind(schemes)
        const checked: string[] = []
        schemes.verify = async (stored: Buffer | string, password: Buffer | string): Promise<boolean> => {
            checked.push(String(stored).slice(0, String(stored).indexOf('}') + 1))
            return own(stored, password)
        }
        const {server: engine, admin: owner} = await directory({passwords: schemes})
        await owner.add(`cn=no-password,${BASE}`, {objectClass: 'organizationalRole', cn: 'no-password'})
        for (const dn of [`uid=nobody,ou=people,${BASE}`, `cn=no-password,${BASE}`, `uid=user10,ou=people,${BASE}`]) {
            checked.length = 0
            await assert.rejects(engine.connect().bind(dn, 'wrong'), code(49), dn)
            assert.deepEqual(checked, ['{PBKDF2-SHA512}'], dn)
        }
        //The hash failing to be made: the bind still a wrong password, and the hash made again at the next one
        const {server: failing} = await directory({passwords: schemes})
        const hash: PasswordSchemes['hash'] = schemes.hash.bind(schemes)
        let refuse: boolean = true
        schemes.hash = async (password: Buffer | string, scheme?: string): Promise<string> => {
            if (refuse) {
                refuse = false
                throw new Error('No hash made')
            }
            return hash(password, scheme)
        }
        await assert.rejects(failing.connect().bind(`uid=nobody,ou=people,${BASE}`, 'wrong'), code(49))
        checked.length = 0
        await assert.rejects(failing.connect().bind(`uid=nobody,ou=people,${BASE}`, 'wrong'), code(49))
        assert.deepEqual(checked, ['{PBKDF2-SHA512}'])
    })

    it('hashes a password again at a bind only while the entry still holds the value the bind matched', async () => {
        const USER: string = `uid=rehashed,${BASE}`
        const GONE: string = `uid=gone,${BASE}`
        //A value of another scheme than the server's, as an import gives
        const ssha = (password: string): string => {
            const salt: Buffer = randomBytes(8)
            return `{SSHA}${Buffer.concat([createHash('sha1').update(password).update(salt).digest(), salt]).toString('base64')}`
        }
        //A backend running a write of the test once a bind has read the entry, before the bind checks the password and
        //hashes it again; and failing the writes of the engine when the test asks
        let meanwhile: (() => Promise<unknown>) | undefined
        let failing: boolean = false
        class Meanwhile extends MemoryBackend {
            public async get(...args: Parameters<MemoryBackend['get']>): Promise<DirectoryEntry | undefined> {
                const entry: DirectoryEntry | undefined = await super.get(...args)
                const run: (() => Promise<unknown>) | undefined = meanwhile
                if (run && (args[1].toString() === USER || args[1].toString() === GONE)) {
                    meanwhile = undefined
                    await run()
                }
                return entry
            }

            public async modify(...args: Parameters<MemoryBackend['modify']>): Promise<void> {
                if (failing && args[0].internal) throw new Error('The write of the backend failed')
                return super.modify(...args)
            }
        }
        const backend: Meanwhile = new Meanwhile(BASE)
        const errors: unknown[] = []
        const engine: LDAPServerEngine = createLDAPServer({backends: [backend], access: {admins: [ADMIN]}, passwords: {iterations: 1000}, bindThrottle: {delay: 0}})
        engine.events.on('error', (error: unknown) => errors.push(error))
        const owner: LDAPInProcessConnection = engine.connect({as: ADMIN})
        await owner.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
        const stored = (dn: string): string[] => (backend.entries().find((entry) => entry.dn.toString() === dn)?.attributes.find((attribute) => attribute.type.toLowerCase() === 'userpassword')?.values ?? []).map((value) => value.toString())
        //The value as it was: replaced by one of the server's scheme
        await owner.add(USER, {objectClass: ['account', 'simpleSecurityObject'], uid: 'rehashed', userPassword: ssha('first')})
        await engine.connect().bind(USER, 'first')
        assert.equal(stored(USER).length, 1)
        assert.match(stored(USER)[0], /^\{PBKDF2-SHA512\}/)
        //Changed meanwhile: left as it is, the password the bind checked no longer binding
        await owner.modify(USER, {operation: 'replace', attribute: 'userPassword', values: ssha('second')})
        const third: string = ssha('third')
        meanwhile = () => owner.modify(USER, {operation: 'replace', attribute: 'userPassword', values: third})
        await engine.connect().bind(USER, 'second')
        assert.deepEqual(stored(USER), [third])
        await assert.rejects(engine.connect().bind(USER, 'second'), code(49))
        //Deleted meanwhile: nothing written
        await owner.add(GONE, {objectClass: ['account', 'simpleSecurityObject'], uid: 'gone', userPassword: ssha('gone')})
        meanwhile = () => owner.delete(GONE)
        await engine.connect().bind(GONE, 'gone')
        assert.equal(backend.entries().some((entry) => entry.dn.toString() === GONE), false)
        assert.deepEqual(errors, [])
        //Held under an option of userPassword: hashed again there
        const TAGGED: string = `uid=tagged,${BASE}`
        await owner.add(TAGGED, {objectClass: ['account', 'simpleSecurityObject'], uid: 'tagged', 'userPassword;x-legacy': ssha('tagged')})
        await engine.connect().bind(TAGGED, 'tagged')
        const tagged = backend.entries().find((entry) => entry.dn.toString() === TAGGED)!.attributes.filter((attribute) => attribute.type.toLowerCase().startsWith('userpassword'))
        assert.deepEqual(tagged.map((attribute) => [attribute.type, attribute.values.length, attribute.values[0].toString().slice(0, 15)]), [['userPassword;x-legacy', 1, '{PBKDF2-SHA512}']])
        //A write failing: the bind done, the error an event, the value kept
        failing = true
        await engine.connect().bind(USER, 'third')
        failing = false
        assert.equal(errors.length, 1)
        assert.deepEqual(stored(USER), [third])
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

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    AuditPlugin,
    type AuditRecord,
    BaseLDAPPlugin,
    ConstraintPlugin,
    createLDAPServer,
    DEFAULT_SCHEMAS,
    IdAllocationPlugin,
    LastBindPlugin,
    LDAPConstraintViolationException,
    LDAPException,
    type LDAPInProcessConnection,
    LDAPInsufficientAccessException,
    type LDAPInterceptor,
    type LDAPPlugin,
    type LDAPPluginHost,
    LDAPSchemaException,
    type LDAPServerEngine,
    LDAPUnavailableCriticalExtensionException,
    LDAPUsageException,
    MemberOfPlugin,
    MemoryBackend,
    PagedResultsControl,
    ReferentialIntegrityPlugin,
    RFC2307BIS_SCHEMA,
    SambaPasswordPlugin,
    UniquePlugin
} from '../exports/LDAPEngine.js'

const BASE: string = 'dc=example,dc=com'
const ADMIN: string = 'cn=admin,dc=example,dc=com'
const PEOPLE: string = `ou=people,${BASE}`
const GROUPS: string = `ou=groups,${BASE}`

/**
 * A server with a directory of three people and the plugins given
 * @param plugins The plugins.
 * @param options More options of the server.
 */
async function serve(plugins: LDAPPlugin[], options: Partial<Parameters<typeof createLDAPServer>[0]> = {}): Promise<{server: LDAPServerEngine, admin: LDAPInProcessConnection}> {
    const server: LDAPServerEngine = createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ADMIN]}, passwords: {iterations: 1000}, bindThrottle: {delay: 0}, plugins: plugins, ...options})
    await server.start()
    const admin: LDAPInProcessConnection = server.connect({as: ADMIN})
    await admin.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
    await admin.add(PEOPLE, {objectClass: 'organizationalUnit', ou: 'people'})
    await admin.add(GROUPS, {objectClass: 'organizationalUnit', ou: 'groups'})
    for (const name of ['alice', 'bob', 'carol']) await admin.add(`uid=${name},${PEOPLE}`, {objectClass: 'inetOrgPerson', uid: name, cn: name, sn: name, mail: `${name}@example.com`, userPassword: `${name}-password`})
    return {server, admin}
}

/**
 * The values of an attribute of an entry, operational ones included
 * @param connection The connection.
 * @param dn The DN.
 * @param attribute The attribute.
 */
async function valuesOf(connection: LDAPInProcessConnection, dn: string, attribute: string): Promise<string[]> {
    return (await connection.search(dn, {scope: 'base', attributes: [attribute]})).entries[0].get(attribute).sort()
}

describe('the plugins of the server engine', () => {
    it('add schema files, controls, extended operations, SASL mechanisms, password schemes and root DSE attributes, published by the server', async () => {
        const events: string[] = []
        const plugin: LDAPPlugin = {
            name: 'colours',
            schemaFiles: [{name: 'colours', text: 'dn: cn=colours,cn=schema\nobjectClass: subschema\nattributeTypes: ( 1.3.6.1.4.1.65000.9.1 NAME \'favouriteColour\' EQUALITY caseIgnoreMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )\nobjectClasses: ( 1.3.6.1.4.1.65000.9.2 NAME \'colourful\' AUXILIARY MAY favouriteColour )\n'}],
            controls: [{oid: '1.3.6.1.4.1.65000.9.3', operations: ['search']}],
            extendedOperations: {'1.3.6.1.4.1.65000.9.4': () => ({value: Buffer.from('red')})},
            saslMechanisms: [{name: 'X-COLOUR', requiresTLS: false, start: async () => ({done: true})}],
            passwordSchemes: [{name: 'REVERSE', verify: (value: string, password: Buffer): boolean => value === [...password.toString()].reverse().join('')}],
            rootDSEAttributes: [{type: 'vendorName', values: [Buffer.from('Colours')]}],
            interceptors: [{
                name: 'colour-control',
                operations: ['search'],
                transformEntry: (context, entry) => context.controls.some((control) => control.oid === '1.3.6.1.4.1.65000.9.3') ? {dn: entry.dn, attributes: [...entry.attributes, {type: 'favouriteColour', values: [Buffer.from('blue')]}]} : entry
            }],
            start: (host: LDAPPluginHost): void => {
                events.push(`start ${host.schema.attributeType('favouriteColour') ? 'with' : 'without'} its schema`)
            },
            stop: (): void => {
                events.push('stop')
            }
        }
        const {server, admin} = await serve([plugin])
        const root = (await admin.search('', {scope: 'base', attributes: ['*', '+']})).entries[0]
        assert.ok(root.get('supportedControl').includes('1.3.6.1.4.1.65000.9.3'))
        assert.ok(root.get('supportedExtension').includes('1.3.6.1.4.1.65000.9.4'))
        assert.ok(root.get('supportedSASLMechanisms').includes('X-COLOUR'))
        assert.ok(root.get('vendorName').includes('Colours'))
        const subschema = (await admin.search('cn=Subschema', {scope: 'base', attributes: ['attributeTypes', 'objectClasses']})).entries[0]
        assert.ok(subschema.get('attributeTypes').some((value: string) => value.includes('favouriteColour')))
        await admin.modify(`uid=alice,${PEOPLE}`, [{operation: 'add', attribute: 'objectClass', values: 'colourful'}, {operation: 'add', attribute: 'favouriteColour', values: 'green'}])
        //The control: accepted with a search, refused with a modify when critical
        const coloured = (await admin.search(`uid=bob,${PEOPLE}`, {scope: 'base', controls: [{oid: '1.3.6.1.4.1.65000.9.3', critical: true}]})).entries[0]
        assert.equal(coloured.first('favouriteColour'), 'blue')
        await assert.rejects(admin.modify(`uid=bob,${PEOPLE}`, {operation: 'replace', attribute: 'description', values: 'x'}, {controls: [{oid: '1.3.6.1.4.1.65000.9.3', critical: true}]}), LDAPUnavailableCriticalExtensionException)
        assert.equal((await admin.extended('1.3.6.1.4.1.65000.9.4')).value?.toString(), 'red')
        //The scheme: a value an administrator writes in it is checked by a bind
        await admin.modify(`uid=carol,${PEOPLE}`, {operation: 'replace', attribute: 'userPassword', values: '{REVERSE}drowssap'})
        await server.connect().bind(`uid=carol,${PEOPLE}`, 'password')
        await server.listen({port: 0, host: '127.0.0.1'})
        await server.listen({port: 0, host: '127.0.0.1'})
        await server.close()
        assert.deepEqual(events, ['start with its schema', 'stop'])
    })

    it('refuse plugins claiming what the engine or another plugin has', () => {
        const backends = [new MemoryBackend(BASE)]
        assert.throws(() => createLDAPServer({backends, plugins: [{name: 'a'}, {name: 'a'}]}), LDAPUsageException)
        assert.throws(() => createLDAPServer({backends, plugins: [{name: 'paging', controls: [{oid: PagedResultsControl.oid}]}]}), /handled by the engine/)
        assert.throws(() => createLDAPServer({backends, plugins: [{name: 'a', controls: [{oid: '1.2.3.4'}]}, {name: 'b', controls: [{oid: '1.2.3.4'}]}]}), /handled by the plugin a/)
        assert.throws(() => createLDAPServer({backends, plugins: [{name: 'a', extendedOperations: {'1.3.6.1.4.1.4203.1.11.3': () => ({})}}]}), /handled by the engine/)
        assert.throws(() => createLDAPServer({backends, plugins: [{name: 'a', saslMechanisms: [{name: 'plain', start: async () => ({done: true})}]}]}), /SASL mechanism/)
        assert.throws(() => createLDAPServer({backends, plugins: [{name: 'a', passwordSchemes: [{name: 'ssha', verify: () => false}]}]}), /password scheme/)
        const file = (description: string) => ({name: 'x', text: `dn: cn=x,cn=schema\nobjectClass: subschema\nattributeTypes: ( 1.3.6.1.4.1.65000.9.9 NAME 'twice' DESC '${description}' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )\n`})
        assert.throws(() => createLDAPServer({backends, plugins: [{name: 'a', schemaFiles: [file('one')]}, {name: 'b', schemaFiles: [file('two')]}]}), LDAPSchemaException)
        assert.ok(createLDAPServer({backends, plugins: [{name: 'a', schemaFiles: [file('same')]}, {name: 'b', schemaFiles: [file('same')]}]}))
        const interceptor: LDAPInterceptor = {name: 'twice', operations: ['add']}
        assert.throws(() => createLDAPServer({backends, plugins: [{name: 'a', interceptors: [interceptor]}, {name: 'b', interceptors: [interceptor]}]}), LDAPException)
    })

    it('run for the backends of their suffixes, and leave the backends doing their work themselves', async () => {
        class NativeMemberOf extends MemoryBackend {
            public readonly capabilities = {memberOf: true}
        }
        const stamp = (name: string, suffixes?: string[]): LDAPPlugin => ({name: name, ...suffixes ? {suffixes} : {}, interceptors: [{name: name, operations: ['add'], before: (context, request) => {
            if (request.type !== 'add') return
            const description = request.entry.attributes.find((attribute) => attribute.type === 'description')
            if (description) description.values.push(Buffer.from(name))
            else request.entry.attributes.push({type: 'description', values: [Buffer.from(name)]})
        }}]})
        const server: LDAPServerEngine = createLDAPServer({backends: [new MemoryBackend('dc=a'), new NativeMemberOf('dc=b')], access: {admins: ['cn=admin']}, plugins: [stamp('only-a', ['dc=a']), stamp('everywhere'), new MemberOfPlugin()]})
        const admin: LDAPInProcessConnection = server.connect({as: 'cn=admin'})
        await admin.add('dc=a', {objectClass: ['dcObject', 'organization'], dc: 'a', o: 'a'})
        await admin.add('dc=b', {objectClass: ['dcObject', 'organization'], dc: 'b', o: 'b'})
        assert.deepEqual(await valuesOf(admin, 'dc=a', 'description'), ['everywhere', 'only-a'])
        assert.deepEqual(await valuesOf(admin, 'dc=b', 'description'), ['everywhere'])
        //The backend of dc=b does memberOf itself: the plugin writes none there
        await admin.add('uid=x,dc=b', {objectClass: 'account', uid: 'x'})
        await admin.add('cn=g,dc=b', {objectClass: 'groupOfNames', cn: 'g', member: 'uid=x,dc=b'})
        assert.deepEqual(await valuesOf(admin, 'uid=x,dc=b', 'memberOf'), [])
    })
})

describe('the plugins of the engine', () => {
    it('MemberOfPlugin keeps the memberOf of the members of the groups', async () => {
        const {admin} = await serve([new MemberOfPlugin()])
        const alice: string = `uid=alice,${PEOPLE}`
        const bob: string = `uid=bob,${PEOPLE}`
        const group: string = `cn=staff,${GROUPS}`
        await admin.add(group, {objectClass: 'groupOfNames', cn: 'staff', member: [alice, bob]})
        assert.deepEqual(await valuesOf(admin, alice, 'memberOf'), [group])
        assert.equal((await admin.search(BASE, {filter: `(memberOf=${group})`})).entries.length, 2)
        await admin.modify(group, {operation: 'delete', attribute: 'member', values: bob})
        assert.deepEqual(await valuesOf(admin, bob, 'memberOf'), [])
        await admin.add(`cn=unique,${GROUPS}`, {objectClass: 'groupOfUniqueNames', cn: 'unique', uniqueMember: `${bob}#'0101'B`})
        assert.deepEqual(await valuesOf(admin, bob, 'memberOf'), [`cn=unique,${GROUPS}`])
        await admin.modifyDN(group, 'cn=team')
        assert.deepEqual(await valuesOf(admin, alice, 'memberOf'), [`cn=team,${GROUPS}`])
        //The writes of memberOf leave the entry as its writer left it
        assert.equal((await valuesOf(admin, alice, 'modifiersName'))[0], ADMIN)
        await admin.delete(`cn=team,${GROUPS}`)
        assert.deepEqual(await valuesOf(admin, alice, 'memberOf'), [])
        await assert.rejects(admin.modify(alice, {operation: 'add', attribute: 'memberOf', values: group}), LDAPConstraintViolationException)
    })

    it('ReferentialIntegrityPlugin keeps the DNs of the values when entries are deleted, renamed or moved', async () => {
        const {admin} = await serve([new ReferentialIntegrityPlugin()])
        const alice: string = `uid=alice,${PEOPLE}`
        const bob: string = `uid=bob,${PEOPLE}`
        await admin.add(`cn=staff,${GROUPS}`, {objectClass: 'groupOfNames', cn: 'staff', member: [alice, bob]})
        await admin.add(`cn=solo,${GROUPS}`, {objectClass: 'groupOfNames', cn: 'solo', member: bob})
        await admin.add(`cn=unique,${GROUPS}`, {objectClass: 'groupOfUniqueNames', cn: 'unique', uniqueMember: `${alice}#'0101'B`})
        await admin.modify(`uid=carol,${PEOPLE}`, {operation: 'add', attribute: 'manager', values: alice})
        await admin.modifyDN(alice, 'uid=alice2')
        assert.deepEqual(await valuesOf(admin, `cn=staff,${GROUPS}`, 'member'), [bob, `uid=alice2,${PEOPLE}`].sort())
        assert.deepEqual(await valuesOf(admin, `cn=unique,${GROUPS}`, 'uniqueMember'), [`uid=alice2,${PEOPLE}#'0101'B`])
        assert.deepEqual(await valuesOf(admin, `uid=carol,${PEOPLE}`, 'manager'), [`uid=alice2,${PEOPLE}`])
        //A move of the parent moves the values of the entries below it
        await admin.add(`ou=staff,${BASE}`, {objectClass: 'organizationalUnit', ou: 'staff'})
        await admin.modifyDN(PEOPLE, 'ou=people', {newSuperior: `ou=staff,${BASE}`})
        assert.deepEqual(await valuesOf(admin, `uid=carol,ou=people,ou=staff,${BASE}`, 'manager'), [`uid=alice2,ou=people,ou=staff,${BASE}`])
        //The last member of a group goes: the placeholder takes its place
        await admin.delete(`uid=bob,ou=people,ou=staff,${BASE}`)
        assert.deepEqual(await valuesOf(admin, `cn=solo,${GROUPS}`, 'member'), [''])
        assert.deepEqual(await valuesOf(admin, `cn=staff,${GROUPS}`, 'member'), [`uid=alice2,ou=people,ou=staff,${BASE}`])
    })

    it('MemberOfPlugin, ReferentialIntegrityPlugin and UniquePlugin together keep the groups and their members', async () => {
        const {admin} = await serve([new MemberOfPlugin(), new ReferentialIntegrityPlugin(), new UniquePlugin({attributes: ['uid', 'mail']})])
        const group: string = `cn=staff,${GROUPS}`
        await admin.add(group, {objectClass: 'groupOfNames', cn: 'staff', member: [`uid=alice,${PEOPLE}`, `uid=bob,${PEOPLE}`]})
        await admin.modifyDN(`uid=alice,${PEOPLE}`, 'uid=alice2')
        assert.deepEqual(await valuesOf(admin, group, 'member'), [`uid=alice2,${PEOPLE}`, `uid=bob,${PEOPLE}`])
        assert.deepEqual(await valuesOf(admin, `uid=alice2,${PEOPLE}`, 'memberOf'), [group])
        await admin.delete(`uid=bob,${PEOPLE}`)
        assert.deepEqual(await valuesOf(admin, group, 'member'), [`uid=alice2,${PEOPLE}`])
        await admin.modifyDN(group, 'cn=team')
        assert.deepEqual(await valuesOf(admin, `uid=alice2,${PEOPLE}`, 'memberOf'), [`cn=team,${GROUPS}`])
        await assert.rejects(admin.modifyDN(`uid=carol,${PEOPLE}`, 'uid=alice2'), (error: unknown) => error instanceof LDAPException)
    })

    it('UniquePlugin refuses a value another entry has', async () => {
        const {admin} = await serve([new UniquePlugin({attributes: ['mail', 'uid']})])
        await assert.rejects(admin.add(`uid=dave,${PEOPLE}`, {objectClass: 'inetOrgPerson', uid: 'dave', cn: 'd', sn: 'd', mail: 'ALICE@example.com'}), LDAPConstraintViolationException)
        await assert.rejects(admin.modify(`uid=bob,${PEOPLE}`, {operation: 'replace', attribute: 'mail', values: 'carol@example.com'}), LDAPConstraintViolationException)
        await admin.modify(`uid=bob,${PEOPLE}`, {operation: 'replace', attribute: 'mail', values: ['bob@example.com', 'robert@example.com']})
        await admin.add(`ou=other,${BASE}`, {objectClass: 'organizationalUnit', ou: 'other'})
        await assert.rejects(admin.add(`uid=alice,ou=other,${BASE}`, {objectClass: 'account', uid: 'alice'}), LDAPConstraintViolationException)
        await admin.add(`uid=erin,ou=other,${BASE}`, {objectClass: 'account', uid: 'erin'})
        await assert.rejects(admin.modifyDN(`uid=erin,ou=other,${BASE}`, 'uid=bob'), LDAPConstraintViolationException)
        //Two adds of one value at once: one of them only
        const results = await Promise.allSettled(['x', 'y'].map((name: string) => admin.add(`uid=${name},ou=other,${BASE}`, {objectClass: ['account', 'extensibleObject'], uid: name, mail: 'same@example.com'})))
        assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected'])
    })

    it('IdAllocationPlugin gives uidNumber and gidNumber to the POSIX entries added without them', async () => {
        const {admin} = await serve([new IdAllocationPlugin({uidNumber: 5000, gidNumber: 7000})], {schema: [...DEFAULT_SCHEMAS, RFC2307BIS_SCHEMA]})
        const account = (name: string, extra: Record<string, string> = {}) => admin.add(`uid=${name},${PEOPLE}`, {objectClass: ['account', 'posixAccount'], uid: name, cn: name, homeDirectory: `/home/${name}`, ...extra})
        await account('p1')
        assert.deepEqual([await valuesOf(admin, `uid=p1,${PEOPLE}`, 'uidNumber'), await valuesOf(admin, `uid=p1,${PEOPLE}`, 'gidNumber')], [['5000'], ['7000']])
        await account('p2', {uidNumber: '5002', gidNumber: '100'})
        await account('p3')
        assert.deepEqual(await valuesOf(admin, `uid=p3,${PEOPLE}`, 'uidNumber'), ['5001'])
        await account('p4')
        assert.deepEqual(await valuesOf(admin, `uid=p4,${PEOPLE}`, 'uidNumber'), ['5003'])
        await admin.add(`cn=g1,${GROUPS}`, {objectClass: ['groupOfNames', 'posixGroup'], cn: 'g1', member: ''})
        assert.deepEqual(await valuesOf(admin, `cn=g1,${GROUPS}`, 'gidNumber'), ['7003'])
        //At once: different numbers
        await Promise.all(['q1', 'q2', 'q3'].map((name: string) => account(name)))
        const numbers: string[] = (await admin.search(PEOPLE, {filter: '(uid=q*)', attributes: ['uidNumber']})).entries.map((entry) => entry.first('uidNumber')!)
        assert.equal(new Set(numbers).size, 3)
    })

    it('LastBindPlugin writes the time of the last bind', async () => {
        const {server, admin} = await serve([new LastBindPlugin()])
        assert.deepEqual(await valuesOf(admin, `uid=alice,${PEOPLE}`, 'authTimestamp'), [])
        await server.connect().bind(`uid=alice,${PEOPLE}`, 'alice-password')
        assert.match((await valuesOf(admin, `uid=alice,${PEOPLE}`, 'authTimestamp'))[0], /^\d{14}Z$/)
        assert.equal((await valuesOf(admin, `uid=alice,${PEOPLE}`, 'modifiersName'))[0], ADMIN)
        await assert.rejects(server.connect().bind(`uid=bob,${PEOPLE}`, 'wrong'))
        assert.deepEqual(await valuesOf(admin, `uid=bob,${PEOPLE}`, 'authTimestamp'), [])
    })

    it('SambaPasswordPlugin writes the NT hash of a password set in clear', async () => {
        const samba: string = [
            'dn: cn=samba,cn=schema',
            'objectClass: subschema',
            'attributeTypes: ( 1.3.6.1.4.1.65000.8.1 NAME \'sambaNTPassword\' EQUALITY caseIgnoreIA5Match SYNTAX 1.3.6.1.4.1.1466.115.121.1.26{32} SINGLE-VALUE )',
            'attributeTypes: ( 1.3.6.1.4.1.65000.8.2 NAME \'sambaPwdLastSet\' EQUALITY integerMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.27 SINGLE-VALUE )',
            'objectClasses: ( 1.3.6.1.4.1.65000.8.3 NAME \'sambaSamAccount\' AUXILIARY MAY ( sambaNTPassword $ sambaPwdLastSet ) )'
        ].join('\n') + '\n'
        const {server, admin} = await serve([new SambaPasswordPlugin()], {schema: [...DEFAULT_SCHEMAS, {name: 'samba', text: samba}]})
        const dn: string = `uid=sam,${PEOPLE}`
        await admin.add(dn, {objectClass: ['inetOrgPerson', 'sambaSamAccount'], uid: 'sam', cn: 'sam', sn: 'sam', userPassword: 'password'})
        assert.deepEqual(await valuesOf(admin, dn, 'sambaNTPassword'), ['8846F7EAEE8FB117AD06BDD830B7586C'])
        assert.match((await valuesOf(admin, dn, 'sambaPwdLastSet'))[0], /^\d+$/)
        const sam: LDAPInProcessConnection = server.connect()
        await sam.bind(dn, 'password')
        await sam.passwordModify({oldPassword: 'password', newPassword: 'secret'})
        assert.deepEqual(await valuesOf(admin, dn, 'sambaNTPassword'), ['878D8014606CDA29677A44EFA1353FC7'])
        //Not a Samba account: no hash
        await admin.modify(`uid=bob,${PEOPLE}`, {operation: 'replace', attribute: 'userPassword', values: 'other'})
        assert.deepEqual(await valuesOf(admin, `uid=bob,${PEOPLE}`, 'sambaNTPassword'), [])
        //Without the schema of Samba, the server does not start
        await assert.rejects(createLDAPServer({backends: [new MemoryBackend(BASE)], plugins: [new SambaPasswordPlugin()]}).start(), LDAPUsageException)
    })

    it('AuditPlugin records the operations and their outcome, without the passwords', async () => {
        const records: AuditRecord[] = []
        const {server, admin} = await serve([new AuditPlugin({write: (record) => {
            records.push(record)
        }})])
        records.length = 0
        await admin.modify(`uid=alice,${PEOPLE}`, [{operation: 'replace', attribute: 'description', values: 'audited'}, {operation: 'replace', attribute: 'userPassword', values: 'new-password'}])
        await assert.rejects(server.connect().add(`uid=anonymous,${PEOPLE}`, {objectClass: 'account', uid: 'anonymous'}), LDAPInsufficientAccessException)
        await admin.delete(`uid=carol,${PEOPLE}`)
        //A Password Modify: the modify it makes
        const bob: LDAPInProcessConnection = server.connect()
        await bob.bind(`uid=bob,${PEOPLE}`, 'bob-password')
        await bob.passwordModify({oldPassword: 'bob-password', newPassword: 'bob-new-password'})
        assert.deepEqual(records.map((record) => [record.operation, record.dn, record.resultCode]), [['modify', `uid=alice,${PEOPLE}`, 0], ['add', `uid=anonymous,${PEOPLE}`, 50], ['delete', `uid=carol,${PEOPLE}`, 0], ['extended', `uid=bob,${PEOPLE}`, 0]])
        assert.equal(records[0].identity, ADMIN)
        assert.deepEqual(records[0].changes, [{operation: 'replace', attribute: 'description', values: ['audited']}, {operation: 'replace', attribute: 'userPassword', values: ['***']}])
        assert.ok(records[1].diagnosticMessage)
        assert.deepEqual([records[3].identity, records[3].name], [`uid=bob,${PEOPLE}`, '1.3.6.1.4.1.4203.1.11.1'])
        assert.ok(!JSON.stringify(records).includes('bob-new-password'))
        //The binds too, failed ones and anonymous ones, when asked for
        const binds: AuditRecord[] = []
        const {server: watched} = await serve([new AuditPlugin({operations: ['bind'], write: (record) => {
            binds.push(record)
        }})])
        await assert.rejects(watched.connect().bind(`uid=alice,${PEOPLE}`, 'wrong'))
        await watched.connect().bind('', '')
        assert.deepEqual(binds.map((record) => [record.dn, record.resultCode]), [[`uid=alice,${PEOPLE}`, 49], ['', 0]])
    })

    it('ConstraintPlugin refuses the values breaking its rules', async () => {
        const {admin} = await serve([new ConstraintPlugin({rules: [
            {attribute: 'mail', pattern: /@example\.com$/, count: 2},
            {attribute: 'description', size: 10},
            {attribute: 'telephoneNumber', check: (value) => value.startsWith('+') || 'An international number'}
        ]})])
        const alice: string = `uid=alice,${PEOPLE}`
        await assert.rejects(admin.modify(alice, {operation: 'replace', attribute: 'mail', values: 'alice@elsewhere.org'}), LDAPConstraintViolationException)
        await admin.modify(alice, {operation: 'add', attribute: 'mail', values: 'a@example.com'})
        await assert.rejects(admin.modify(alice, {operation: 'add', attribute: 'mail', values: 'b@example.com'}), /at most 2 values/)
        await assert.rejects(admin.modify(alice, {operation: 'replace', attribute: 'description', values: 'far too long a text'}), LDAPConstraintViolationException)
        await assert.rejects(admin.modify(alice, {operation: 'replace', attribute: 'telephoneNumber', values: '010 1234'}), /An international number/)
        await admin.modify(alice, {operation: 'replace', attribute: 'telephoneNumber', values: '+86 10 1234'})
        await assert.rejects(admin.add(`uid=dave,${PEOPLE}`, {objectClass: 'inetOrgPerson', uid: 'dave', cn: 'd', sn: 'd', mail: 'dave@other.org'}), LDAPConstraintViolationException)
    })

    it('keep the relations within one backend, as the overlays of OpenLDAP keep them within one database', async () => {
        const server: LDAPServerEngine = createLDAPServer({backends: [new MemoryBackend('dc=a'), new MemoryBackend('dc=b')], access: {admins: ['cn=admin']}, plugins: [new MemberOfPlugin(), new ReferentialIntegrityPlugin()]})
        const admin: LDAPInProcessConnection = server.connect({as: 'cn=admin'})
        for (const name of ['a', 'b']) await admin.add(`dc=${name}`, {objectClass: ['dcObject', 'organization'], dc: name, o: name})
        await admin.add('uid=x,dc=a', {objectClass: 'account', uid: 'x'})
        await admin.add('uid=y,dc=b', {objectClass: 'account', uid: 'y'})
        await admin.add('cn=g,dc=a', {objectClass: 'groupOfNames', cn: 'g', member: ['uid=x,dc=a', 'uid=y,dc=b']})
        assert.deepEqual(await valuesOf(admin, 'uid=x,dc=a', 'memberOf'), ['cn=g,dc=a'])
        assert.deepEqual(await valuesOf(admin, 'uid=y,dc=b', 'memberOf'), [])
        await admin.add('cn=h,dc=b', {objectClass: 'groupOfNames', cn: 'h', member: 'uid=x,dc=a'})
        await admin.delete('uid=x,dc=a')
        assert.deepEqual(await valuesOf(admin, 'cn=g,dc=a', 'member'), ['uid=y,dc=b'])
        assert.deepEqual(await valuesOf(admin, 'cn=h,dc=b', 'member'), ['uid=x,dc=a'])
    })

    it('leave the backends mounted below their own suffix alone', async () => {
        const server: LDAPServerEngine = createLDAPServer({backends: [new MemoryBackend('dc=a'), new MemoryBackend('ou=x,dc=a')], access: {admins: ['cn=admin']}, plugins: [new MemberOfPlugin(), new ReferentialIntegrityPlugin(), new UniquePlugin({attributes: ['uid']})]})
        const admin: LDAPInProcessConnection = server.connect({as: 'cn=admin'})
        await admin.add('dc=a', {objectClass: ['dcObject', 'organization'], dc: 'a', o: 'a'})
        await admin.add('ou=x,dc=a', {objectClass: 'organizationalUnit', ou: 'x'})
        await admin.add('uid=inner,ou=x,dc=a', {objectClass: 'account', uid: 'inner'})
        await admin.add('cn=g,dc=a', {objectClass: 'groupOfNames', cn: 'g', member: 'uid=inner,ou=x,dc=a'})
        assert.deepEqual(await valuesOf(admin, 'uid=inner,ou=x,dc=a', 'memberOf'), [])
        //A uid of the inner backend is not taken in the outer one
        await admin.add('uid=inner,dc=a', {objectClass: 'account', uid: 'inner'})
        await admin.delete('uid=inner,ou=x,dc=a')
        assert.deepEqual(await valuesOf(admin, 'cn=g,dc=a', 'member'), ['uid=inner,ou=x,dc=a'])
    })

    it('find a name and optional UID approximately by its name, whatever its UID', async () => {
        const {admin} = await serve([])
        await admin.add(`cn=unique,${GROUPS}`, {objectClass: 'groupOfUniqueNames', cn: 'unique', uniqueMember: [`uid=alice,${PEOPLE}#'0101'B`, `uid=bob,${PEOPLE}`]})
        assert.equal((await admin.search(GROUPS, {filter: `(uniqueMember=uid=alice,${PEOPLE})`})).entries.length, 0)
        assert.equal((await admin.search(GROUPS, {filter: `(uniqueMember~=UID=Alice,${PEOPLE})`})).entries.length, 1)
        assert.equal((await admin.search(GROUPS, {filter: `(uniqueMember~=uid=bob,${PEOPLE}#'1'B)`})).entries.length, 1)
        assert.equal((await admin.search(GROUPS, {filter: `(uniqueMember~=uid=carol,${PEOPLE})`})).entries.length, 0)
    })

    it('run around every request, a bind they refuse leaving the session anonymous', async () => {
        const gate: LDAPPlugin = {
            name: 'gate',
            aroundRequest: async (context, request, next) => {
                const outcome = await next()
                if (request.type === 'bindRequest' && request.name.startsWith('uid=bob')) throw new LDAPException('E_TEST', 'refused after the check')
                return outcome
            }
        }
        const {server} = await serve([gate])
        const session: LDAPInProcessConnection = server.connect()
        await assert.rejects(session.bind(`uid=bob,${PEOPLE}`, 'bob-password'))
        assert.equal(await session.whoAmI(), '')
        await session.bind(`uid=alice,${PEOPLE}`, 'alice-password')
        assert.equal(await session.whoAmI(), `dn:uid=alice,${PEOPLE}`)
    })

    it('BaseLDAPPlugin gives a plugin its name, its suffixes and internal connections', async () => {
        class CountPlugin extends BaseLDAPPlugin {
            public readonly interceptors: LDAPInterceptor[] = [{name: this.name, operations: ['add'], around: async (context, request, next) => {
                const outcome = await next()
                //The internal connection: the access control lets it through
                await this.internally(context, async (connection) => {
                    this.counted = (await connection.search(BASE, {filter: '(objectClass=*)', attributes: ['1.1']})).entries.length
                })
                return outcome
            }}]

            public counted: number = 0

            constructor(options: {name?: string, suffixes?: string[]} = {}) {
                super('count', options)
            }
        }
        const counter: CountPlugin = new CountPlugin({name: 'counter', suffixes: [BASE]})
        assert.deepEqual([counter.name, counter.suffixes], ['counter', [BASE]])
        await serve([counter], {access: {admins: [ADMIN], authenticatedRead: false}})
        assert.equal(counter.counted, 6)
        assert.throws(() => new CountPlugin({suffixes: ['not a dn']}))
        await assert.rejects(serve([new SambaPasswordPlugin({name: 'no-schema'})]), LDAPUsageException)
    })
})

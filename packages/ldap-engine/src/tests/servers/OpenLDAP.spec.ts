//The client against a real OpenLDAP (test-env/openldap/run.sh gives its URLs); skipped without them
import assert from 'node:assert/strict'
import {after, before, describe, it} from 'node:test'
import {
    connectLDAP,
    createDirectory,
    createLDAPClient,
    Filter,
    filter,
    type LDAPClientConnection,
    LDAPEntryAlreadyExistsException,
    LDAPInvalidCredentialsException,
    LDAPNoSuchObjectException,
    LDAPNotAllowedOnNonLeafException,
    type LDAPPool,
    PasswordSchemes,
    readSchema,
    type Schema
} from '../../exports/LDAPEngine.js'

const URL: string | undefined = process.env.LDAP_TEST_URL
const LDAPS: string = process.env.LDAP_TEST_LDAPS_URL ?? ''
const BASE: string = process.env.LDAP_TEST_BASE ?? 'dc=example,dc=com'
const ADMIN: string = process.env.LDAP_TEST_ADMIN ?? 'cn=admin,dc=example,dc=com'
const PASSWORD: string = process.env.LDAP_TEST_PASSWORD ?? 'secret'
const PEOPLE: string = `ou=people-${process.pid},${BASE}`
const TLS = {rejectUnauthorized: false}
const CONFIG_PASSWORD: string = process.env.LDAP_TEST_CONFIG_PASSWORD ?? 'config'

describe('against OpenLDAP', {skip: !URL}, () => {
    let admin: LDAPClientConnection

    before(async () => {
        admin = await connectLDAP({url: URL!, startTLS: true, tls: TLS})
        await admin.bind(ADMIN, PASSWORD)
        await admin.add(PEOPLE, {objectClass: ['top', 'organizationalUnit'], ou: `people-${process.pid}`})
        for (let index: number = 0; index < 1200; index++) {
            await admin.add(`uid=user${index},${PEOPLE}`, {objectClass: ['inetOrgPerson'], uid: `user${index}`, cn: `User ${index}`, sn: 'Test', mail: `user${index}@example.com`, userPassword: `password${index}`})
        }
    })

    after(async () => {
        for await (const entry of admin.searchIterator(PEOPLE, {scope: 'one', attributes: ['1.1']})) await admin.delete(entry.dn)
        await admin.delete(PEOPLE)
        await admin.close()
    })

    it('binds over StartTLS and over LDAPS, and says who the session is', async () => {
        assert.equal(admin.secure, true)
        assert.equal(await admin.whoAmI(), `dn:${ADMIN}`)
        const ldaps: LDAPClientConnection = await connectLDAP({url: LDAPS, tls: TLS})
        await ldaps.bind(ADMIN, PASSWORD)
        assert.equal(ldaps.secure, true)
        await assert.rejects(ldaps.bind(ADMIN, 'wrong'), LDAPInvalidCredentialsException)
        await ldaps.close()
    })

    it('pages a search of 1200 entries, and iterates it', async () => {
        const result = await admin.search(PEOPLE, {scope: 'one', filter: filter`(objectClass=${'inetOrgPerson'})`, attributes: ['uid'], paged: {pageSize: 100}})
        assert.equal(result.entries.length, 1200)
        let count: number = 0
        for await (const entry of admin.searchIterator(PEOPLE, {scope: 'one', attributes: ['uid'], paged: {pageSize: 250}})) {
            assert.ok(entry.first('uid')?.startsWith('user'))
            count++
        }
        assert.equal(count, 1200)
        let early: number = 0
        for await (const entry of admin.searchIterator(PEOPLE, {scope: 'one', attributes: ['uid'], paged: {pageSize: 100}})) {
            void entry
            if (++early === 150) break
        }
        assert.equal((await admin.search(PEOPLE, {scope: 'base'})).entries.length, 1)
    })

    it('runs searches in parallel on one connection', async () => {
        const results = await Promise.all(Array.from({length: 8}, (_, index) => admin.search(PEOPLE, {filter: filter`(uid=${'user' + index})`, attributes: ['uid']})))
        assert.deepEqual(results.map((result) => result.entries[0].first('uid')), Array.from({length: 8}, (_, index) => `user${index}`))
    })

    it('finds values with parentheses and asterisks, escaped by the template', async () => {
        await admin.modify(`uid=user4,${PEOPLE}`, {operation: 'replace', attribute: 'description', values: 'group (a*b)'})
        const found = await admin.search(PEOPLE, {filter: filter`(description=${'group (a*b)'})`})
        assert.deepEqual(found.entries.map((entry) => entry.dn), [`uid=user4,${PEOPLE}`])
    })

    it('stops at the size limit it asks for, and filters as the server does', async () => {
        const limited = await admin.search(PEOPLE, {scope: 'one', sizeLimit: 5})
        assert.equal(limited.truncated, true)
        assert.equal(limited.entries.length, 5)
        const some = await admin.search(PEOPLE, {filter: Filter.and(Filter.equal('objectClass', 'inetOrgPerson'), Filter.substrings('uid', {initial: 'user11'}))})
        assert.equal(some.entries.length, 111)
        const exact = await admin.search(PEOPLE, {filter: '(&(uid=user7)(mail=USER7@EXAMPLE.COM))'})
        assert.equal(exact.entries.length, 1)
    })

    it('compares, modifies, renames, moves and deletes, the failures with their exceptions', async () => {
        const dn: string = `uid=user1,${PEOPLE}`
        assert.equal(await admin.compare(dn, 'mail', 'user1@example.com'), true)
        assert.equal(await admin.compare(dn, 'mail', 'nobody@example.com'), false)
        await assert.rejects(admin.compare(`uid=nobody,${PEOPLE}`, 'mail', 'x'), LDAPNoSuchObjectException)
        await admin.modify(dn, [{operation: 'replace', attribute: 'description', values: ['first', 'second']}, {operation: 'add', attribute: 'telephoneNumber', values: '+86 10 1234 5678'}])
        const modified = await admin.search(dn, {scope: 'base', attributes: ['description', 'telephoneNumber']})
        assert.deepEqual(modified.entries[0].get('description').sort(), ['first', 'second'])
        await admin.modifyDN(dn, 'uid=renamed1', {deleteOldRDN: true})
        await assert.rejects(admin.add(`uid=renamed1,${PEOPLE}`, {objectClass: 'inetOrgPerson', uid: 'renamed1', cn: 'x', sn: 'x'}), LDAPEntryAlreadyExistsException)
        await admin.add(`ou=moved-${process.pid},${BASE}`, {objectClass: 'organizationalUnit', ou: `moved-${process.pid}`})
        await admin.modifyDN(`uid=renamed1,${PEOPLE}`, 'uid=user1', {newSuperior: `ou=moved-${process.pid},${BASE}`})
        await assert.rejects(admin.delete(`ou=moved-${process.pid},${BASE}`), LDAPNotAllowedOnNonLeafException)
        await admin.modifyDN(`uid=user1,ou=moved-${process.pid},${BASE}`, 'uid=user1', {newSuperior: PEOPLE})
        await admin.delete(`ou=moved-${process.pid},${BASE}`)
    })

    it('keeps binary values as bytes', async () => {
        const photo: Buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x80, 0x81])
        await admin.modify(`uid=user2,${PEOPLE}`, {operation: 'replace', attribute: 'jpegPhoto', values: photo})
        const entry = (await admin.search(`uid=user2,${PEOPLE}`, {scope: 'base', attributes: ['jpegPhoto']})).entries[0]
        assert.deepEqual(entry.getBuffers('jpegPhoto')[0], photo)
    })

    it('changes a password with Password Modify, and binds with the generated one', async () => {
        const dn: string = `uid=user3,${PEOPLE}`
        const generated: string | undefined = await admin.passwordModify({userIdentity: dn})
        assert.ok(generated)
        const user: LDAPClientConnection = await connectLDAP({url: URL!, startTLS: true, tls: TLS})
        await user.bind(dn, generated!)
        assert.equal(await user.whoAmI(), `dn:${dn}`)
        await user.passwordModify({oldPassword: generated, newPassword: 'chosen'})
        await user.close()
        const again: LDAPClientConnection = await connectLDAP({url: URL!, startTLS: true, tls: TLS})
        await again.bind(dn, 'chosen')
        await again.close()
    })

    it('shares its {PBKDF2-SHA512} hashes with the pw-pbkdf2 module of OpenLDAP, both ways', async () => {
        //The module of the image, loaded through cn=config
        const config: LDAPClientConnection = await connectLDAP({url: URL!, startTLS: true, tls: TLS})
        await config.bind('cn=admin,cn=config', CONFIG_PASSWORD)
        const modules = await config.search('cn=config', {scope: 'one', filter: '(objectClass=olcModuleList)', attributes: ['olcModuleLoad']})
        const loaded: boolean = modules.entries.some((entry) => entry.get('olcModuleLoad').some((value) => value.includes('pw-pbkdf2')))
        if (!loaded) await config.modify(modules.entries[0].dn, {operation: 'add', attribute: 'olcModuleLoad', values: 'pw-pbkdf2'})
        const schemes: PasswordSchemes = new PasswordSchemes({iterations: 10000})
        const dn: string = `uid=pbkdf2,${PEOPLE}`
        await admin.add(dn, {objectClass: 'inetOrgPerson', uid: 'pbkdf2', cn: 'PBKDF2', sn: 'Hash', userPassword: await schemes.hash('our-hash')})
        const user: LDAPClientConnection = await connectLDAP({url: URL!, startTLS: true, tls: TLS})
        await user.bind(dn, 'our-hash')
        await user.close()
        //A hash written by OpenLDAP, read back and verified by the engine
        await config.modify('olcDatabase={-1}frontend,cn=config', {operation: 'replace', attribute: 'olcPasswordHash', values: '{PBKDF2-SHA512}'})
        await admin.passwordModify({userIdentity: dn, newPassword: 'their-hash'})
        const stored: string = (await admin.search(dn, {scope: 'base', attributes: ['userPassword']})).entries[0].getBuffers('userPassword')[0].toString()
        assert.match(stored, /^\{PBKDF2-SHA512\}\d+\$/)
        assert.equal(await schemes.verify(stored, 'their-hash'), true)
        assert.equal(await schemes.verify(stored, 'our-hash'), false)
        await config.modify('olcDatabase={-1}frontend,cn=config', {operation: 'delete', attribute: 'olcPasswordHash'})
        await config.close()
    })

    it('manages the directory of OpenLDAP with the directory helper, an empty group included', async () => {
        const client: LDAPPool = createLDAPClient({url: URL!, startTLS: true, tls: TLS, bindDN: ADMIN, password: PASSWORD})
        const directory = createDirectory(client)
        const unit: string = await directory.createOrganizationalUnit(BASE, {ou: `helper-${process.pid}`})
        const user: string = await directory.createUser(unit, {uid: 'helper', cn: 'Helper', sn: 'H'}, 'helper-password')
        assert.equal(await directory.verifyPassword(user, 'helper-password'), true)
        assert.equal(await directory.verifyPassword(user, 'wrong'), false)
        const group: string = await directory.createGroup(unit, {cn: 'helpers'})
        await directory.addMember(group, user)
        assert.deepEqual(await directory.groupsOf(unit, user), [group])
        await directory.removeMember(group, user)
        assert.deepEqual((await directory.find(group, {scope: 'base'}))[0].get('member'), [''])
        const exported: string = await directory.exportLDIF(unit)
        assert.match(exported, /dn: uid=helper,ou=helper-/)
        await directory.delete(unit, {subtree: true}).catch(async () => {
            //OpenLDAP refuses the tree delete control: the entries one by one
            for (const dn of [user, group, unit]) await client.delete(dn)
        })
        await client.close()
    })

    it('authenticates users with a pool, and reads the schema of the server', async () => {
        const client: LDAPPool = createLDAPClient({url: URL!, startTLS: true, tls: TLS, bindDN: ADMIN, password: PASSWORD})
        const good = await client.authenticate({username: 'user10', password: 'password10', base: PEOPLE})
        assert.deepEqual([good.ok, good.dn], [true, `uid=user10,${PEOPLE}`])
        const bad = await client.authenticate({username: 'user10', password: 'wrong', base: PEOPLE})
        assert.deepEqual([bad.ok, bad.reason], [false, 'invalidCredentials'])
        const nobody = await client.authenticate({username: 'nobody', password: 'x', base: PEOPLE})
        assert.deepEqual([nobody.ok, nobody.detail], [false, 'no entry found'])
        const schema: Schema = await readSchema(client)
        assert.equal(schema.equality('cn')?.names[0], 'caseIgnoreMatch')
        assert.ok(schema.isBinary('jpegPhoto'))
        assert.ok(schema.attributesOf(['inetOrgPerson']).must.includes('sn'))
        await client.close()
    })
})

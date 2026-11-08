import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {createDirectory, createLDAPServer, type Directory, type LDAPServerEngine, MemoryBackend} from '../exports/LDAPEngine.js'

const BASE: string = 'dc=example,dc=com'
const ADMIN: string = 'cn=admin,dc=example,dc=com'

/**
 * A directory on an in-process connection of a server
 */
async function directory(): Promise<{server: LDAPServerEngine, directory: Directory}> {
    const server: LDAPServerEngine = createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ADMIN]}, passwords: {iterations: 1000}})
    const created: Directory = createDirectory(server.connect({as: ADMIN}))
    await created.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
    return {server: server, directory: created}
}

describe('the directory helper', () => {
    it('creates organizational units, users with their passwords, groups, and manages the members', async () => {
        const {directory: dir} = await directory()
        const people: string = await dir.createOrganizationalUnit(BASE, {ou: 'people'})
        const groups: string = await dir.createOrganizationalUnit(BASE, {ou: 'groups', description: 'The groups'})
        assert.equal(people, `ou=people,${BASE}`)
        const alice: string = await dir.createUser(people, {uid: 'alice', cn: 'Alice Liu', sn: 'Liu', mail: 'alice@example.com'}, 'secret')
        const bob: string = await dir.createUser(people, {uid: 'bob, jr.', cn: 'Bob', sn: 'Wang'})
        assert.equal(bob, `uid=bob\\, jr.,ou=people,${BASE}`)
        assert.equal(await dir.verifyPassword(alice, 'secret'), true)
        assert.equal(await dir.verifyPassword(alice, 'wrong'), false)
        assert.equal(await dir.verifyPassword(alice, ''), false)
        await dir.setPassword(bob, 'bob-password')
        assert.equal(await dir.verifyPassword(bob, 'bob-password'), true)
        const developers: string = await dir.createGroup(groups, {cn: 'developers'})
        assert.deepEqual((await dir.find(developers, {scope: 'base'}))[0].get('member'), [''])
        await dir.addMember(developers, alice)
        await dir.addMember(developers, bob)
        assert.deepEqual((await dir.find(developers, {scope: 'base'}))[0].get('member').sort(), [alice, bob].sort())
        assert.deepEqual(await dir.groupsOf(BASE, alice), [developers])
        await dir.removeMember(developers, alice)
        await dir.removeMember(developers, bob)
        assert.deepEqual((await dir.find(developers, {scope: 'base'}))[0].get('member'), [''])
        const admins: string = await dir.createGroup(groups, {cn: 'admins'}, [alice])
        assert.deepEqual(await dir.groupsOf(BASE, alice), [admins])
    })

    it('moves, renames and deletes entries, and imports and exports LDIF', async () => {
        const {directory: dir} = await directory()
        const ldif: string = [
            `dn: ou=staff,${BASE}`, 'objectClass: organizationalUnit', 'ou: staff', '',
            `dn: uid=carol,ou=staff,${BASE}`, 'objectClass: inetOrgPerson', 'uid: carol', 'cn: Carol', 'sn: Chen', '',
            `dn: uid=carol,ou=staff,${BASE}`, 'changetype: modify', 'add: mail', 'mail: carol@example.com', '-', ''
        ].join('\n')
        assert.deepEqual(await dir.importLDIF(ldif), {added: 2, modified: 1, deleted: 0, renamed: 0})
        const other: string = await dir.createOrganizationalUnit(BASE, {ou: 'other'})
        const moved: string = await dir.move(`uid=carol,ou=staff,${BASE}`, other)
        assert.equal(moved, `uid=carol,ou=other,${BASE}`)
        const renamed: string = await dir.rename(moved, 'caroline')
        assert.equal(renamed, `uid=caroline,ou=other,${BASE}`)
        const exported: string = await dir.exportLDIF(other)
        assert.match(exported, /dn: uid=caroline,ou=other,dc=example,dc=com/)
        assert.ok(exported.indexOf('dn: ou=other') < exported.indexOf('dn: uid=caroline'))
        await dir.delete(other, {subtree: true})
        assert.equal((await dir.find(BASE, {filter: '(uid=caroline)'})).length, 0)
    })

    it('takes a profile of its own', async () => {
        const {server} = await directory()
        const own: Directory = createDirectory(server.connect({as: ADMIN}), {profile: {user: {objectClasses: ['person'], rdn: 'cn'}, group: {objectClasses: ['groupOfUniqueNames'], rdn: 'cn', member: 'uniqueMember'}}})
        const user: string = await own.createUser(BASE, {cn: 'Dave', sn: 'Dong'})
        const group: string = await own.createGroup(BASE, {cn: 'team'}, [user])
        assert.deepEqual((await own.find(group, {scope: 'base'}))[0].get('uniqueMember'), [user])
        assert.deepEqual((await own.find(user, {scope: 'base'}))[0].get('objectClass').sort(), ['person', 'top'])
    })
})

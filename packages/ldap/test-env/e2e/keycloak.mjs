//Keycloak against the server on this machine: the base URL of Keycloak and the port of the server as arguments. A realm
//with the LDAP user federation (writable, entryUUID, paged) and a group mapper on groupOfNames; a full sync, then the
//users, the groups, logins with the direct grant, a password reset by Keycloak written back to the directory.
import {connectLDAP} from '../../dist/esm/exports/LDAP.js'

const [keycloak, port] = process.argv.slice(2)
const REALM = 'directory'
let failed = false
const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    if (!ok) failed = true
    console.log(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : `: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`)
}
for (let attempt = 0; ; attempt++) {
    try {
        if ((await fetch(`${keycloak}/realms/master`)).ok) break
    } catch {
        //Not started yet
    }
    if (attempt > 120) throw new Error('Keycloak did not start')
    await new Promise((resolve) => setTimeout(resolve, 1000))
}
const token = async (realm, client, username, password) => fetch(`${keycloak}/realms/${realm}/protocol/openid-connect/token`, {method: 'POST', body: new URLSearchParams({grant_type: 'password', client_id: client, username: username, password: password})})
const adminToken = (await (await token('master', 'admin-cli', 'admin', 'admin')).json()).access_token
const api = async (method, path, body) => {
    const response = await fetch(`${keycloak}/admin/realms${path}`, {method: method, headers: {authorization: `Bearer ${adminToken}`, 'content-type': 'application/json'}, ...body ? {body: JSON.stringify(body)} : {}})
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`)
    const text = await response.text()
    return text ? JSON.parse(text) : undefined
}
await api('POST', '', {realm: REALM, enabled: true})
const realmId = (await api('GET', `/${REALM}`)).id
await api('POST', `/${REALM}/components`, {
    name: 'directory',
    providerId: 'ldap',
    providerType: 'org.keycloak.storage.UserStorageProvider',
    parentId: realmId,
    config: {
        enabled: ['true'], priority: ['0'], editMode: ['WRITABLE'], syncRegistrations: ['false'], vendor: ['other'],
        usernameLDAPAttribute: ['uid'], rdnLDAPAttribute: ['uid'], uuidLDAPAttribute: ['entryUUID'],
        userObjectClasses: ['inetOrgPerson, organizationalPerson'], connectionUrl: [`ldap://host.docker.internal:${port}`],
        usersDn: ['ou=people,dc=example,dc=com'], authType: ['simple'], bindDn: ['cn=admin,dc=example,dc=com'], bindCredential: ['secret'],
        searchScope: ['1'], pagination: ['true'], batchSizeForSync: ['2'], importEnabled: ['true'], usePasswordModifyExtendedOp: ['true'], trustEmail: ['true']
    }
})
const provider = (await api('GET', `/${REALM}/components?type=org.keycloak.storage.UserStorageProvider`))[0]
await api('POST', `/${REALM}/components`, {
    name: 'groups',
    providerId: 'group-ldap-mapper',
    providerType: 'org.keycloak.storage.ldap.mappers.LDAPStorageMapper',
    parentId: provider.id,
    config: {
        'groups.dn': ['ou=groups,dc=example,dc=com'], 'group.name.ldap.attribute': ['cn'], 'group.object.classes': ['groupOfNames'],
        'membership.ldap.attribute': ['member'], 'membership.attribute.type': ['DN'], 'membership.user.ldap.attribute': ['uid'],
        mode: ['READ_ONLY'], 'user.roles.retrieve.strategy': ['LOAD_GROUPS_BY_MEMBER_ATTRIBUTE'], 'preserve.group.inheritance': ['false'], 'drop.non.existing.groups.during.sync': ['false']
    }
})
const mapper = (await api('GET', `/${REALM}/components?parent=${provider.id}&type=org.keycloak.storage.ldap.mappers.LDAPStorageMapper`)).find((item) => item.name === 'groups')
const synced = await api('POST', `/${REALM}/user-storage/${provider.id}/sync?action=triggerFullSync`)
check('the full sync imports the three users', [synced.added, synced.failed], [3, 0])
await api('POST', `/${REALM}/user-storage/${provider.id}/mappers/${mapper.id}/sync?direction=fedToKeycloak`)
const users = await api('GET', `/${REALM}/users?briefRepresentation=false`)
check('the users and their mails', users.map((user) => `${user.username} ${user.email}`).sort(), ['alice alice@example.com', 'bob bob@example.com', 'carol carol@example.com'])
const alice = users.find((user) => user.username === 'alice')
check('the entryUUID of alice is her LDAP ID', /^[0-9a-f-]{36}$/.test(alice.attributes?.LDAP_ID?.[0] ?? ''), true)
const group = (await api('GET', `/${REALM}/groups`)).find((item) => item.name === 'developers')
check('the group developers and its members', (await api('GET', `/${REALM}/groups/${group?.id}/members`)).map((user) => user.username).sort(), ['alice', 'bob'])
await api('POST', `/${REALM}/clients`, {clientId: 'tester', publicClient: true, directAccessGrantsEnabled: true})
check('alice logs in with her password', (await token(REALM, 'tester', 'alice', 'alice-password')).status, 200)
check('a wrong password is refused', (await token(REALM, 'tester', 'alice', 'wrong')).status, 401)
await api('PUT', `/${REALM}/users/${alice.id}/reset-password`, {type: 'password', value: 'alice-new-password', temporary: false})
check('alice logs in with the password Keycloak set', (await token(REALM, 'tester', 'alice', 'alice-new-password')).status, 200)
const connection = await connectLDAP(`ldap://127.0.0.1:${port}`)
await connection.bind('uid=alice,ou=people,dc=example,dc=com', 'alice-new-password')
check('the password reaches the directory, hashed by the server', await connection.whoAmI(), 'dn:uid=alice,ou=people,dc=example,dc=com')
await connection.close()
await api('PUT', `/${REALM}/users/${alice.id}`, {firstName: alice.firstName, lastName: 'Liu', email: alice.email})
const read = await connectLDAP(`ldap://127.0.0.1:${port}`)
await read.bind('cn=admin,dc=example,dc=com', 'secret')
check('a change of Keycloak is written to the directory', (await read.search('uid=alice,ou=people,dc=example,dc=com', {scope: 'base', attributes: ['sn']})).entries[0].first('sn'), 'Liu')
await read.close()
process.exit(failed ? 1 : 0)

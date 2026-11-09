//The LDAP server the end-to-end checks run against: the LDAPServer component with a directory backend on SQLite (a file
//given as the first argument), a few POSIX users with passwords and SSH keys, a group; it writes `listening <port>`
//once it listens on the loopback, and on the Unix socket given as the second argument. Build the package first.
import {Container} from '@lakutata/core'
import {Database} from '@lakutata/orm/com/database'
import {DirectoryBackend, directoryEntities, LDAPServer} from '../../dist/esm/exports/LDAP.js'

const file = process.argv[2]
const BASE = 'dc=example,dc=com'
const ADMIN = `cn=admin,${BASE}`
const container = new Container()
await container.setNamed('database', Database, {options: {type: 'better-sqlite3', database: file, entities: directoryEntities('better-sqlite3'), synchronize: true}})
await container.setNamed('ldap', LDAPServer, {
    host: '127.0.0.1',
    port: Number(process.env.LDAP_PORT ?? 0),
    ldapiPath: process.argv[3],
    ldapiMode: 0o666,
    //The POSIX accounts and groups (SSSD) and the SSH public keys (SSSD, Gitea), besides the default schemas
    schema: {bundled: ['core', 'cosine', 'inetorgperson', 'rfc2307bis', 'openssh-lpk']},
    backends: [{class: DirectoryBackend, database: 'database', suffix: BASE, unique: ['uid'], initialize: {admin: {dn: ADMIN, password: 'secret'}}}],
    access: {admins: [ADMIN], passwordAdmins: [ADMIN]},
    passwords: {iterations: 10000}
})
const ldap = await container.get('ldap')
const directory = ldap.directory(ADMIN)
const people = await directory.createOrganizationalUnit(BASE, {ou: 'people'})
const groups = await directory.createOrganizationalUnit(BASE, {ou: 'groups'})
const users = []
for (const [index, name] of ['alice', 'bob', 'carol'].entries()) {
    users.push(await directory.createUser(people, {
        objectClass: ['posixAccount', 'shadowAccount', 'ldapPublicKey'],
        uid: name,
        cn: name[0].toUpperCase() + name.slice(1),
        sn: 'Example',
        givenName: name,
        mail: `${name}@example.com`,
        homeDirectory: `/home/${name}`,
        loginShell: '/bin/sh',
        sshPublicKey: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${'A'.repeat(42)}${index} ${name}@example`
    }, `${name}-password`))
}
await directory.createGroup(groups, {objectClass: 'posixGroup', cn: 'developers', gidNumber: '20000'}, users.slice(0, 2))
console.log(`listening ${ldap.ports.ldap}`)
const stop = async () => {
    await container.destroy()
    process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

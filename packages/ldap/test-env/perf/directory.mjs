//The throughput of the LDAPServer component with the directory backend, through the network client: binds, reads by
//DN and searches by uid among 1000 users, 16 connections. The database options as JSON in the first argument (SQLite in
//a temporary file by default).
import {rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Container} from '@lakutata/core'
import {Database} from '@lakutata/orm/com/database'
import {connectLDAP, DirectoryBackend, directoryEntities, LDAPServer} from '../../dist/esm/exports/LDAP.js'

const file = join(tmpdir(), `lakutata-ldap-perf-${process.pid}.sqlite`)
const database = process.argv[2] ? JSON.parse(process.argv[2]) : {type: 'better-sqlite3', database: file}
const BASE = 'dc=example,dc=com'
const ADMIN = `cn=admin,${BASE}`
const container = new Container()
await container.setNamed('database', Database, {options: {...database, entities: directoryEntities(database.type), synchronize: true}})
await container.setNamed('ldap', LDAPServer, {
    host: '127.0.0.1',
    port: 0,
    backends: [{class: DirectoryBackend, database: 'database', suffix: BASE, lastBind: false, initialize: {admin: {dn: ADMIN, password: 'secret'}}}],
    access: {admins: [ADMIN]},
    passwords: {scheme: 'SSHA'},
    rehashOnBind: false,
    bindThrottle: {maxFailures: 0, ipMaxFailures: 0, delay: 0}
})
const ldap = await container.get('ldap')
const admin = ldap.connect(ADMIN)
await admin.add(`ou=people,${BASE}`, {objectClass: 'organizationalUnit', ou: 'people'})
for (let index = 0; index < 1000; index++) await admin.add(`uid=user${index},ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: `user${index}`, cn: `User ${index}`, sn: 'Test', mail: `user${index}@example.com`, userPassword: `password${index}`})
const url = `ldap://127.0.0.1:${ldap.ports.ldap}`
async function phase(name, setup, operation, seconds = 5, concurrency = 16) {
    const connections = await Promise.all(Array.from({length: concurrency}, async () => setup(await connectLDAP(url))))
    const end = Date.now() + seconds * 1000
    let count = 0
    await Promise.all(connections.map(async (connection, worker) => {
        let index = worker
        while (Date.now() < end) {
            await operation(connection, index % 1000)
            index += concurrency
            count++
        }
    }))
    await Promise.all(connections.map((connection) => connection.close()))
    console.log(`${name}: ${Math.round(count / seconds)}/s`)
}
const asAdmin = async (connection) => {
    await connection.bind(ADMIN, 'secret')
    return connection
}
await phase('bind', (connection) => connection, (connection, index) => connection.bind(`uid=user${index},ou=people,${BASE}`, `password${index}`))
await phase('read by DN', asAdmin, (connection, index) => connection.search(`uid=user${index},ou=people,${BASE}`, {scope: 'base', attributes: ['cn', 'mail'], paged: false}))
await phase('search (uid=…)', asAdmin, (connection, index) => connection.search(`ou=people,${BASE}`, {filter: `(uid=user${index})`, attributes: ['cn', 'mail'], paged: false}))
await phase('search (mail=…*)', asAdmin, (connection, index) => connection.search(`ou=people,${BASE}`, {filter: `(mail=user${index}@*)`, attributes: ['cn'], paged: false}))
await container.destroy()
rmSync(file, {force: true})

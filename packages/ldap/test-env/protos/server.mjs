//The server the PROTOS test cases are replayed against, in a process of its own (run by run.mjs with --expose-gc): the
//engine with a memory backend (`engine`), or the LDAPServer component with a directory backend on SQLite (`component`,
//the file as the second argument). A user uid=alice,ou=people,dc=example,dc=com (password alice-password) for the
//probes. It tells its parent its port, and answers `stats` with its heap after a collection, its open connections and
//the errors of the engine (an error of a backend or an interceptor that is not a result: a bug for these cases).
import {Container} from '@lakutata/core'
import {Database} from '@lakutata/orm/com/database'
import {createDirectory, createLDAPServer, DirectoryBackend, directoryEntities, LDAPServer, MemoryBackend} from '../../dist/esm/exports/LDAP.js'

const [mode, file] = process.argv.slice(2)
const BASE = 'dc=example,dc=com'
const ADMIN = `cn=admin,${BASE}`

/**
 * The users of the directory
 */
async function populate(directory) {
    const people = await directory.createOrganizationalUnit(BASE, {ou: 'people'})
    const groups = await directory.createOrganizationalUnit(BASE, {ou: 'groups'})
    const users = []
    for (const name of ['alice', 'bob', 'carol']) users.push(await directory.createUser(people, {uid: name, cn: name, sn: 'Example', mail: `${name}@example.com`}, `${name}-password`))
    await directory.createGroup(groups, {cn: 'developers'}, users.slice(0, 2))
}

let engine
let port
let stop
if (mode === 'engine') {
    engine = createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ADMIN]}, passwords: {iterations: 1000}})
    const directory = createDirectory(engine.connect({as: ADMIN}))
    await directory.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
    await populate(directory)
    port = await engine.listen({host: '127.0.0.1', port: 0})
    stop = () => engine.close()
} else {
    const container = new Container()
    await container.setNamed('database', Database, {options: {type: 'better-sqlite3', database: file, entities: directoryEntities('better-sqlite3'), synchronize: true}})
    await container.setNamed('ldap', LDAPServer, {
        host: '127.0.0.1',
        port: 0,
        backends: [{class: DirectoryBackend, database: 'database', suffix: BASE, initialize: {admin: {dn: ADMIN, password: 'secret'}}}],
        access: {admins: [ADMIN]},
        passwords: {iterations: 1000}
    })
    const ldap = await container.get('ldap')
    await populate(ldap.directory(ADMIN))
    engine = ldap.engine
    port = ldap.ports.ldap
    stop = () => container.destroy()
}

const errors = []
engine.events.on('error', (error) => errors.push(String(error?.stack ?? error)))
process.send({type: 'ready', port: port})
process.on('message', async (message) => {
    if (message.type === 'stats') {
        globalThis.gc()
        globalThis.gc()
        //The open connections, as the server counts them for its limit of connections
        process.send({type: 'stats', heapUsed: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss, connections: engine.connections.size, errors: errors.splice(0)})
    } else if (message.type === 'stop') {
        await stop()
        process.exit(0)
    }
})

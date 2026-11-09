//The client the hostile server of run.mjs talks to, in a process of its own (with --expose-gc): it runs the operation a
//case names, on a connection of its own (the engine's client) or through the LDAPClient component, and tells how it
//ended: a result, an exception of the package, or anything else (a failure). It answers `stats` with its heap after a
//collection and the resources that keep it alive; an uncaught exception or rejection is told, then it exits.
import {Container} from '@lakutata/core'
import {connectLDAP, LDAPClient, LDAPException} from '../../dist/esm/exports/LDAP.js'

const BASE = 'dc=example,dc=com'
const SETTINGS = {timeout: 1500, connectTimeout: 1500, maxMessageSize: 1024 * 1024}
const inFlight = new Set()

//The operations, by name
const OPERATIONS = {
    bind: (client) => client.bind(`cn=admin,${BASE}`, 'secret'),
    search: (client) => client.search(BASE, {filter: '(objectClass=*)', sizeLimit: 10, paged: false}),
    //A size limit: a server that pages for ever with entries is a large directory, the limit the client's own bound
    paged: (client) => client.search(BASE, {filter: '(objectClass=*)', sizeLimit: 50, paged: {pageSize: 2}}),
    iterate: async (client) => {
        let count = 0
        for await (const entry of client.searchIterator(BASE, {filter: '(objectClass=*)', sizeLimit: 50, paged: {pageSize: 2}})) count += entry ? 1 : 0
        return count
    },
    window: (client) => client.search(BASE, {sort: [{attribute: 'cn'}], window: {offset: 1, limit: 2}}),
    compare: (client) => client.compare(`cn=a,${BASE}`, 'cn', 'a'),
    add: (client) => client.add(`cn=b,${BASE}`, {objectClass: ['person'], cn: 'b', sn: 'b'}),
    modify: (client) => client.modify(`cn=a,${BASE}`, {operation: 'replace', attribute: 'sn', values: ['c']}),
    delete: (client) => client.delete(`cn=a,${BASE}`),
    modifyDN: (client) => client.modifyDN(`cn=a,${BASE}`, 'cn=d'),
    whoAmI: (client) => client.whoAmI(),
    passwordModify: (client) => client.passwordModify({}),
    sasl: (client) => client.saslBind('X-TEST', Buffer.from('first'), {step: () => Buffer.from('next')}),
    startTLS: (client) => client.startTLS({rejectUnauthorized: false})
}

/**
 * How an operation ended: a result, an exception of the package by its name, or something else
 */
function ending(error) {
    if (error === undefined) return {kind: 'resolved'}
    if (error instanceof LDAPException) return {kind: 'rejected', name: error.constructor.name, message: String(error.message).slice(0, 160)}
    return {kind: 'foreign', name: error?.constructor?.name ?? typeof error, message: String(error?.stack ?? error).slice(0, 600)}
}

/**
 * Wait for a promise, at most some milliseconds: whether it settled
 */
async function within(promise, milliseconds) {
    let timer
    const settled = await Promise.race([promise.then(() => true, () => true), new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds)
    })])
    clearTimeout(timer)
    return settled
}

/**
 * Run a case on a connection of its own: the operation, then close()
 */
async function direct(test) {
    let connection
    let error
    const started = performance.now()
    try {
        connection = await connectLDAP({url: `ldap://127.0.0.1:${test.port}`, ...SETTINGS})
        await OPERATIONS[test.operation](connection)
    } catch (reason) {
        error = reason ?? new Error('undefined thrown')
    }
    const time = performance.now() - started
    const closed = connection ? await within(connection.close(), 2000) : true
    return {...ending(error), time: time, closed: closed}
}

/**
 * Run a case through the LDAPClient component: the servers of the case in order, the operations one after another,
 * each ending told
 */
async function component(test) {
    const container = new Container()
    const endings = []
    try {
        await container.setNamed('client', LDAPClient, {url: test.urls, poolSize: 2, ...SETTINGS, ...test.options})
        const client = await container.get('client')
        for (const step of test.steps) {
            let error
            try {
                if (step === 'authenticate') await client.authenticate({username: 'alice', password: 'alice-password', base: BASE, requireTLS: false})
                else await OPERATIONS[step](client)
            } catch (reason) {
                error = reason ?? new Error('undefined thrown')
            }
            endings.push({step: step, ...ending(error)})
        }
    } finally {
        endings.closed = await within(container.destroy(), 3000)
    }
    return {kind: 'steps', steps: endings, closed: endings.closed}
}

process.on('uncaughtException', (error) => {
    process.send({type: 'crash', error: String(error?.stack ?? error), inFlight: [...inFlight]}, () => process.exit(1))
})
process.on('unhandledRejection', (error) => {
    process.send({type: 'crash', error: `unhandled rejection: ${String(error?.stack ?? error)}`, inFlight: [...inFlight]}, () => process.exit(1))
})
process.on('message', async (message) => {
    if (message.type === 'case') {
        inFlight.add(message.test.id)
        const result = message.test.urls ? await component(message.test) : await direct(message.test)
        inFlight.delete(message.test.id)
        process.send({type: 'result', id: message.test.id, result: result})
    } else if (message.type === 'stats') {
        globalThis.gc()
        globalThis.gc()
        const resources = {}
        for (const name of process.getActiveResourcesInfo()) resources[name] = (resources[name] ?? 0) + 1
        process.send({type: 'stats', heapUsed: process.memoryUsage().heapUsed, resources: resources})
    }
})
process.send({type: 'ready'})

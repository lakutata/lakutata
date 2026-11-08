import assert from 'node:assert/strict'
import {after, describe, it} from 'node:test'
import {
    connectLDAP,
    createLDAPClient,
    Entry,
    ExtendedOperation,
    filter,
    findControl,
    type LDAPClientConnection,
    LDAPConnectionException,
    LDAPInvalidCredentialsException,
    LDAPNoSuchObjectException,
    type LDAPPool,
    LDAPSizeLimitExceededException,
    LDAPTimeoutException,
    LDAPUsageException,
    PagedResultsControl,
    PasswordModifyRequest,
    PasswordModifyResponse,
    PasswordPolicyResponseControl,
    type SearchRequest,
    SortRequestControl,
    VLVRequestControl,
    VLVResponseControl,
    WhoAmIResponse
} from '../exports/LDAPEngine.js'
import {spawn} from 'node:child_process'
import type {SrvRecord} from 'node:dns'
import {rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {LDAPPool as Pool, orderSrv} from '../lib/client/Pool.js'
import {CERTIFICATE} from './support/Certificate.js'
import {startTestServer, type TestServer, type TestSession} from './support/TestServer.js'

const servers: TestServer[] = []
const connections: LDAPClientConnection[] = []

/**
 * A test server, closed after the tests
 */
async function server(...args: Parameters<typeof startTestServer>): Promise<TestServer> {
    const started: TestServer = await startTestServer(...args)
    servers.push(started)
    return started
}

/**
 * A connection, closed after the tests
 */
async function connect(...args: Parameters<typeof connectLDAP>): Promise<LDAPClientConnection> {
    const connection: LDAPClientConnection = await connectLDAP(...args)
    connections.push(connection)
    return connection
}

/**
 * Close the connections and the servers of the tests run so far, after each group (the hooks of a file run only once
 * its handles are closed on the test runner of Node.js 18)
 */
async function closeAll(): Promise<void> {
    for (const connection of connections.splice(0)) connection.destroy()
    for (const started of servers.splice(0)) await started.close()
}

/**
 * Answer a search with entries numbered from 0, by pages of the paged results control
 */
function pagedSearch(total: number) {
    return (request: unknown, message: {messageId: number, controls?: {oid: string, critical: boolean, value?: Buffer}[]}, session: TestSession): void => {
        const paged = findControl(message.controls, PagedResultsControl)
        const value = paged ? PagedResultsControl.decode(paged) : undefined
        const start: number = value?.cookie.length ? Number(value.cookie.toString()) : 0
        const size: number = value ? value.size : total
        if (value && value.size === 0) {
            session.reply(message.messageId, {type: 'searchResultDone', resultCode: 0, matchedDN: '', diagnosticMessage: ''}, [PagedResultsControl.encode({size: 0, cookie: Buffer.alloc(0)})])
            return
        }
        const end: number = Math.min(total, start + size)
        for (let index: number = start; index < end; index++) session.reply(message.messageId, {type: 'searchResultEntry', objectName: `cn=user${index},dc=example`, attributes: [{type: 'cn', values: [Buffer.from(`user${index}`)]}]})
        session.reply(message.messageId, {type: 'searchResultDone', resultCode: 0, matchedDN: '', diagnosticMessage: ''}, value ? [PagedResultsControl.encode({size: total, cookie: end < total ? Buffer.from(String(end)) : Buffer.alloc(0)})] : [])
    }
}

describe('the connection', () => {
    after(closeAll)

    it('binds, and refuses an empty password with a DN before anything is sent', async () => {
        const started: TestServer = await server({
            bindRequest: (request, message, session) => {
                const ok: boolean = request.type === 'bindRequest' && request.authentication.type === 'simple' && (request.authentication.password.toString() === 'secret' || (request.name === '' && !request.authentication.password.length))
                session.reply(message.messageId, {type: 'bindResponse', resultCode: ok ? 0 : 49, matchedDN: '', diagnosticMessage: ok ? '' : 'AcceptSecurityContext error, data 52e, v3839'})
            }
        })
        const connection: LDAPClientConnection = await connect(started.url)
        await connection.bind('cn=admin', 'secret')
        await assert.rejects(connection.bind('cn=admin', 'wrong'), (error: unknown) => error instanceof LDAPInvalidCredentialsException && error.adDataCode === '52e')
        const before: number = started.received.length
        await assert.rejects(connection.bind('cn=admin', ''), LDAPUsageException)
        assert.equal(started.received.length, before)
        await connection.bind('', '')
        await assert.rejects(connection.bind('cn=admin', '', {allowUnauthenticated: true}), LDAPInvalidCredentialsException)
    })

    it('searches page after page, and gives the entries their DN and attributes', async () => {
        const started: TestServer = await server({searchRequest: pagedSearch(1234) as never})
        const connection: LDAPClientConnection = await connect(started.url)
        const result = await connection.search('dc=example', {filter: filter`(cn=${'user*'})`, paged: {pageSize: 500}})
        assert.equal(result.entries.length, 1234)
        assert.equal(result.entries[1233].dn, 'cn=user1233,dc=example')
        assert.equal(result.entries[0].first('cn'), 'user0')
        const searches = started.received.filter((message) => message.protocolOp.type === 'searchRequest')
        assert.equal(searches.length, 3)
        assert.equal((searches[0].protocolOp as SearchRequest).filter.type, 'equality')
    })

    it('does not page a base search, nor one whose size limit is not above the page size, nor one paged by the caller', async () => {
        const started: TestServer = await server({searchRequest: pagedSearch(3) as never})
        const connection: LDAPClientConnection = await connect(started.url)
        await connection.search('dc=example', {scope: 'base'})
        await connection.search('dc=example', {sizeLimit: 100})
        for (const message of started.received.filter((item) => item.protocolOp.type === 'searchRequest')) assert.equal(findControl(message.controls, PagedResultsControl), undefined)
        await connection.search('dc=example', {controls: [PagedResultsControl.encode({size: 2, cookie: Buffer.alloc(0)})]})
        const own = started.received.filter((item) => item.protocolOp.type === 'searchRequest').at(-1)!
        assert.equal(own.controls?.filter((control) => control.oid === PagedResultsControl.oid).length, 1)
        assert.equal(PagedResultsControl.decode(findControl(own.controls, PagedResultsControl)!).size, 2)
    })

    it('iterates the entries, and ends the paging on the server when the loop is left early', async () => {
        const started: TestServer = await server({searchRequest: pagedSearch(25) as never})
        const connection: LDAPClientConnection = await connect(started.url)
        const names: string[] = []
        for await (const entry of connection.searchIterator('dc=example', {paged: {pageSize: 10}})) {
            names.push(entry.first('cn')!)
            if (names.length === 12) break
        }
        assert.equal(names.length, 12)
        const searches = started.received.filter((message) => message.protocolOp.type === 'searchRequest')
        const last = searches[searches.length - 1]
        assert.equal(PagedResultsControl.decode(findControl(last.controls, PagedResultsControl)!).size, 0)
        const all: string[] = []
        for await (const entry of connection.searchIterator('dc=example', {paged: {pageSize: 10}})) all.push(entry.dn)
        assert.equal(all.length, 25)
    })

    it('gives the entries before a size limit it asked for, and throws for the server\'s own limit with them', async () => {
        const started: TestServer = await server({
            searchRequest: (request, message, session) => {
                for (let index: number = 0; index < 3; index++) session.reply(message.messageId, {type: 'searchResultEntry', objectName: `cn=${index}`, attributes: []})
                session.reply(message.messageId, {type: 'searchResultDone', resultCode: 4, matchedDN: '', diagnosticMessage: ''})
            }
        })
        const connection: LDAPClientConnection = await connect(started.url)
        const limited = await connection.search('dc=example', {sizeLimit: 3})
        assert.equal(limited.truncated, true)
        assert.equal(limited.entries.length, 3)
        await assert.rejects(connection.search('dc=example', {paged: false}), (error: unknown) => error instanceof LDAPSizeLimitExceededException && error.partial?.length === 3)
    })

    it('abandons an operation that times out, and goes on with the connection', async () => {
        const started: TestServer = await server({
            compareRequest: (request, message, session) => {
                if (request.type === 'compareRequest' && request.attribute === 'slow') return
                session.reply(message.messageId, {type: 'compareResponse', resultCode: 6, matchedDN: '', diagnosticMessage: ''})
            }
        })
        const connection: LDAPClientConnection = await connect(started.url)
        await assert.rejects(connection.compare('cn=x', 'slow', 'y', {timeout: 100}), LDAPTimeoutException)
        await new Promise((resolve) => setTimeout(resolve, 50))
        const abandon = started.received.find((message) => message.protocolOp.type === 'abandonRequest')
        assert.ok(abandon)
        assert.equal(await connection.compare('cn=x', 'fast', 'y'), true)
        assert.equal(connection.closed, false)
    })

    it('abandons an operation cancelled by its signal', async () => {
        const started: TestServer = await server({compareRequest: () => undefined})
        const connection: LDAPClientConnection = await connect(started.url)
        const controller: AbortController = new AbortController()
        const pending: Promise<boolean> = connection.compare('cn=x', 'a', 'b', {signal: controller.signal})
        setTimeout(() => controller.abort(new Error('stop')), 20)
        await assert.rejects(pending, /stop/)
        await new Promise((resolve) => setTimeout(resolve, 50))
        assert.ok(started.received.some((message) => message.protocolOp.type === 'abandonRequest'))
    })

    it('closes the connection when a bind times out, a bind not being abandonable', async () => {
        const started: TestServer = await server({bindRequest: () => undefined})
        const connection: LDAPClientConnection = await connect(started.url)
        await assert.rejects(connection.bind('cn=admin', 'secret', {timeout: 100}), LDAPTimeoutException)
        assert.equal(connection.closed, true)
        assert.ok(!started.received.some((message) => message.protocolOp.type === 'abandonRequest'))
    })

    it('runs StartTLS, after which it speaks TLS, and refuses it while operations are outstanding', async () => {
        const started: TestServer = await server({
            compareRequest: (request, message, session) => {
                session.reply(message.messageId, {type: 'compareResponse', resultCode: 6, matchedDN: '', diagnosticMessage: ''})
            }
        })
        const connection: LDAPClientConnection = await connect({url: started.url, tls: {ca: CERTIFICATE}})
        assert.equal(connection.secure, false)
        await connection.startTLS({servername: 'localhost'})
        assert.equal(connection.secure, true)
        assert.equal(await connection.compare('cn=x', 'a', 'b'), true)
        const second: LDAPClientConnection = await connect({url: started.url, tls: {ca: CERTIFICATE, servername: 'localhost'}, startTLS: true})
        assert.equal(second.secure, true)
    })

    it('refuses StartTLS while operations are outstanding, and when the server sends data after agreeing', async () => {
        const started: TestServer = await server({
            compareRequest: () => undefined,
            extendedRequest: (request, message, session) => session.startTLS(message.messageId, Buffer.from('3003020100', 'hex'))
        })
        const connection: LDAPClientConnection = await connect({url: started.url, tls: {ca: CERTIFICATE, servername: 'localhost'}})
        const pending: Promise<boolean> = connection.compare('cn=x', 'a', 'b', {timeout: 200}).catch(() => false)
        await assert.rejects(connection.startTLS(), LDAPUsageException)
        await pending
        await assert.rejects(connection.startTLS(), LDAPConnectionException)
        assert.equal(connection.closed, true)
    })

    it('keeps a process alive until close() settles, and lets it end once idle', async () => {
        const started: TestServer = await server()
        const engine: string = new URL('../exports/LDAPEngine.js', import.meta.url).href
        const script: string = `const {connectLDAP} = await import(${JSON.stringify(engine)}); const c = await connectLDAP(${JSON.stringify(started.url)}); await c.bind('', ''); await c.close(); console.log('closed')`
        const {stdout, code} = await new Promise<{stdout: string, code: number | null}>((resolve) => {
            const child = spawn(process.execPath, ['--input-type=module', '-e', script])
            let output: string = ''
            child.stdout.on('data', (chunk: Buffer) => {
                output += chunk.toString()
            })
            child.on('close', (exitCode) => resolve({stdout: output, code: exitCode}))
        })
        assert.deepEqual([stdout.trim(), code], ['closed', 0])
    })

    it('connects to ldaps', async () => {
        const started: TestServer = await server({}, true)
        const connection: LDAPClientConnection = await connect({url: started.url, tls: {ca: CERTIFICATE, servername: 'localhost'}})
        assert.equal(connection.secure, true)
        await connection.bind('cn=admin', 'secret')
    })

    it('fails every waiting operation on a Notice of Disconnection', async () => {
        const started: TestServer = await server({
            compareRequest: (request, message, session) => {
                session.reply(0, {type: 'extendedResponse', resultCode: 52, matchedDN: '', diagnosticMessage: 'shutting down', name: ExtendedOperation.noticeOfDisconnection})
            }
        })
        const connection: LDAPClientConnection = await connect(started.url)
        let notice: unknown
        connection.events.on('notice', (response) => {
            notice = response
        })
        await assert.rejects(connection.compare('cn=x', 'a', 'b'), (error: unknown) => error instanceof LDAPConnectionException && /unavailable/.test(error.message))
        assert.ok(notice)
        assert.equal(connection.closed, true)
    })

    it('adds, modifies, deletes, renames and compares, a failure with its exception', async () => {
        const started: TestServer = await server({
            addRequest: (request, message, session) => session.reply(message.messageId, {type: 'addResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''}),
            modifyRequest: (request, message, session) => session.reply(message.messageId, {type: 'modifyResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''}),
            deleteRequest: (request, message, session) => session.reply(message.messageId, {type: 'deleteResponse', resultCode: 32, matchedDN: 'dc=example', diagnosticMessage: 'no such entry'}),
            modifyDNRequest: (request, message, session) => session.reply(message.messageId, {type: 'modifyDNResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''}),
            compareRequest: (request, message, session) => session.reply(message.messageId, {type: 'compareResponse', resultCode: 5, matchedDN: '', diagnosticMessage: ''})
        })
        const connection: LDAPClientConnection = await connect(started.url)
        await connection.add('cn=x,dc=example', {objectClass: ['top', 'device'], cn: 'x', serialNumber: 42, enabled: true, description: undefined as never, seeAlso: []})
        await connection.modify('cn=x,dc=example', [{operation: 'replace', attribute: 'description', values: 'a'}, {operation: 'delete', attribute: 'seeAlso'}])
        await assert.rejects(connection.delete('cn=y,dc=example'), (error: unknown) => error instanceof LDAPNoSuchObjectException && error.matchedDN === 'dc=example')
        await connection.modifyDN('cn=x,dc=example', 'cn=z', {newSuperior: 'ou=devices,dc=example'})
        assert.equal(await connection.compare('cn=x,dc=example', 'cn', 'y'), false)
        const add = started.received.find((message) => message.protocolOp.type === 'addRequest')!.protocolOp
        assert.ok(add.type === 'addRequest' && add.attributes.find((attribute) => attribute.type === 'enabled')!.values[0].toString() === 'TRUE')
        assert.ok(add.type === 'addRequest' && !add.attributes.some((attribute) => attribute.type === 'description' || attribute.type === 'seeAlso'))
        const rename = started.received.find((message) => message.protocolOp.type === 'modifyDNRequest')!.protocolOp
        assert.ok(rename.type === 'modifyDNRequest' && rename.deleteOldRDN && rename.newSuperior === 'ou=devices,dc=example')
    })

    it('runs Password Modify and Who Am I', async () => {
        const started: TestServer = await server({
            extendedRequest: (request, message, session) => {
                if (request.type !== 'extendedRequest') return
                if (request.name === ExtendedOperation.passwordModify) {
                    const value = PasswordModifyRequest.decode(request.value ?? Buffer.alloc(0))
                    session.reply(message.messageId, {type: 'extendedResponse', resultCode: 0, matchedDN: '', diagnosticMessage: '', ...(value.newPassword ? {} : {value: PasswordModifyResponse.encode({generatedPassword: Buffer.from('generated')})})})
                } else {
                    session.reply(message.messageId, {type: 'extendedResponse', resultCode: 0, matchedDN: '', diagnosticMessage: '', value: WhoAmIResponse.encode('dn:cn=admin')})
                }
            }
        })
        const connection: LDAPClientConnection = await connect(started.url)
        assert.equal(await connection.passwordModify({userIdentity: 'uid=alice', oldPassword: 'a', newPassword: 'b'}), undefined)
        assert.equal(await connection.passwordModify(), 'generated')
        assert.equal(await connection.whoAmI(), 'dn:cn=admin')
    })

    it('reads a window of the sorted entries with the virtual list view', async () => {
        const started: TestServer = await server({
            searchRequest: (request, message, session) => {
                assert.ok(findControl(message.controls, SortRequestControl))
                const vlv = VLVRequestControl.decode(findControl(message.controls, VLVRequestControl)!)
                for (let index: number = 0; index <= vlv.afterCount; index++) session.reply(message.messageId, {type: 'searchResultEntry', objectName: `cn=${vlv.offset!.offset + index}`, attributes: []})
                session.reply(message.messageId, {type: 'searchResultDone', resultCode: 0, matchedDN: '', diagnosticMessage: ''}, [VLVResponseControl.encode({targetPosition: vlv.offset!.offset, contentCount: 99, result: 0})])
            }
        })
        const connection: LDAPClientConnection = await connect(started.url)
        const result = await connection.search('dc=example', {sort: [{attribute: 'cn'}], window: {offset: 11, limit: 10}})
        assert.equal(result.entries.length, 10)
        assert.equal(result.entries[0].dn, 'cn=11')
        assert.equal(result.total, 99)
        await assert.rejects(connection.search('dc=example', {window: {offset: 1, limit: 1}}), LDAPUsageException)
    })

    it('reads the values Active Directory gives in ranges to their end', async () => {
        const members: Buffer[] = Array.from({length: 3500}, (_, index) => Buffer.from(`cn=m${index},dc=example`))
        const started: TestServer = await server({
            searchRequest: (request, message, session) => {
                if (request.type !== 'searchRequest') return
                const wanted: string | undefined = request.attributes.find((attribute) => attribute.startsWith('member;range='))
                const start: number = wanted ? Number(/range=(\d+)/.exec(wanted)![1]) : 0
                const end: number = Math.min(start + 1500, members.length)
                const type: string = `member;range=${start}-${end === members.length ? '*' : end - 1}`
                session.reply(message.messageId, {type: 'searchResultEntry', objectName: 'cn=group,dc=example', attributes: [{type: 'cn', values: [Buffer.from('group')]}, {type: type, values: members.slice(start, end)}]})
                session.reply(message.messageId, {type: 'searchResultDone', resultCode: 0, matchedDN: '', diagnosticMessage: ''})
            }
        })
        const connection: LDAPClientConnection = await connect(started.url)
        const result = await connection.search('cn=group,dc=example', {scope: 'base', attributes: ['cn', 'member']})
        assert.equal(result.entries[0].get('member').length, 3500)
        assert.equal(result.entries[0].get('member')[3499], 'cn=m3499,dc=example')
        assert.equal(result.entries[0].names().includes('member'), true)
    })
})

describe('the entries', () => {
    after(closeAll)

    it('read text with get() and bytes with getBuffers(), the binary attributes refused by get()', () => {
        const entry: Entry = new Entry('cn=x', [{type: 'cn', values: [Buffer.from('Alice'), Buffer.from('Al')]}, {type: 'objectGUID', values: [Buffer.alloc(16, 1)]}, {type: 'userCertificate;binary', values: [Buffer.from([0x30])]}])
        assert.deepEqual(entry.get('CN'), ['Alice', 'Al'])
        assert.equal(entry.first('cn'), 'Alice')
        assert.deepEqual(entry.get('mail'), [])
        assert.throws(() => entry.get('objectGUID'), LDAPUsageException)
        assert.throws(() => entry.get('userCertificate;binary'), LDAPUsageException)
        assert.equal(entry.getBuffers('objectGUID')[0].length, 16)
        assert.deepEqual(entry.toJSON().attributes.objectGUID, [Buffer.alloc(16, 1).toString('base64')])
        assert.ok(Buffer.isBuffer(entry.toObject().objectGUID[0]))
        assert.equal(new Entry('cn=x', [{type: 'badge', values: [Buffer.from([0xff])]}], {binaryAttributes: ['Badge']}).isBinary('badge'), true)
    })
})

describe('the pool', () => {
    after(closeAll)

    it('opens connections when needed, bound as its identity, and runs operations on them', async () => {
        let binds: number = 0
        const started: TestServer = await server({
            bindRequest: (request, message, session) => {
                binds++
                session.reply(message.messageId, {type: 'bindResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''})
            },
            searchRequest: pagedSearch(3) as never,
            compareRequest: (request, message, session) => {
                setTimeout(() => session.reply(message.messageId, {type: 'compareResponse', resultCode: 6, matchedDN: '', diagnosticMessage: ''}), 30)
            }
        })
        const client: LDAPPool = createLDAPClient({url: started.url, bindDN: 'cn=service', password: 'secret', poolSize: 2})
        assert.equal((await client.search('dc=example')).entries.length, 3)
        await Promise.all([client.compare('cn=a', 'b', 'c'), client.compare('cn=a', 'b', 'c'), client.compare('cn=a', 'b', 'c')])
        assert.equal(binds, 2)
        await client.close()
    })

    it('tries the next server when one cannot be reached', async () => {
        const started: TestServer = await server({searchRequest: pagedSearch(1) as never})
        const client: LDAPPool = createLDAPClient({url: ['ldap://127.0.0.1:1', started.url], connectTimeout: 500})
        assert.equal((await client.search('dc=example')).entries.length, 1)
        await client.close()
        const nowhere: LDAPPool = createLDAPClient({url: ['ldap://127.0.0.1:1'], connectTimeout: 500})
        await assert.rejects(nowhere.search('dc=example'), LDAPConnectionException)
        await nowhere.close()
    })

    it('orders the records of DNS SRV by priority, then by a draw weighted by their weight', () => {
        const records: SrvRecord[] = [
            {name: 'c', port: 389, priority: 20, weight: 0},
            {name: 'a1', port: 389, priority: 10, weight: 10},
            {name: 'a2', port: 389, priority: 10, weight: 30},
            {name: 'b', port: 636, priority: 15, weight: 5}
        ]
        assert.deepEqual(orderSrv(records, () => 0).map((record) => record.name), ['a1', 'a2', 'b', 'c'])
        assert.deepEqual(orderSrv(records, () => 0.5).map((record) => record.name), ['a2', 'a1', 'b', 'c'])
        let first: number = 0
        for (let index: number = 0; index < 4000; index++) if (orderSrv(records)[0].name === 'a2') first++
        assert.ok(first > 2700 && first < 3300, `a2 first ${first} times of 4000, about 3000 expected`)
    })

    it('finds its servers in a DNS SRV record, an unreachable one passed over', async () => {
        const started: TestServer = await server({searchRequest: pagedSearch(2) as never})
        class FakeDNSPool extends Pool {
            protected async resolveSrv(name: string): Promise<SrvRecord[]> {
                assert.equal(name, '_ldap._tcp.example.com')
                return [{name: '127.0.0.1', port: 1, priority: 0, weight: 0}, {name: '127.0.0.1', port: started.port, priority: 1, weight: 0}]
            }
        }
        const client: LDAPPool = new FakeDNSPool({srv: '_ldap._tcp.example.com', connectTimeout: 500})
        assert.equal((await client.search('dc=example')).entries.length, 2)
        await client.close()
    })

    it('authenticates: one entry found, a bind on a connection of its own, the password policy read', async () => {
        const started: TestServer = await server({
            bindRequest: (request, message, session) => {
                if (request.type !== 'bindRequest' || request.authentication.type !== 'simple') return
                const password: string = request.authentication.password.toString()
                if (request.name === 'cn=service') return session.reply(message.messageId, {type: 'bindResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''})
                if (password === 'good') return session.reply(message.messageId, {type: 'bindResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''}, [PasswordPolicyResponseControl.encode({timeBeforeExpiration: 86400})])
                if (password === 'locked') return session.reply(message.messageId, {type: 'bindResponse', resultCode: 49, matchedDN: '', diagnosticMessage: ''}, [PasswordPolicyResponseControl.encode({error: 'accountLocked'})])
                if (password === 'expired') return session.reply(message.messageId, {type: 'bindResponse', resultCode: 49, matchedDN: '', diagnosticMessage: '80090308: LdapErr: DSID-0C09042A, comment: AcceptSecurityContext error, data 532, v3839'})
                session.reply(message.messageId, {type: 'bindResponse', resultCode: 49, matchedDN: '', diagnosticMessage: ''})
            },
            searchRequest: (request, message, session) => {
                if (request.type !== 'searchRequest' || request.filter.type !== 'equality') return
                const name: string = request.filter.value.toString()
                const count: number = name === 'alice' ? 1 : name === 'twin' ? 2 : 0
                for (let index: number = 0; index < count; index++) session.reply(message.messageId, {type: 'searchResultEntry', objectName: `uid=${name}${index},dc=example`, attributes: [{type: 'uid', values: [Buffer.from(name)]}]})
                session.reply(message.messageId, {type: 'searchResultDone', resultCode: count > 1 ? 4 : 0, matchedDN: '', diagnosticMessage: ''})
            }
        })
        const client: LDAPPool = createLDAPClient({url: started.url, bindDN: 'cn=service', password: 'secret'})
        const options = {base: 'dc=example', requireTLS: false}
        const good = await client.authenticate({...options, username: 'alice', password: 'good'})
        assert.equal(good.ok, true)
        assert.equal(good.dn, 'uid=alice0,dc=example')
        assert.equal(good.timeBeforeExpiration, 86400)
        assert.equal(good.entry?.first('uid'), 'alice')
        assert.deepEqual([(await client.authenticate({...options, username: 'alice', password: 'bad'})).reason, (await client.authenticate({...options, username: 'alice', password: 'locked'})).reason, (await client.authenticate({...options, username: 'alice', password: 'expired'})).reason], ['invalidCredentials', 'accountLocked', 'passwordExpired'])
        const missing = await client.authenticate({...options, username: 'bob', password: 'good'})
        assert.deepEqual([missing.ok, missing.reason, missing.detail], [false, 'invalidCredentials', 'no entry found'])
        const twins = await client.authenticate({...options, username: 'twin', password: 'good'})
        assert.deepEqual([twins.ok, twins.detail], [false, 'several entries found'])
        const empty: number = started.received.length
        assert.deepEqual(await client.authenticate({...options, username: 'alice', password: ''}), {ok: false, reason: 'invalidCredentials', detail: 'empty password'})
        assert.equal(started.received.length, empty)
        await assert.rejects(client.authenticate({base: 'dc=example', username: 'alice', password: 'good'}), LDAPUsageException)
        await client.close()
    })

    it('authenticates over a local socket without TLS', {skip: process.platform === 'win32' ? 'no Unix sockets' : false}, async () => {
        const path: string = join(tmpdir(), `lakutata-ldap-${process.pid}.sock`)
        rmSync(path, {force: true})
        const started: TestServer = await server({
            searchRequest: (request, message, session) => {
                session.reply(message.messageId, {type: 'searchResultEntry', objectName: 'uid=alice,dc=example', attributes: []})
                session.reply(message.messageId, {type: 'searchResultDone', resultCode: 0, matchedDN: '', diagnosticMessage: ''})
            }
        }, false, path)
        const client: LDAPPool = createLDAPClient({url: started.url})
        const result = await client.authenticate({base: 'dc=example', username: 'alice', password: 'good'})
        assert.deepEqual([result.ok, result.dn], [true, 'uid=alice,dc=example'])
        await client.close()
    })
})

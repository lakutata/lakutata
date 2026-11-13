import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {existsSync, lstatSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {createConnection, createServer, type Server, type Socket} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {after, before, describe, it} from 'node:test'
import {
    connectLDAP,
    createHandlerBackend,
    createLDAPServer,
    decodeMessage,
    DN,
    encodeMessage,
    ExtendedOperation,
    externalMechanism,
    Filter,
    plainMechanism,
    type LDAPClientConnection,
    LDAPConnectionException,
    LDAPInvalidCredentialsException,
    LDAPResultException,
    type LDAPServerEngine,
    LDAPTimeoutException,
    LDAPUsageException,
    MemoryBackend,
    MessageReader,
    PagedResultsControl,
    type SearchContext
} from '../exports/LDAPEngine.js'
import {X509Certificate} from 'node:crypto'
import {CERTIFICATE, KEY, OTHER_CERTIFICATE, OTHER_KEY} from './support/Certificate.js'

const BASE: string = 'dc=example,dc=com'
const ADMIN: string = 'cn=admin,dc=example,dc=com'
const TLS = {ca: CERTIFICATE, servername: 'localhost'}
const servers: LDAPServerEngine[] = []
const clients: LDAPClientConnection[] = []

/**
 * A server with a directory of a few people, not listening
 */
async function directory(options: Partial<Parameters<typeof createLDAPServer>[0]> = {}, people: number = 5): Promise<LDAPServerEngine> {
    const server: LDAPServerEngine = createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ADMIN]}, passwords: {iterations: 1000}, bindThrottle: {delay: 0}, tls: {cert: CERTIFICATE, key: KEY}, ...options})
    servers.push(server)
    const admin = server.connect({as: ADMIN})
    await admin.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
    await admin.add(`ou=people,${BASE}`, {objectClass: 'organizationalUnit', ou: 'people'})
    for (let index: number = 0; index < people; index++) await admin.add(`uid=user${index},ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: `user${index}`, cn: `User ${index}`, sn: 'S', userPassword: `password${index}`})
    await admin.add(ADMIN.replace(`,${BASE}`, `,${BASE}`), {objectClass: ['organizationalRole', 'simpleSecurityObject'], cn: 'admin', userPassword: 'secret'})
    return server
}

/**
 * A server listening on a free port of the loopback, with a directory of a few people
 */
async function serve(options: Partial<Parameters<typeof createLDAPServer>[0]> = {}, people: number = 5): Promise<{server: LDAPServerEngine, url: string, port: number}> {
    const server: LDAPServerEngine = await directory(options, people)
    const port: number = await server.listen({port: 0, host: '127.0.0.1'})
    return {server: server, url: `ldap://127.0.0.1:${port}`, port: port}
}

/**
 * A client connection, closed after the tests
 */
async function client(options: Parameters<typeof connectLDAP>[0]): Promise<LDAPClientConnection> {
    const connection: LDAPClientConnection = await connectLDAP(options)
    clients.push(connection)
    return connection
}

/**
 * The messages a raw socket receives until it closes or the time is up
 * @param socket The socket.
 * @param milliseconds The time.
 */
async function received(socket: Socket, milliseconds: number = 500): Promise<{messages: ReturnType<typeof decodeMessage>[], closed: boolean}> {
    const reader: MessageReader = new MessageReader()
    const messages: ReturnType<typeof decodeMessage>[] = []
    let closed: boolean = false
    socket.on('data', (chunk: Buffer) => {
        for (const item of reader.push(chunk)) if (item.message) messages.push(item.message)
    })
    await Promise.race([once(socket, 'close').then(() => {
        closed = true
    }), new Promise((resolve) => setTimeout(resolve, milliseconds))])
    return {messages: messages, closed: closed}
}

/**
 * Close the connections and the servers of the tests run so far, after each group (the hooks of a file run only once
 * its handles are closed on the test runner of Node.js 18)
 */
async function closeAll(): Promise<void> {
    for (const connection of clients.splice(0)) connection.destroy()
    for (const server of servers.splice(0)) await server.close()
}

describe('the server engine on the network', () => {
    after(closeAll)

    let url: string
    let port: number

    before(async () => {
        ({url, port} = await serve({}, 3000))
    })

    it('binds, searches and writes over LDAP', async () => {
        const connection: LDAPClientConnection = await client(url)
        await connection.bind(ADMIN, 'secret')
        const {entries} = await connection.search(`ou=people,${BASE}`, {scope: 'one', paged: false})
        assert.equal(entries.length, 3000)
        await connection.modify(`uid=user1,ou=people,${BASE}`, {operation: 'replace', attribute: 'mail', values: 'one@example.com'})
        assert.equal(await connection.compare(`uid=user1,ou=people,${BASE}`, 'mail', 'ONE@example.com'), true)
        await assert.rejects(connection.bind(ADMIN, 'wrong'), LDAPInvalidCredentialsException)
        await assert.rejects(connection.extended('1.2.3.4'), (error: unknown) => error instanceof LDAPResultException && error.code === 2)
    })

    it('runs StartTLS, offers PLAIN after it, and binds with it', async () => {
        const plain: LDAPClientConnection = await client(url)
        assert.deepEqual((await plain.search('', {scope: 'base', attributes: ['supportedSASLMechanisms', 'supportedExtension']})).entries[0].get('supportedSASLMechanisms'), [])
        const connection: LDAPClientConnection = await client({url: url, tls: TLS, startTLS: true})
        assert.equal(connection.secure, true)
        const root = (await connection.search('', {scope: 'base', attributes: ['supportedSASLMechanisms', 'supportedExtension']})).entries[0]
        assert.deepEqual(root.get('supportedSASLMechanisms'), ['PLAIN', 'EXTERNAL'])
        assert.ok(root.get('supportedExtension').includes(ExtendedOperation.startTLS))
        await connection.saslBind('PLAIN', Buffer.from(`\u0000uid=user2,ou=people,${BASE}\u0000password2`))
        assert.equal(await connection.whoAmI(), `dn:uid=user2,ou=people,${BASE}`)
        await assert.rejects(connection.saslBind('PLAIN', Buffer.from(`\u0000uid=user2,ou=people,${BASE}\u0000wrong`)), LDAPInvalidCredentialsException)
        await assert.rejects(connection.saslBind('EXTERNAL'), (error: unknown) => error instanceof LDAPResultException && error.code === 48)
    })

    it('binds with SASL EXTERNAL a client certificate that chains to its CA, and refuses one that does not', async () => {
        const {url: own} = await serve({
            tls: {cert: CERTIFICATE, key: KEY, ca: CERTIFICATE, requestCert: true},
            sasl: [plainMechanism(), externalMechanism((certificate: Buffer) => new X509Certificate(certificate).subject === 'CN=localhost' ? DN.parse(ADMIN) : undefined)]
        })
        const trusted: LDAPClientConnection = await client({url: own, tls: {...TLS, cert: CERTIFICATE, key: KEY}, startTLS: true})
        await trusted.saslBind('EXTERNAL')
        assert.equal(await trusted.whoAmI(), `dn:${ADMIN}`)
        const intruder: LDAPClientConnection = await client({url: own, tls: {...TLS, cert: OTHER_CERTIFICATE, key: OTHER_KEY}, startTLS: true})
        await assert.rejects(intruder.saslBind('EXTERNAL'), LDAPInvalidCredentialsException)
        const without: LDAPClientConnection = await client({url: own, tls: TLS, startTLS: true})
        await assert.rejects(without.saslBind('EXTERNAL'), (error: unknown) => error instanceof LDAPResultException && error.code === 48)
    })

    it('serves LDAPS', async () => {
        const securePort: number = await servers[0].listen({port: 0, host: '127.0.0.1', secure: true})
        const connection: LDAPClientConnection = await client({url: `ldaps://127.0.0.1:${securePort}`, tls: TLS})
        await connection.bind(`uid=user3,ou=people,${BASE}`, 'password3')
        assert.equal(await connection.whoAmI(), `dn:uid=user3,ou=people,${BASE}`)
    })

    it('runs StartTLS through the pipeline: its controls checked, the plugins around it, its operation event', async () => {
        const seen: string[] = []
        const events: number[] = []
        const {server: watched, url: watchedURL, port: watchedPort} = await serve({plugins: [{name: 'seen', aroundRequest: async (context, request, next) => {
            if (request.type === 'extendedRequest') seen.push(`${context.operation} ${request.name}`)
            return next()
        }}]})
        watched.events.on('operation', (event: {operation: string, resultCode: number}) => {
            if (event.operation === 'extended') events.push(event.resultCode)
        })
        //A critical control the server does not know: refused, the connection going on in clear
        const socket: Socket = createConnection({port: watchedPort, host: '127.0.0.1'})
        await once(socket, 'connect')
        socket.write(encodeMessage({messageId: 1, protocolOp: {type: 'extendedRequest', name: ExtendedOperation.startTLS}, controls: [{oid: '1.3.6.1.4.1.99999.9', critical: true}]}))
        setTimeout(() => socket.write(encodeMessage({messageId: 2, protocolOp: {type: 'extendedRequest', name: ExtendedOperation.whoAmI}})), 100)
        const {messages} = await received(socket)
        socket.destroy()
        assert.deepEqual(messages.map((message) => [message.messageId, 'resultCode' in message.protocolOp ? message.protocolOp.resultCode : undefined]), [[1, 12], [2, 0]])
        //Agreed: through the plugin (a request refused for its controls goes through none, as any request)
        const secure: LDAPClientConnection = await client({url: watchedURL, tls: TLS, startTLS: true})
        assert.equal(secure.secure, true)
        assert.deepEqual(seen.filter((item: string) => item.endsWith(ExtendedOperation.startTLS)), [`extended ${ExtendedOperation.startTLS}`])
        assert.deepEqual(events.slice(0, 1), [12])
        assert.ok(events.includes(0))
    })

    it('lets a session that must change its password start TLS to change it', async () => {
        const POLICY: string = `cn=default,ou=policies,${BASE}`
        const {server: policed, url: policedURL} = await serve({passwordPolicy: {default: POLICY}})
        const owner = policed.connect({as: ADMIN})
        await owner.add(`ou=policies,${BASE}`, {objectClass: 'organizationalUnit', ou: 'policies'})
        await owner.add(POLICY, {objectClass: ['organizationalRole', 'pwdPolicy'], cn: 'default', pwdAttribute: 'userPassword', pwdMustChange: 'TRUE'})
        //Reset by an administrator: the user must change it, and binds in clear first
        await owner.modify(`uid=user1,ou=people,${BASE}`, {operation: 'replace', attribute: 'userPassword', values: 'reset-by-admin'})
        const connection: LDAPClientConnection = await client({url: policedURL, tls: TLS})
        await connection.bind(`uid=user1,ou=people,${BASE}`, 'reset-by-admin')
        await connection.startTLS(TLS)
        assert.equal(connection.secure, true)
        await connection.passwordModify({oldPassword: 'reset-by-admin', newPassword: 'chosen-over-tls'})
    })

    it('answers StartTLS a plugin says is done, without the connection agreeing, with an error, and goes on in clear', async () => {
        //An audit plugin around the one answering, which records what the client gets; the operation events too
        const recorded: number[] = []
        const events: number[] = []
        const {server: fakingServer, port: fakingPort} = await serve({plugins: [
            {name: 'recording', aroundRequest: async (_context, request, next) => {
                const outcome = await next()
                if (request.type === 'extendedRequest' && request.name === ExtendedOperation.startTLS) recorded.push(outcome.resultCode)
                return outcome
            }},
            {name: 'faking', aroundRequest: async (_context, request, next) => request.type === 'extendedRequest' && request.name === ExtendedOperation.startTLS ? {resultCode: 0} : next()}
        ]})
        fakingServer.events.on('operation', (event: {operation: string, resultCode: number}) => {
            if (event.operation === 'extended') events.push(event.resultCode)
        })
        const socket: Socket = createConnection({port: fakingPort, host: '127.0.0.1'})
        await once(socket, 'connect')
        socket.write(encodeMessage({messageId: 1, protocolOp: {type: 'extendedRequest', name: ExtendedOperation.startTLS}}))
        setTimeout(() => socket.write(encodeMessage({messageId: 2, protocolOp: {type: 'extendedRequest', name: ExtendedOperation.whoAmI}})), 100)
        const {messages} = await received(socket)
        socket.destroy()
        const codes = messages.map((message) => [message.messageId, 'resultCode' in message.protocolOp ? message.protocolOp.resultCode : undefined])
        assert.deepEqual(codes, [[1, 1], [2, 0]])
        assert.deepEqual([recorded, events[0]], [[1], 1])
    })

    it('answers StartTLS the connection refused as refused, whatever a plugin around it makes of it', async () => {
        const recorded: number[] = []
        const events: number[] = []
        //A server without TLS: the connection refuses StartTLS, the plugin around it says success
        const {server: overriding, port: overridingPort} = await serve({tls: undefined, plugins: [
            {name: 'recording', aroundRequest: async (_context, request, next) => {
                const outcome = await next()
                if (request.type === 'extendedRequest' && request.name === ExtendedOperation.startTLS) recorded.push(outcome.resultCode)
                return outcome
            }},
            {name: 'overriding', aroundRequest: async (_context, request, next) => {
                const outcome = await next()
                return request.type === 'extendedRequest' && request.name === ExtendedOperation.startTLS ? {resultCode: 0} : outcome
            }}
        ]})
        overriding.events.on('operation', (event: {operation: string, resultCode: number}) => {
            if (event.operation === 'extended') events.push(event.resultCode)
        })
        const socket: Socket = createConnection({port: overridingPort, host: '127.0.0.1'})
        await once(socket, 'connect')
        socket.write(encodeMessage({messageId: 1, protocolOp: {type: 'extendedRequest', name: ExtendedOperation.startTLS}}))
        setTimeout(() => socket.write(encodeMessage({messageId: 2, protocolOp: {type: 'extendedRequest', name: ExtendedOperation.whoAmI}})), 100)
        const {messages} = await received(socket)
        socket.destroy()
        //The client, the plugin around it and the event: the same error
        assert.deepEqual(messages.map((message) => [message.messageId, 'resultCode' in message.protocolOp ? message.protocolOp.resultCode : undefined]), [[1, 1], [2, 0]])
        assert.deepEqual([recorded, events[0]], [[1], 1])
    })

    it('refuses data sent after a StartTLS request before the handshake', async () => {
        const socket: Socket = createConnection({port: port, host: '127.0.0.1'})
        await once(socket, 'connect')
        socket.write(Buffer.concat([encodeMessage({messageId: 1, protocolOp: {type: 'extendedRequest', name: ExtendedOperation.startTLS}}), encodeMessage({messageId: 2, protocolOp: {type: 'unbindRequest'}})]))
        const {messages, closed} = await received(socket)
        assert.equal(closed, true)
        assert.equal(messages[0].protocolOp.type, 'extendedResponse')
        assert.ok(messages.some((message) => message.messageId === 0 && 'resultCode' in message.protocolOp && message.protocolOp.resultCode === 2))
        socket.destroy()
    })

    it('abandons the requests waiting for a bind in flight when another bind comes (RFC 4511 §4.2.1)', async () => {
        //A bind held in its check until the test lets it go
        let release: () => void = (): void => undefined
        const released: Promise<void> = new Promise<void>((resolve: () => void): void => {
            release = resolve
        })
        const {port} = await serve({access: {admins: [ADMIN], anonymousRead: true}, interceptors: [{name: 'holding', operations: ['bind'], before: async (_context, request) => {
            if (request.type === 'bind' && request.dn?.toString().startsWith('uid=user1,')) await released
        }}]})
        const socket: Socket = createConnection({port: port, host: '127.0.0.1'})
        await once(socket, 'connect')
        const reader: MessageReader = new MessageReader()
        const answered: number[] = []
        socket.on('data', (chunk: Buffer) => {
            for (const item of reader.push(chunk)) if (item.message) answered.push(item.message.messageId)
        })
        const settle = (): Promise<void> => new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 150))
        //A bind in flight, a search waiting for it, then a bind sent before the first ends
        socket.write(encodeMessage({messageId: 1, protocolOp: {type: 'bindRequest', version: 3, name: `uid=user1,ou=people,${BASE}`, authentication: {type: 'simple', password: Buffer.from('password1')}}}))
        await settle()
        socket.write(encodeMessage({messageId: 2, protocolOp: {type: 'searchRequest', baseObject: `ou=people,${BASE}`, scope: 'one', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: Filter.parse('(objectClass=*)'), attributes: ['1.1']}}))
        socket.write(encodeMessage({messageId: 3, protocolOp: {type: 'bindRequest', version: 3, name: `uid=user2,ou=people,${BASE}`, authentication: {type: 'simple', password: Buffer.from('password2')}}}))
        await settle()
        release()
        await settle()
        socket.destroy()
        //Both binds answered, the search abandoned: no answer
        assert.deepEqual([...new Set(answered)], [1, 3])
    })

    it('gives the plugins a request of its own for each bind it cannot decode', async () => {
        //A plugin changing the request of the first: the second as the server makes it
        const seen: string[] = []
        const {port} = await serve({plugins: [{name: 'touching', aroundRequest: async (_context: unknown, request: {type: string, name?: string}, next: () => Promise<unknown>) => {
            if (request.type === 'bindRequest') {
                seen.push(String(request.name))
                request.name = 'changed by a plugin'
            }
            return next()
        }}] as never})
        const socket: Socket = createConnection({port: port, host: '127.0.0.1'})
        await once(socket, 'connect')
        const reader: MessageReader = new MessageReader()
        const answered: number[] = []
        socket.on('data', (chunk: Buffer) => {
            for (const item of reader.push(chunk)) if (item.message) answered.push(item.message.messageId)
        })
        for (const id of [1, 2]) {
            socket.write(Buffer.from([0x30, 0x0e, 0x02, 0x01, id, 0x60, 0x09, 0x02, 0x01, 0x03, 0x04, 0x02, 0xff, 0xfe, 0x80, 0x00]))
            await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 150))
        }
        socket.destroy()
        assert.deepEqual(answered, [1, 2])
        assert.deepEqual(seen, ['', ''])
    })

    it('takes a bind it cannot decode for a failed bind: the session anonymous, its paged searches, SASL exchange and requests ended', async () => {
        //A search held until released, a two-step mechanism counting its starts
        let release: () => void = (): void => undefined
        const released: Promise<void> = new Promise<void>((resolve: () => void): void => {
            release = resolve
        })
        let starts: number = 0
        //Anonymous sessions read: the refused cookie is told by the paging, not by the access control
        const {port: failingPort} = await serve({
            access: {admins: [ADMIN], anonymousRead: true},
            sasl: [plainMechanism(), {name: 'COUNTED', requiresTLS: false, start: async () => {
                starts++
                return {done: false, serverCredentials: Buffer.from('next')}
            }, step: async () => ({done: true, identity: DN.parse(`uid=user1,ou=people,${BASE}`)})}],
            interceptors: [{name: 'held', operations: ['search'], before: async (_context, request) => {
                if (request.type === 'search' && request.filter.type === 'equality' && request.filter.attribute === 'description') await released
            }}]
        })
        const socket: Socket = createConnection({port: failingPort, host: '127.0.0.1'})
        await once(socket, 'connect')
        const reader: MessageReader = new MessageReader()
        const messages: ReturnType<typeof decodeMessage>[] = []
        socket.on('data', (chunk: Buffer) => {
            for (const item of reader.push(chunk)) if (item.message) messages.push(item.message)
        })
        const settle = (): Promise<void> => new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 150))
        //The last message of a request: its result
        const answer = (id: number) => [...messages].reverse().find((message) => message.messageId === id)
        //Bound as a user, a paged search begun, a search held
        socket.write(encodeMessage({messageId: 1, protocolOp: {type: 'bindRequest', version: 3, name: `uid=user1,ou=people,${BASE}`, authentication: {type: 'simple', password: Buffer.from('password1')}}}))
        await settle()
        socket.write(encodeMessage({messageId: 2, protocolOp: {type: 'searchRequest', baseObject: `ou=people,${BASE}`, scope: 'one', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: Filter.parse('(objectClass=*)'), attributes: ['1.1']}, controls: [PagedResultsControl.encode({size: 2, cookie: Buffer.alloc(0)})]}))
        await settle()
        const cookie: Buffer = PagedResultsControl.decode(answer(2)!.controls!.find((control) => control.oid === PagedResultsControl.oid)!).cookie
        assert.ok(cookie.length)
        socket.write(encodeMessage({messageId: 3, protocolOp: {type: 'searchRequest', baseObject: `ou=people,${BASE}`, scope: 'one', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: Filter.parse('(description=held)'), attributes: ['1.1']}}))
        await settle()
        //A bind whose name is not UTF-8: answered protocolError
        socket.write(Buffer.from([0x30, 0x0e, 0x02, 0x01, 0x04, 0x60, 0x09, 0x02, 0x01, 0x03, 0x04, 0x02, 0xff, 0xfe, 0x80, 0x00]))
        await settle()
        release()
        assert.equal((answer(4)!.protocolOp as {resultCode: number}).resultCode, 2)
        //The held search abandoned (no answer), the session anonymous, its paged search ended
        socket.write(encodeMessage({messageId: 5, protocolOp: {type: 'extendedRequest', name: ExtendedOperation.whoAmI}}))
        socket.write(encodeMessage({messageId: 6, protocolOp: {type: 'searchRequest', baseObject: `ou=people,${BASE}`, scope: 'one', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: Filter.parse('(objectClass=*)'), attributes: ['1.1']}, controls: [PagedResultsControl.encode({size: 2, cookie: cookie})]}))
        await settle()
        assert.equal(answer(3), undefined)
        assert.equal(String((answer(5)!.protocolOp as {value?: Buffer}).value ?? ''), '')
        assert.equal((answer(6)!.protocolOp as {resultCode: number}).resultCode, 53)
        //A SASL exchange begun, then a bind that cannot be decoded: the exchange starts again
        socket.write(encodeMessage({messageId: 7, protocolOp: {type: 'bindRequest', version: 3, name: '', authentication: {type: 'sasl', mechanism: 'COUNTED', credentials: Buffer.from('first')}}}))
        await settle()
        socket.write(Buffer.from([0x30, 0x0e, 0x02, 0x01, 0x08, 0x60, 0x09, 0x02, 0x01, 0x03, 0x04, 0x02, 0xff, 0xfe, 0x80, 0x00]))
        await settle()
        socket.write(encodeMessage({messageId: 9, protocolOp: {type: 'bindRequest', version: 3, name: '', authentication: {type: 'sasl', mechanism: 'COUNTED', credentials: Buffer.from('first')}}}))
        await settle()
        socket.destroy()
        assert.deepEqual([(answer(7)!.protocolOp as {resultCode: number}).resultCode, (answer(9)!.protocolOp as {resultCode: number}).resultCode, starts], [14, 14, 2])
        //Through the plugins and the events as any bind: a session that must change its password goes on anonymous
        const POLICY: string = `cn=default,ou=policies,${BASE}`
        const binds: number[] = []
        const {server: policed, port: policedPort} = await serve({passwordPolicy: {default: POLICY}})
        policed.events.on('operation', (event: {operation: string, resultCode: number}) => {
            if (event.operation === 'bind') binds.push(event.resultCode)
        })
        const owner = policed.connect({as: ADMIN})
        await owner.add(`ou=policies,${BASE}`, {objectClass: 'organizationalUnit', ou: 'policies'})
        await owner.add(POLICY, {objectClass: ['organizationalRole', 'pwdPolicy'], cn: 'default', pwdAttribute: 'userPassword', pwdMustChange: 'TRUE'})
        await owner.modify(`uid=user2,ou=people,${BASE}`, {operation: 'replace', attribute: 'userPassword', values: 'reset-by-admin'})
        const reset: Socket = createConnection({port: policedPort, host: '127.0.0.1'})
        await once(reset, 'connect')
        reset.write(encodeMessage({messageId: 1, protocolOp: {type: 'bindRequest', version: 3, name: `uid=user2,ou=people,${BASE}`, authentication: {type: 'simple', password: Buffer.from('reset-by-admin')}}}))
        await settle()
        reset.write(Buffer.from([0x30, 0x0e, 0x02, 0x01, 0x02, 0x60, 0x09, 0x02, 0x01, 0x03, 0x04, 0x02, 0xff, 0xfe, 0x80, 0x00]))
        await settle()
        reset.write(encodeMessage({messageId: 3, protocolOp: {type: 'searchRequest', baseObject: '', scope: 'base', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: Filter.parse('(objectClass=*)'), attributes: ['1.1']}}))
        const {messages: after} = await received(reset)
        reset.destroy()
        const done = [...after].reverse().find((message) => message.messageId === 3)
        assert.deepEqual([(done!.protocolOp as {resultCode: number}).resultCode, binds], [0, [0, 2]])
    })

    it('answers a bind of another version than 3 with protocolError, and closes on a message it cannot frame', async () => {
        const socket: Socket = createConnection({port: port, host: '127.0.0.1'})
        await once(socket, 'connect')
        socket.write(encodeMessage({messageId: 1, protocolOp: {type: 'bindRequest', version: 2, name: '', authentication: {type: 'simple', password: Buffer.alloc(0)}}}))
        setTimeout(() => socket.write(Buffer.from([0x30, 0x84, 0xff, 0xff, 0xff, 0xff])), 100)
        const {messages, closed} = await received(socket)
        assert.equal(closed, true)
        assert.ok(messages.some((message) => message.messageId === 1 && 'resultCode' in message.protocolOp && message.protocolOp.resultCode === 2))
        socket.destroy()
    })

    it('answers a value it does not allow with protocolError, and ends the session on an operation whose encoding is wrong or that is not a request (RFC 4511 §4.1.1)', async () => {
        const search: Buffer = encodeMessage({messageId: 2, protocolOp: {type: 'searchRequest', baseObject: '', scope: 'base', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: Filter.present('cn'), attributes: []}})
        const notice = (message: ReturnType<typeof decodeMessage>): boolean => message.messageId === 0 && message.protocolOp.type === 'extendedResponse' && message.protocolOp.name === ExtendedOperation.noticeOfDisconnection && message.protocolOp.resultCode === 2
        //A scope of 7: the encoding is right, the value is not
        const value: Buffer = Buffer.from(search)
        value[value.indexOf(Buffer.from([0x0a, 0x01, 0x00])) + 2] = 7
        //typesOnly as an OCTET STRING: the encoding is wrong
        const encoding: Buffer = Buffer.from(search)
        encoding[encoding.indexOf(Buffer.from([0x01, 0x01, 0x00]))] = 0x04
        const first: Socket = createConnection({port: port, host: '127.0.0.1'})
        await once(first, 'connect')
        first.write(value)
        const answered = await received(first, 300)
        assert.equal(answered.closed, false)
        assert.ok(answered.messages.some((message) => message.messageId === 2 && message.protocolOp.type === 'searchResultDone' && message.protocolOp.resultCode === 2))
        first.write(encoding)
        const ended = await received(first)
        assert.equal(ended.closed, true)
        assert.ok(ended.messages.some(notice))
        const second: Socket = createConnection({port: port, host: '127.0.0.1'})
        await once(second, 'connect')
        second.write(encodeMessage({messageId: 3, protocolOp: {type: 'bindResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''}}))
        const response = await received(second)
        assert.equal(response.closed, true)
        assert.ok(response.messages.some(notice))
    })

    it('serves the connections of a server made elsewhere', async () => {
        const external: Server = createServer()
        servers[0].attach(external)
        await new Promise<void>((resolve) => external.listen(0, '127.0.0.1', resolve))
        const address = external.address() as {port: number}
        const connection: LDAPClientConnection = await client(`ldap://127.0.0.1:${address.port}`)
        await connection.bind(`uid=user4,ou=people,${BASE}`, 'password4')
        assert.equal(await connection.whoAmI(), `dn:uid=user4,ou=people,${BASE}`)
        await connection.close()
        await new Promise<void>((resolve) => external.close(() => resolve()))
    })
})

describe('the server on a Unix socket (ldapi)', {skip: process.platform === 'win32' ? 'no Unix sockets' : false}, () => {
    after(closeAll)

    let count: number = 0

    /**
     * A path for a socket, nothing there
     */
    function socketPath(): string {
        const path: string = join(tmpdir(), `lakutata-ldapi-${process.pid}-${count++}.sock`)
        rmSync(path, {force: true})
        return path
    }

    it('takes a password over it whatever plaintextBind says, offers PLAIN there but not EXTERNAL, and removes it on close', async () => {
        const server: LDAPServerEngine = await directory({plaintextBind: 'none'})
        const connected: unknown[] = []
        server.events.on('connection', (event: unknown) => connected.push(event))
        const path: string = socketPath()
        assert.equal(await server.listen({path: path, mode: 0o600}), path)
        assert.equal(lstatSync(path).isSocket(), true)
        assert.equal(lstatSync(path).mode & 0o777, 0o600)
        const connection: LDAPClientConnection = await client(`ldapi://${encodeURIComponent(path)}`)
        await connection.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        assert.equal(await connection.whoAmI(), `dn:uid=user1,ou=people,${BASE}`)
        assert.deepEqual((await connection.search('', {scope: 'base', attributes: ['supportedSASLMechanisms']})).entries[0].get('supportedSASLMechanisms'), ['PLAIN'])
        await connection.saslBind('PLAIN', Buffer.from(`\u0000uid=user2,ou=people,${BASE}\u0000password2`))
        assert.equal(await connection.whoAmI(), `dn:uid=user2,ou=people,${BASE}`)
        await assert.rejects(connection.saslBind('EXTERNAL'), (error: unknown) => error instanceof LDAPResultException && error.code === 7)
        assert.equal((connected[0] as {local?: boolean}).local, true)
        await connection.close()
        await server.close()
        assert.equal(existsSync(path), false)
    })

    it('replaces a socket a stopped server left, and leaves a live socket and other files alone', async () => {
        const path: string = socketPath()
        //A process listening on the path, killed: its socket stays
        const child = spawn(process.execPath, ['-e', 'require("node:net").createServer().listen(process.argv[1], () => console.log("listening"))', path], {stdio: ['ignore', 'pipe', 'inherit'], env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}})
        await once(child.stdout!, 'data')
        child.kill('SIGKILL')
        await once(child, 'exit')
        assert.equal(lstatSync(path).isSocket(), true)
        const server: LDAPServerEngine = await directory()
        await server.listen({path: path})
        const connection: LDAPClientConnection = await client(`ldapi://${encodeURIComponent(path)}`)
        await connection.bind(`uid=user3,ou=people,${BASE}`, 'password3')
        const other: LDAPServerEngine = await directory()
        await assert.rejects(other.listen({path: path}), (error: NodeJS.ErrnoException) => error.code === 'EADDRINUSE')
        assert.equal(await connection.whoAmI(), `dn:uid=user3,ou=people,${BASE}`)
        const file: string = socketPath()
        writeFileSync(file, 'kept')
        await assert.rejects(other.listen({path: file}), (error: NodeJS.ErrnoException) => error.code === 'EADDRINUSE')
        assert.equal(readFileSync(file, 'utf8'), 'kept')
        rmSync(file)
        await other.close()
    })

    it('refuses a path too long, a path with a port, and a mode out of range', async () => {
        const server: LDAPServerEngine = await directory()
        await assert.rejects(server.listen({path: join(tmpdir(), 'x'.repeat(120))}), LDAPUsageException)
        await assert.rejects(server.listen({path: socketPath(), port: 389} as never), LDAPUsageException)
        await assert.rejects(server.listen({path: socketPath(), mode: 0o1777}), LDAPUsageException)
    })

    it('serves the connections of a server listening on a path made elsewhere as local', async () => {
        const server: LDAPServerEngine = await directory({plaintextBind: 'none'})
        const external: Server = createServer()
        server.attach(external)
        const path: string = socketPath()
        await new Promise<void>((resolve) => external.listen(path, resolve))
        const connection: LDAPClientConnection = await client(`ldapi://${encodeURIComponent(path)}`)
        await connection.bind(`uid=user4,ou=people,${BASE}`, 'password4')
        await connection.close()
        await new Promise<void>((resolve) => external.close(() => resolve()))
    })
})

describe('the limits and the end of the server', () => {
    after(closeAll)

    it('refuses a password in clear when asked to, and takes it over StartTLS', async () => {
        const {url} = await serve({plaintextBind: 'none'})
        const plain: LDAPClientConnection = await client(url)
        await assert.rejects(plain.bind(`uid=user1,ou=people,${BASE}`, 'password1'), (error: unknown) => error instanceof LDAPResultException && error.code === 13)
        const secure: LDAPClientConnection = await client({url: url, tls: TLS, startTLS: true})
        await secure.bind(`uid=user1,ou=people,${BASE}`, 'password1')
    })

    it('refuses a password in clear by SASL PLAIN too when asked to, alike for a name that exists and one that does not', async () => {
        //PLAIN offered without TLS, plaintextBind none
        const {url: clearURL} = await serve({plaintextBind: 'none', sasl: [{...plainMechanism(), requiresTLS: false}]})
        const connection: LDAPClientConnection = await client({url: clearURL})
        const answer = (name: string): Promise<number> => connection.saslBind('PLAIN', Buffer.from(`\0dn:${name}\0password1`)).then((): number => 0, (error: unknown): number => (error as LDAPResultException).code)
        //Not offered in clear, as the root DSE says: the same answer for both names
        assert.deepEqual([await answer(`uid=user1,ou=people,${BASE}`), await answer(`uid=nobody,ou=people,${BASE}`)], [7, 7])
        const offered = async (session: LDAPClientConnection): Promise<string[]> => (await session.search('', {scope: 'base', attributes: ['supportedSASLMechanisms']})).entries[0].get('supportedSASLMechanisms')
        assert.equal((await offered(connection)).includes('PLAIN'), false)
        //Over TLS: offered and taken
        const secure: LDAPClientConnection = await client({url: clearURL, tls: TLS, startTLS: true})
        assert.equal((await offered(secure)).includes('PLAIN'), true)
        await secure.saslBind('PLAIN', Buffer.from(`\0dn:uid=user1,ou=people,${BASE}\0password1`))
    })

    it('refuses a password in clear in a write and a Password Modify too when asked to, and takes it over StartTLS', async () => {
        //Anyone may sign up below the people, and change the entries there
        const {url} = await serve({plaintextBind: 'none', access: {admins: [ADMIN], anonymousRead: true, check: (request: {operation: string, dn: {isDescendantOf(dn: string): boolean}}): boolean | undefined => ['add', 'modify'].includes(request.operation) && request.dn.isDescendantOf(`ou=people,${BASE}`) ? true : undefined}})
        const plain: LDAPClientConnection = await client(url)
        await assert.rejects(plain.add(`uid=signup1,ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: 'signup1', cn: 'Signup', sn: 'S', userPassword: 'chosen-in-clear'}), (error: unknown) => error instanceof LDAPResultException && error.code === 13)
        //Without a password, or over TLS: added
        await plain.add(`uid=signup2,ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: 'signup2', cn: 'Signup', sn: 'S'})
        //A password written by a modify, or given to a Password Modify, in clear: refused
        await assert.rejects(plain.modify(`uid=signup2,ou=people,${BASE}`, {operation: 'replace', attribute: 'userPassword', values: 'chosen-in-clear'}), (error: unknown) => error instanceof LDAPResultException && error.code === 13)
        await assert.rejects(plain.passwordModify({userIdentity: `uid=user1,ou=people,${BASE}`, oldPassword: 'password1', newPassword: 'chosen-in-clear'}), (error: unknown) => error instanceof LDAPResultException && error.code === 13)
        const secure: LDAPClientConnection = await client({url: url, tls: TLS, startTLS: true})
        await secure.add(`uid=signup3,ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: 'signup3', cn: 'Signup', sn: 'S', userPassword: 'chosen-over-tls'})
        await secure.bind(`uid=signup3,ou=people,${BASE}`, 'chosen-over-tls')
    })

    it('locks a DN after too many failed binds, with invalidCredentials like any failure', async () => {
        const {url} = await serve({bindThrottle: {maxFailures: 3, lockout: 300, delay: 0}})
        const connection: LDAPClientConnection = await client(url)
        for (let index: number = 0; index < 3; index++) await assert.rejects(connection.bind(`uid=user1,ou=people,${BASE}`, 'wrong'), LDAPInvalidCredentialsException)
        await assert.rejects(connection.bind(`uid=user1,ou=people,${BASE}`, 'password1'), LDAPInvalidCredentialsException)
        await connection.bind(`uid=user2,ou=people,${BASE}`, 'password2')
        await new Promise((resolve) => setTimeout(resolve, 350))
        await connection.bind(`uid=user1,ou=people,${BASE}`, 'password1')
    })

    it('abandons a search that times out, the backend told by its signal, and goes on with the connection', async () => {
        let aborted: boolean = false
        const server: LDAPServerEngine = createLDAPServer({
            backends: [createHandlerBackend({
                suffix: BASE,
                get: (context, dn) => ({dn: dn, attributes: {objectClass: 'domain', dc: 'example'}}),
                search: async function* (context: SearchContext) {
                    if (context.scope === 'base') {
                        yield {dn: BASE, attributes: {objectClass: 'domain', dc: 'example'}}
                        return
                    }
                    await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => {
                        aborted = true
                        resolve()
                    }, {once: true}))
                } as never
            })],
            access: {anonymousRead: true}
        })
        servers.push(server)
        const port: number = await server.listen({port: 0, host: '127.0.0.1'})
        const connection: LDAPClientConnection = await client(`ldap://127.0.0.1:${port}`)
        await assert.rejects(connection.search(BASE, {timeout: 200}), LDAPTimeoutException)
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.equal(aborted, true)
        assert.equal((await connection.search(BASE, {scope: 'base'})).entries.length, 1)
    })

    it('answers busy beyond the requests a session may have outstanding', async () => {
        let release: () => void = () => undefined
        const waiting: Promise<void> = new Promise((resolve) => {
            release = resolve
        })
        const server: LDAPServerEngine = createLDAPServer({
            backends: [createHandlerBackend({
                suffix: BASE,
                get: (context, dn) => ({dn: dn, attributes: {objectClass: 'domain', dc: 'example'}}),
                search: async () => {
                    await waiting
                    return []
                }
            })],
            access: {anonymousRead: true},
            limits: {anonymousOutstanding: 2}
        })
        servers.push(server)
        const port: number = await server.listen({port: 0, host: '127.0.0.1'})
        const connection: LDAPClientConnection = await client(`ldap://127.0.0.1:${port}`)
        const searches = [connection.search(BASE), connection.search(BASE), connection.search(BASE).catch((error: unknown) => error)]
        const third = await searches[2]
        assert.ok(third instanceof LDAPResultException && third.code === 51)
        release()
        await Promise.all(searches.slice(0, 2))
    })

    it('closes a connection whose message is larger than its session may send', async () => {
        const {url} = await serve({limits: {anonymousMessageSize: 1024}})
        const connection: LDAPClientConnection = await client(url)
        await assert.rejects(connection.compare(BASE, 'description', 'x'.repeat(2000)), LDAPConnectionException)
        assert.equal(connection.closed, true)
        const bound: LDAPClientConnection = await client(url)
        await bound.bind(`uid=user1,ou=people,${BASE}`, 'password1')
        await assert.rejects(bound.compare(BASE, 'description', 'x'.repeat(2000)), (error: unknown) => error instanceof LDAPResultException)
    })

    it('sends a Notice of Disconnection to each connection when it closes', async () => {
        const {server, url} = await serve()
        const connection: LDAPClientConnection = await client(url)
        let notice: unknown
        connection.events.on('notice', (response) => {
            notice = response
        })
        //The server has the connection once it answers on it
        assert.equal(await connection.whoAmI(), '')
        await server.close()
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.ok(notice)
        assert.equal(connection.closed, true)
        assert.equal(server.connectionCount, 0)
    })
})

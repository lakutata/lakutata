import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createConnection, createServer, type Server, type Socket} from 'node:net'
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
    plainMechanism,
    type LDAPClientConnection,
    LDAPConnectionException,
    LDAPInvalidCredentialsException,
    LDAPResultException,
    type LDAPServerEngine,
    LDAPTimeoutException,
    MemoryBackend,
    MessageReader,
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
 * A server listening on a free port of the loopback, with a directory of a few people
 */
async function serve(options: Partial<Parameters<typeof createLDAPServer>[0]> = {}, people: number = 5): Promise<{server: LDAPServerEngine, url: string, port: number}> {
    const server: LDAPServerEngine = createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ADMIN]}, passwords: {iterations: 1000}, bindThrottle: {delay: 0}, tls: {cert: CERTIFICATE, key: KEY}, ...options})
    servers.push(server)
    const admin = server.connect({as: ADMIN})
    await admin.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
    await admin.add(`ou=people,${BASE}`, {objectClass: 'organizationalUnit', ou: 'people'})
    for (let index: number = 0; index < people; index++) await admin.add(`uid=user${index},ou=people,${BASE}`, {objectClass: 'inetOrgPerson', uid: `user${index}`, cn: `User ${index}`, sn: 'S', userPassword: `password${index}`})
    await admin.add(ADMIN.replace(`,${BASE}`, `,${BASE}`), {objectClass: ['organizationalRole', 'simpleSecurityObject'], cn: 'admin', userPassword: 'secret'})
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

after(async () => {
    for (const connection of clients) connection.destroy()
    for (const server of servers) await server.close()
})

describe('the server engine on the network', () => {
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

describe('the limits and the end of the server', () => {
    it('refuses a password in clear when asked to, and takes it over StartTLS', async () => {
        const {url} = await serve({plaintextBind: 'none'})
        const plain: LDAPClientConnection = await client(url)
        await assert.rejects(plain.bind(`uid=user1,ou=people,${BASE}`, 'password1'), (error: unknown) => error instanceof LDAPResultException && error.code === 13)
        const secure: LDAPClientConnection = await client({url: url, tls: TLS, startTLS: true})
        await secure.bind(`uid=user1,ou=people,${BASE}`, 'password1')
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

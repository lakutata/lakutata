import assert from 'node:assert/strict'
import {type AddressInfo, createServer, type Server, type Socket} from 'node:net'
import {after, before, describe, it} from 'node:test'
import {Container} from '@lakutata/core'
import {encodeMessage, type LDAPMessage, type LDAPResponse, MessageReader} from '@lakutata/ldap-engine'
import {LDAPClient} from '../exports/LDAP.js'

/**
 * A server of canned answers: binds as cn=service with the password secret, a search gives one entry, the users bind
 * with the password good
 */
function cannedServer(): {server: Server, binds: string[], sockets: Set<Socket>} {
    const binds: string[] = []
    const sockets: Set<Socket> = new Set()
    const server: Server = createServer((socket: Socket): void => {
        sockets.add(socket)
        socket.on('close', (): boolean => sockets.delete(socket))
        const reader: MessageReader = new MessageReader()
        const reply = (messageId: number, response: LDAPResponse): void => {
            socket.write(encodeMessage({messageId: messageId, protocolOp: response}))
        }
        socket.on('error', (): void => undefined)
        socket.on('data', (chunk: Buffer): void => {
            for (const {message} of reader.push(chunk)) {
                if (!message) continue
                const request: LDAPMessage['protocolOp'] = message.protocolOp
                if (request.type === 'bindRequest' && request.authentication.type === 'simple') {
                    binds.push(request.name)
                    const password: string = request.authentication.password.toString()
                    const ok: boolean = (request.name === 'cn=service' && password === 'secret') || (request.name !== 'cn=service' && password === 'good')
                    reply(message.messageId, {type: 'bindResponse', resultCode: ok ? 0 : 49, matchedDN: '', diagnosticMessage: ''})
                } else if (request.type === 'searchRequest') {
                    reply(message.messageId, {type: 'searchResultEntry', objectName: 'uid=alice,dc=example', attributes: [{type: 'uid', values: [Buffer.from('alice')]}]})
                    reply(message.messageId, {type: 'searchResultDone', resultCode: 0, matchedDN: '', diagnosticMessage: ''})
                } else if (request.type === 'unbindRequest') {
                    socket.end()
                }
            }
        })
    })
    return {server: server, binds: binds, sockets: sockets}
}

describe('the LDAPClient component', () => {
    const {server, binds, sockets} = cannedServer()
    let url: string

    before(async () => {
        await new Promise<void>((resolve: () => void): void => {
            server.listen(0, '127.0.0.1', resolve)
        })
        url = `ldap://127.0.0.1:${(server.address() as AddressInfo).port}`
    })

    after(async () => {
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve: () => void): void => {
            server.close((): void => resolve())
        })
    })

    it('searches and authenticates with a pool bound as its identity, closed with the container', async () => {
        const container: Container = new Container()
        try {
            await container.setNamed('ldap', LDAPClient, {url: url, bindDN: 'cn=service', password: 'secret', poolSize: 2})
            const ldap: LDAPClient = await container.get<LDAPClient>('ldap')
            const result = await ldap.search('dc=example', {filter: '(uid=alice)'})
            assert.equal(result.entries[0].first('uid'), 'alice')
            const good = await ldap.authenticate({username: 'alice', password: 'good', base: 'dc=example', requireTLS: false})
            assert.deepEqual([good.ok, good.dn], [true, 'uid=alice,dc=example'])
            const bad = await ldap.authenticate({username: 'alice', password: 'bad', base: 'dc=example', requireTLS: false})
            assert.deepEqual([bad.ok, bad.reason], [false, 'invalidCredentials'])
            assert.ok(binds.includes('cn=service'))
            assert.ok(binds.includes('uid=alice,dc=example'))
            await ldap.close()
            assert.equal((await ldap.search('dc=example')).entries.length, 1)
            await container.destroy()
            await new Promise((resolve) => setTimeout(resolve, 100))
            assert.equal(sockets.size, 0)
            await assert.rejects(ldap.close(), /destroyed/)
        } finally {
            await container.destroy()
        }
    })

    it('refuses options without a server', async () => {
        const container: Container = new Container()
        try {
            await assert.rejects(container.setNamed('ldap', LDAPClient, {bindDN: 'cn=service'}), /needs a url or an srv record/)
        } finally {
            await container.destroy()
        }
    })
})

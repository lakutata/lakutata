import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {Component, Container, DTO} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {type InterfaceAddress, listInterfaces, type NetworkInterfaceInfo} from '@lakutata/netif'
import {
    type BackendSearchResult,
    connectLDAP,
    type DirectoryEntry,
    DN,
    type LDAPBackend,
    type LDAPClientConnection,
    LDAPConnectionException,
    type LDAPInterceptor,
    LDAPServer,
    MemoryBackend,
    type OperationContext,
    type ServerRequest
} from '../exports/LDAP.js'
import {CERTIFICATE, KEY} from './support/Certificate.js'

const BASE: string = 'dc=example,dc=com'
const ADMIN: string = 'cn=admin,dc=example,dc=com'
const TLS = {ca: CERTIFICATE, servername: 'localhost'}

/**
 * The loopback interface, found by its address
 */
const LOOPBACK: string = listInterfaces().find((entry: NetworkInterfaceInfo): boolean => entry.addresses.some((address: InterfaceAddress): boolean => address.address === '127.0.0.1'))!.name

/**
 * A backend written as a lakutata object, its suffix an option
 */
class DevicesBackend extends Component implements LDAPBackend {
    @Configurable(DTO.String().required())
    public readonly suffix: string

    protected entries(): DirectoryEntry[] {
        return [
            {dn: DN.parse(this.suffix), attributes: [{type: 'objectClass', values: [Buffer.from('organizationalUnit')]}, {type: 'ou', values: [Buffer.from('devices')]}]},
            {dn: DN.parse(`cn=printer1,${this.suffix}`), attributes: [{type: 'objectClass', values: [Buffer.from('device')]}, {type: 'cn', values: [Buffer.from('printer1')]}]}
        ]
    }

    public async get(context: OperationContext, dn: DN): Promise<DirectoryEntry | undefined> {
        return this.entries().find((entry: DirectoryEntry): boolean => entry.dn.equals(dn, context.schema))
    }

    public async search(): Promise<BackendSearchResult> {
        return {entries: this.entries(), exact: false}
    }
}

/**
 * An interceptor written as a lakutata object: it adds a description to the entries added
 */
class DescribeInterceptor extends Component implements LDAPInterceptor {
    @Configurable(DTO.String().required())
    protected readonly text: string

    public readonly name: string = 'describe'

    public readonly operations = ['add'] as const

    public before(context: OperationContext, request: ServerRequest): void {
        if (request.type === 'add' && !request.entry.attributes.some((attribute) => attribute.type === 'description')) request.entry.attributes.push({type: 'description', values: [Buffer.from(this.text)]})
    }
}

describe('the LDAPServer component', () => {
    it('serves LDAP, StartTLS and LDAPS, and the directory in process, its backends and interceptors built in its container', async () => {
        const container: Container = new Container()
        try {
            await container.setNamed('ldap', LDAPServer, {
                host: '127.0.0.1',
                port: 0,
                ldapsPort: 0,
                tls: {cert: CERTIFICATE, key: KEY},
                backends: [new MemoryBackend(BASE), {class: DevicesBackend, suffix: `ou=devices,${BASE}`}],
                interceptors: [{class: DescribeInterceptor, text: 'added by the application', before: 'schema'}],
                access: {admins: [ADMIN], anonymousRead: true},
                passwords: {iterations: 1000}
            })
            const ldap: LDAPServer = await container.get<LDAPServer>('ldap')
            const directory = ldap.directory(ADMIN)
            await directory.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
            const people: string = await directory.createOrganizationalUnit(BASE, {ou: 'people'})
            const alice: string = await directory.createUser(people, {uid: 'alice', cn: 'Alice', sn: 'Liu'}, 'secret')
            const {ldap: port, ldaps} = ldap.ports
            assert.ok(port && ldaps)
            const plain: LDAPClientConnection = await connectLDAP({url: `ldap://127.0.0.1:${port}`, tls: TLS, startTLS: true})
            await plain.bind(alice, 'secret')
            assert.equal((await plain.search(alice, {scope: 'base'})).entries[0].first('description'), 'added by the application')
            assert.equal((await plain.search(`ou=devices,${BASE}`, {filter: '(cn=printer1)'})).entries.length, 1)
            await plain.close()
            const secure: LDAPClientConnection = await connectLDAP({url: `ldaps://127.0.0.1:${ldaps}`, tls: TLS})
            assert.equal((await secure.search('', {scope: 'base', attributes: ['vendorName', 'namingContexts']})).entries[0].first('vendorName'), 'lakutata')
            await secure.close()
            assert.equal(await ldap.connect(ADMIN).whoAmI(), `dn:${ADMIN}`)
        } finally {
            await container.destroy()
        }
    })

    it('listens on a network interface, and stops listening when destroyed', async () => {
        const container: Container = new Container()
        let port: number | undefined
        try {
            await container.setNamed('ldap', LDAPServer, {interface: LOOPBACK, family: 'IPv4', port: 0, backends: [new MemoryBackend(BASE)], access: {anonymousRead: true}})
            const ldap: LDAPServer = await container.get<LDAPServer>('ldap')
            port = ldap.ports.ldap
            assert.ok(port)
            const connection: LDAPClientConnection = await connectLDAP(`ldap://127.0.0.1:${port}`)
            assert.deepEqual((await connection.search('', {scope: 'base', attributes: ['namingContexts']})).entries[0].get('namingContexts'), [BASE])
            await connection.close()
        } finally {
            await container.destroy()
        }
        await assert.rejects(connectLDAP({url: `ldap://127.0.0.1:${port}`, connectTimeout: 1000}), LDAPConnectionException)
    })

    it('refuses options that do not go together', async () => {
        const container: Container = new Container()
        try {
            await assert.rejects(container.setNamed('ldap', LDAPServer, {port: 0, ldapsPort: 0, backends: [new MemoryBackend(BASE)]}), /needs its tls option/)
            await assert.rejects(container.setNamed('ldap2', LDAPServer, {host: '127.0.0.1', interface: LOOPBACK, port: 0, backends: [new MemoryBackend(BASE)]}), /host and interface/)
        } finally {
            await container.destroy()
        }
    })
})

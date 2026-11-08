# @lakutata/ldap

English | [中文](README.zh-CN.md)

LDAP for the [lakutata](https://www.npmjs.com/package/lakutata) framework. The `LDAPServer` component serves a directory
from the application: its backends hold the entries, and the application reads and writes them without the network.
The `LDAPClient` component gives an application a pool of connections to an LDAP server (OpenLDAP, Active Directory,
389 Directory Server…). Both are built on [`@lakutata/ldap-engine`](https://www.npmjs.com/package/@lakutata/ldap-engine),
which this package re-exports.

## Installation

```shell
npm install lakutata @lakutata/ldap
```

Node.js `>=18.10.0`, Bun, Electron and NW.js. To listen on network interfaces, also install `@lakutata/netif`.

## Usage

### The server

```typescript
import {readFileSync} from 'node:fs'
import {Application} from 'lakutata'
import {buildLDAPServerOptions, type LDAPServer, MemoryBackend} from '@lakutata/ldap'

Application.run(() => ({
    id: 'directory.app',
    name: 'Directory',
    components: {
        ldap: buildLDAPServerOptions({
            port: 389,
            ldapsPort: 636,
            tls: {cert: readFileSync('server.crt'), key: readFileSync('server.key')},
            backends: [new MemoryBackend('dc=example,dc=com')],
            access: {admins: ['cn=admin,dc=example,dc=com']}
        })
    },
    bootstrap: ['ldap']
})).onLaunched(async (app) => {
    const ldap: LDAPServer = await app.getObject('ldap')
    const directory = ldap.directory('cn=admin,dc=example,dc=com')
    await directory.add('dc=example,dc=com', {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
    const people = await directory.createOrganizationalUnit('dc=example,dc=com', {ou: 'people'})
    await directory.createUser(people, {uid: 'alice', cn: 'Alice Liu', sn: 'Liu'}, 'secret')
})
```

The component listens for LDAP (with StartTLS when `tls` is given) and LDAPS, on an address or on network interfaces
(`interface: 'eth1'`, whatever its addresses). A backend or an interceptor can be an object, or a lakutata class with
its options (`{class: DevicesBackend, suffix: 'ou=devices,dc=example,dc=com'}`), built in the component's container.
`connect()` gives a connection in the same process with the operations of the client, and `directory()` gives the
directory helper on such a connection; both go through the same schema checks, password hashing and access control as the network requests.
What the server does (the schema, the passwords, the access rules, the interceptors) is described in the README of
`@lakutata/ldap-engine`.

### The client

```typescript
import {Application} from 'lakutata'
import {buildLDAPClientOptions, filter, type LDAPClient} from '@lakutata/ldap'

Application.run(() => ({
    id: 'directory.app',
    name: 'Directory',
    components: {
        ldap: buildLDAPClientOptions({
            url: 'ldaps://dc1.example.com',
            bindDN: 'CN=svc-app,OU=Service,DC=example,DC=com',
            password: process.env.LDAP_PASSWORD
        })
    }
})).onLaunched(async (app) => {
    const ldap: LDAPClient = await app.getObject('ldap')
    const name: string = 'alice'
    const {entries} = await ldap.search('DC=example,DC=com', {
        filter: filter`(&(objectClass=user)(sAMAccountName=${name}))`,
        attributes: ['displayName', 'mail', 'memberOf']
    })
    console.log(entries[0]?.get('memberOf'))

    const result = await ldap.authenticate({username: 'alice', password: 'secret', base: 'DC=example,DC=com', attribute: 'sAMAccountName'})
    console.log(result.ok ? result.dn : result.reason)
})
```

The component has the operations of an LDAP connection (`search()`, `searchIterator()`, `compare()`, `add()`,
`modify()`, `delete()`, `modifyDN()`, `extended()`, `passwordModify()`, `whoAmI()`), `authenticate()` to check a user's
password on a connection of its own, `readSchema()`, and `connect()` for a connection apart from the pool. Its
connections open on the first operation and close with the application. Searches are paged, and a result that is not a
success throws its exception. `authenticate()` sends passwords only over TLS (an `ldaps` URL or `startTLS: true`) or a
local `ldapi` socket, unless it is given `requireTLS: false`.

## Options

### LDAPServer

| Option | Default | What it is |
|---|---|---|
| `host` | all addresses | The address listened on |
| `port` | `389` | The port of LDAP (`0` for a free one) |
| `ldapsPort` | | The port of LDAPS, with `tls` |
| `tls` | | The certificate and key of StartTLS and LDAPS (`cert`, `key`); for SASL EXTERNAL, `requestCert: true` and the CA of the client certificates in `ca` |
| `interface`, `strict`, `family`, `onError`, `interfaceListening` | | Listen on network interfaces instead of an address |
| `backends` | | The backends: objects, or lakutata classes with their options |
| `interceptors` | | The interceptors: objects, placements, or lakutata classes with their options |
| `schema` | the bundled files | `bundled` (the bundled files to load) and `files` (schema files of one's own, by path or text) |
| `access` | | `admins`, `passwordAdmins`, `anonymousRead`, `authenticatedRead`, `check` |
| `limits` | | The size, time, message, request and connection limits |
| `bindThrottle` | 5 failures lock the DN | The limits on failed binds |
| `plaintextBind` | `'all'` | Where a password is accepted without TLS: `'all'`, `'loopback'`, `'none'` |
| `allowUnauthenticatedBind` | `false` | Accept a bind with a name and no password as anonymous |
| `passwords` | `{PBKDF2-SHA512}` | The scheme passwords are written in, and the iterations of PBKDF2 |
| `rehashOnBind` | `true` | Hash a password again in the scheme of the server after a bind with a weaker one |
| `sasl` | PLAIN, EXTERNAL | The SASL mechanisms |
| `extendedOperations`, `controls` | | Extended operations and controls of one's own |
| `vendorName`, `vendorVersion`, `defaultNamingContext`, `rootDSEAttributes` | `lakutata` | What the root DSE says |
| `schemaConfigView` | `false` | Show the schema files read-only as OpenLDAP does (`cn=schema,cn=config`) |

### LDAPClient

| Option | Default | What it is |
|---|---|---|
| `url` | | The LDAP URL of the server, or of several tried in order |
| `srv` | | A DNS SRV record naming the servers, instead of `url` |
| `bindDN`, `password` | anonymous | The identity of the pool |
| `tls` | | The options of TLS (`ca`, `cert`, `key`, `rejectUnauthorized`…) |
| `startTLS` | `false` | Run StartTLS on each connection of an `ldap://` URL |
| `poolSize` | `4` | The most connections of the pool |
| `connectTimeout` | `5000` | The milliseconds a connection may take |
| `timeout` | `30000` | The milliseconds an operation may take before it is abandoned (`0` for none) |
| `idleTimeout` | `600000` | Close a connection idle that many milliseconds |
| `maxMessageSize` | 64 MiB | The largest message a server may send |
| `binaryAttributes` | | More attributes whose values are bytes |

## API

| Export | What it is |
|---|---|
| `LDAPServer`, `buildLDAPServerOptions(options)`, `LDAPServerOptions` | The server component and its options |
| `LDAPClient`, `buildLDAPClientOptions(options)`, `LDAPClientOptions` | The client component and its options |
| `ObjectSpecification`, `InterceptorSpecification`, `InterfaceListeningOptions` | The types of the options |
| Everything `@lakutata/ldap-engine` exports | The protocol, the client, the server engine, the directory helper |

# @lakutata/ldap

English | [中文](README.zh-CN.md)

LDAP for the [Lakutata](https://www.npmjs.com/package/lakutata) framework. The `LDAPServer` component serves a directory
from the application: its backends hold the entries (the `DirectoryBackend` keeps them in the application's database),
and the application reads and writes them without going over the network. The `LDAPClient` component provides an
application with a pool of connections to an LDAP server (OpenLDAP, Active Directory, 389 Directory Server…). Both are
built on [`@lakutata/ldap-engine`](https://www.npmjs.com/package/@lakutata/ldap-engine), which this package re-exports.

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

The component listens for LDAP (with StartTLS when `tls` is specified) and LDAPS, on an address or on network interfaces
(`interface: 'eth1'`, regardless of its addresses). With `ldapiPath` it also listens on a Unix socket, which accepts
passwords as TLS does, for clients on the same machine (SSSD, nslcd); `port: false` leaves out the LDAP port. A backend,
a plugin or an interceptor can be an object (the plugins from `@lakutata/ldap-engine`: `new MemberOfPlugin()`), or a
Lakutata class with its options (`{class: DevicesBackend, suffix: 'ou=devices,dc=example,dc=com'}`), built in the
component's container. `connect()` returns a connection in the same process with the client's operations, and
`directory()` returns the directory helper on such a connection; both go through the same schema checks, password
hashing and access control as network requests. What the server does (the schema, passwords, access rules, plugins) is
described in the `@lakutata/ldap-engine` README.

### The directory backend

```typescript
import {Application} from 'lakutata'
import {buildDatabaseOptions} from 'lakutata/com/database'
import {buildLDAPServerOptions, DirectoryBackend, directoryEntities} from '@lakutata/ldap'

Application.run(() => ({
    id: 'directory.app',
    name: 'Directory',
    components: {
        database: buildDatabaseOptions({type: 'postgres', url: process.env.DATABASE_URL, entities: directoryEntities('postgres')}),
        ldap: buildLDAPServerOptions({
            port: 389,
            backends: [{
                class: DirectoryBackend,
                database: 'database',
                suffix: 'dc=example,dc=com',
                unique: ['uid', 'mail'],
                initialize: {admin: {dn: 'cn=admin,dc=example,dc=com', password: process.env.LDAP_ADMIN_PASSWORD!}}
            }],
            access: {admins: ['cn=admin,dc=example,dc=com']},
            passwordPolicy: {default: {lockout: true, maxFailure: 5, lockoutDuration: 900, maxAge: 7776000, expireWarning: 1209600}}
        })
    },
    bootstrap: ['database', 'ldap']
}))
```

The directory backend keeps its suffix's entries in the application's database (PostgreSQL, MySQL or SQLite): one table
of entries and one row per value, whatever their object classes, so the server's schema decides what an entry holds. Add
`directoryEntities(type)`, called with the database type (MySQL keeps the values in a LONGTEXT column), to the
database's entities; the migrations belong to the application, as for its other entities.

- Searches are run by the database: filters become SQL on the forms of values that the matching rules compare by
  (equality, substrings, integers and times), and the server checks what SQL cannot decide exactly.
- A sorted search (the sort control, and the virtual list view's window) is sorted by the backend, which reads only the
  entries in the window: an offset-based window is ordered, counted and cut by the database on a sort key kept with each
  value; otherwise the backend reads the values of the sort keys and orders the entries by them as the server would. A
  sort key follows its attribute's ordering rule when the value is written: after the schema changes that rule, values
  written before keep their old keys until they are written again (OpenLDAP likewise rebuilds its indexes with
  slapindex). An entry with no value for a sort key comes after the others, and before them in reverse order (RFC 2891).
  With `access.check` (unless `access.checkReads` is false, as for a check that does not decide reads), or an
  interceptor that removes entries from searches, the server sorts and windows a virtual list view itself, within
  `limits.sortCandidates`, so that its counts leave out what the session may not read.
- A search's entries come in a fixed order: an entry before the entries below it, siblings in the order they were added
  (entryUUID is a version 7 UUID, whose order is the order of creation; an entry imported with its own entryUUID takes
  its place by that value). Entries with equal sort keys keep this order.
- The DN values of member, manager, seeAlso and similar attributes point to their entries: they follow a rename, and are
  removed when the entry is deleted (a required attribute left empty keeps a placeholder, the empty DN by default).
- memberOf is computed when it is read, and a filter on it finds a group's members; `nestedGroups` follows nested
  groups. memberUid is computed for posixGroup entries, for RFC 2307 clients.
- uidNumber and gidNumber are allocated to the posixAccount and posixGroup entries added without them (from 10000); a
  uidNumber is unique, and so is a posixGroup's gidNumber among the groups. The POSIX classes come with the bundled
  schema rfc2307bis, which `schema.bundled` names (it is not loaded by default).
- The values of the attributes listed in `unique` are unique in the suffix; the time of the last successful bind with a
  password, simple or SASL PLAIN, is provided as authTimestamp (a bind made while a write holds the entry, or on SQLite
  while any write runs, does not wait for it and omits its time; on MySQL before 8.0 and MariaDB before 10.6, which
  cannot skip a row another write holds, the bind waits); failed binds are kept in the database, so an application's
  instances share them, as they share the password policy state (when two instances fail a bind in the same millisecond,
  before either has written, they can record the failure with the same time, which is kept once, so the two count as
  one); `mailAlias` provides email with the values of mail.
- Each write runs in a transaction, with the interceptors' `beforeCommit()`. Writes to one entry take turns, including
  when several instances share the database (on SQLite, every write to the file takes its turn), so two clients changing
  different values of an attribute at the same time both keep their changes.
- Searches and writes that `beforeCommit()` makes through a server on the same Database component run in the write's
  transaction: they see what it has written so far, and the writes are rolled back with it if it fails. A search made
  this way reads all of its entries before it returns. While it reads, the write's other operations wait and its locks
  stay held. A large search keeps every entry in memory, and its size limit bounds what it returns, not how much it
  reads. Once its time limit passes, it stops reading and fails with timeLimitExceeded, with no entries. On PostgreSQL,
  if the database rejects one of these reads (a statement timeout, for example), the write fails as well, even if the
  interceptor catches the error.
- When the database ends a write to break a deadlock, cannot serialize it, or gives up waiting for a lock (a lock
  timeout set on the database, or on SQLite a file another process holds past the busy timeout), the write fails with
  busy (51) and leaves no changes; the client can send it again.
- Configure a MariaDB server as `mariadb`: when it is configured as `mysql`, the backend locks exclusively the rows it
  would otherwise lock in shared mode (a parent, the entries that values name), so entries added under one parent, and
  values naming one entry, are written one after another.
- On SQLite, a write that `beforeCommit()` makes through another Database component on the same file is refused
  (unwillingToPerform), because it would wait for the write it is made in. Make such writes through a server on the
  same Database component.
- A DN value written at the same time as the entry it names is pointed at that entry once both writes are committed. An
  error in that step is reported as an `error` event on the server, which the component logs; the write itself has
  already completed.
- The plugins from `@lakutata/ldap-engine` that do what the backend does itself (`MemberOfPlugin`,
  `ReferentialIntegrityPlugin`, `IdAllocationPlugin`, `LastBindPlugin`) are left out of its chain; the others
  (`UniquePlugin`, `AuditPlugin`, `ConstraintPlugin`…) run for it as for any backend.
- `initialize` creates the suffix entry and an administrator on the first start (or imports LDIF), once.

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

The component provides the operations of an LDAP connection (`search()`, `searchIterator()`, `compare()`, `add()`,
`modify()`, `delete()`, `modifyDN()`, `extended()`, `passwordModify()`, `whoAmI()`), `authenticate()` to check a user's
password on its own connection, `readSchema()`, and `connect()` for a connection separate from the pool. Its connections
open on the first operation and close with the application. Searches are paged, and a result that is not a success
throws its exception. `authenticate()` sends passwords only over TLS (an `ldaps` URL or `startTLS: true`) or a local
`ldapi` socket, unless it is called with `requireTLS: false`.

## Options

### LDAPServer

| Option | Default | What it is |
|---|---|---|
| `host` | all addresses | The address to listen on |
| `port` | `389` | The LDAP port (`0` for a free one, `false` for none) |
| `ldapsPort` | | The LDAPS port, with `tls` |
| `ldapiPath` | | The path of a Unix socket to listen on as well as the ports (ldapi), for clients on the same machine; passwords are accepted over it as over TLS |
| `ldapiMode` | from the umask | The socket's permissions, which determine who may connect (`0o666`: every user on the machine) |
| `tls` | | The certificate and key for StartTLS and LDAPS (`cert`, `key`); for SASL EXTERNAL, `requestCert: true` and the CA of the client certificates in `ca` |
| `interface`, `strict`, `family`, `onError`, `interfaceListening` | | Listen on network interfaces instead of an address |
| `backends` | | The backends: objects, or Lakutata classes with their options |
| `plugins` | | The plugins: objects, or Lakutata classes with their options (and `name`, `suffixes`) |
| `interceptors` | | Standalone interceptors: objects, placements, or Lakutata classes with their options |
| `schema` | core, cosine, inetorgperson | `bundled` (the bundled schemas by name; `rfc2307bis`, `openssh-lpk` and `ppolicy` are added by naming them, `[]` for none of them), `directory` (a directory of schema files, loaded in the order of their names) and `files` (custom schemas: paths, texts, or documents from `readSchemaFile()`/`parseSchemaFile()`) |
| `access` | | `admins`, `adminPasswords`, `passwordAdmins`, `anonymousRead`, `authenticatedRead`, `check` |
| `limits` | | The size, time, message, request and connection limits |
| `bindThrottle` | 5 failures lock the DN | The limits on failed binds |
| `plaintextBind` | `'all'` | Where a password is accepted without TLS: `'all'`, `'loopback'`, `'none'` (the Unix socket accepts it regardless of this option) |
| `allowUnauthenticatedBind` | `false` | Accept a bind with a name and no password as anonymous |
| `passwords` | `{PBKDF2-SHA512}` | The scheme passwords are written in, and the PBKDF2 iteration count |
| `passwordPolicy` | | The password policy (a `PasswordPolicyPlugin` after the plugins): its default policy (the DN of a pwdPolicy entry, or its rules), `quality`, `revealLocked` |
| `rehashOnBind` | `true` | Hash a password again in the server's scheme after a bind with a weaker one |
| `sasl` | PLAIN, EXTERNAL | The SASL mechanisms |
| `extendedOperations` | | Custom extended operations |
| `vendorName`, `vendorVersion`, `defaultNamingContext`, `rootDSEAttributes` | `lakutata` | The contents of the root DSE |
| `schemaConfigView` | `false` | Show the schema files read-only as OpenLDAP does (`cn=schema,cn=config`) |

### DirectoryBackend

| Option | Default | What it is |
|---|---|---|
| `suffix` | | The DN of the backend's top entry |
| `database` | | The name the application's Database component is registered under (its key in `components`); required |
| `groups` | groupOfNames/member, groupOfUniqueNames/uniqueMember, groupOfMembers/member | The group classes and their member attributes |
| `memberOf` | `true` | Provide memberOf; a custom name and OID when the schema defines memberOf itself, or `false` |
| `nestedGroups` | `0` | The number of nested group levels memberOf follows |
| `memberUid` | `true` | Provide memberUid on posixGroup entries |
| `unique` | | The attributes whose values are unique in the suffix |
| `idAllocation` | from 10000 | The first uidNumber and gidNumber allocated, or `false` |
| `lastBind` | `true` | Provide authTimestamp, the time of the last successful bind with a password |
| `mailAlias` | `false` | Provide email, with the values of mail |
| `referencePlaceholder` | the empty DN | The value left in a required DN attribute whose last value named a deleted entry |
| `sharedThrottle` | `true` | Keep failed binds in the database |
| `initialize` | | `root`, `ldif` and `admin`: what the first start creates |

### LDAPClient

| Option | Default | What it is |
|---|---|---|
| `url` | | The LDAP URL of the server, or of several tried in order |
| `srv` | | A DNS SRV record naming the servers, instead of `url` |
| `bindDN`, `password` | anonymous | The pool's identity |
| `tls` | | TLS options (`ca`, `cert`, `key`, `rejectUnauthorized`…) |
| `startTLS` | `false` | Run StartTLS on each connection to an `ldap://` URL |
| `poolSize` | `4` | The maximum number of connections in the pool |
| `connectTimeout` | `5000` | The milliseconds a connection may take |
| `timeout` | `30000` | The milliseconds an operation may take before it is abandoned (`0` for none) |
| `idleTimeout` | `600000` | Close a connection after it has been idle for that many milliseconds |
| `maxMessageSize` | 64 MiB | The largest message a server may send |
| `binaryAttributes` | | Additional attributes whose values are bytes |

## API

| Export | What it is |
|---|---|
| `LDAPServer`, `buildLDAPServerOptions(options)`, `LDAPServerOptions` | The server component and its options |
| `LDAPClient`, `buildLDAPClientOptions(options)`, `LDAPClientOptions` | The client component and its options |
| `DirectoryBackend`, `DirectoryBackendOptions`, `directoryEntities(type)` | The directory backend, its options, and its entities for a database type |
| `LDAPEntryRecord`, `LDAPValueRecord`, `LDAPMySQLValueRecord`, `LDAPUniqueRecord`, `LDAPBindStateRecord` | The directory backend's entities |
| `ObjectSpecification`, `PluginSpecification`, `PluginObjectSpecification`, `InterceptorSpecification`, `InterfaceListeningOptions` | The option types |
| Everything `@lakutata/ldap-engine` exports | The protocol, the client, the server engine, the directory helper |
| `@lakutata/ldap/schemas` | The bundled schemas as documents (`CORE`, `RFC2307BIS`…, and `DEFAULTS`), the same as those of `@lakutata/ldap-engine/schemas` |

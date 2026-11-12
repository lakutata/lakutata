# @lakutata/ldap

English | [中文](README.zh-CN.md)

LDAP for the [lakutata](https://www.npmjs.com/package/lakutata) framework. The `LDAPServer` component serves a directory
from the application: its backends hold the entries (the `DirectoryBackend` keeps them in the application's database),
and the application reads and writes them without the network.
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
(`interface: 'eth1'`, whatever its addresses). With `ldapiPath` it also listens on a Unix socket, which takes passwords
as TLS does, for the clients on the same machine (SSSD, nslcd); `port: false` leaves out the port of LDAP. A backend, a plugin or an interceptor can be an object (the plugins of
`@lakutata/ldap-engine`: `new MemberOfPlugin()`), or a lakutata class with its options
(`{class: DevicesBackend, suffix: 'ou=devices,dc=example,dc=com'}`), built in the component's container.
`connect()` gives a connection in the same process with the operations of the client, and `directory()` gives the
directory helper on such a connection; both go through the same schema checks, password hashing and access control as the network requests.
What the server does (the schema, the passwords, the access rules, the plugins) is described in the README of
`@lakutata/ldap-engine`.

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

The directory backend keeps the entries of its suffix in the database of the application (PostgreSQL, MySQL or
SQLite): one table of entries and one row per value, whatever their object classes,
so the schema of the server decides what an entry holds. Add `directoryEntities(type)`, given the type of the
database (MySQL keeps the values in a LONGTEXT column), to the entities of the database; the
migrations are the application's, as for its other entities.

- Searches are run by the database: the filters become SQL on the forms of the values the matching rules compare by
  (equality, substrings, integers and times), and the server checks what SQL cannot decide exactly.
- A sorted search (the sort control, and the window of the virtual list view) is sorted by the backend, which reads only
  the entries of the window: a window by an offset is ordered, counted and cut by the database on a sort key kept with
  each value; otherwise the backend reads the values of the sort keys and orders the entries by them as the server
  would. A sort key follows the ordering rule of its attribute when the value is written: after the schema changes that
  rule, the values written before keep their old keys until they are written again (OpenLDAP likewise rebuilds its
  indexes with slapindex). An entry without a value of a sort key comes after the others, and before them in reverse
  (RFC 2891). With `access.check`, or an interceptor that removes entries from searches, the server sorts
  and windows a virtual list view itself, within `limits.sortCandidates`, so that its counts leave out what the session
  may not read.
- The entries of a search come in a set order: an entry before the entries below it, siblings in the order they were
  added (entryUUID is a UUID of version 7, whose order is the order of creation; an entry imported with its own
  entryUUID takes its place by that value). Entries with equal sort keys keep this order.
- The DN values of member, manager, seeAlso and the like point at their entries: they follow a rename, and go when the
  entry is deleted (a required attribute left empty keeps a placeholder, the empty DN by default).
- memberOf is computed when it is read, and a filter on it finds the members of a group; `nestedGroups` follows nested
  groups. memberUid is computed for the posixGroup entries, for the clients of RFC 2307.
- uidNumber and gidNumber are allocated to the posixAccount and posixGroup entries added without them (from 10000);
  a uidNumber is unique, and so is the gidNumber of a posixGroup among the groups. The POSIX classes come with the
  bundled schema rfc2307bis, which `schema.bundled` names (it is not loaded by default).
- The values of the attributes of `unique` are unique in the suffix; the time of the last simple bind is given as
  authTimestamp (a bind made while a write holds the entry, or on SQLite while any write runs, does not wait for it and
  leaves its time out; on MySQL before 8.0 and MariaDB before 10.6, which cannot skip a row another write holds, the
  bind waits); the failed binds are kept in the database, so the instances of an application share them, as they share
  the state of the password policy (two instances failing a bind in the same millisecond, before either has written,
  can give the failure the same time, which is kept once, so the two count as one); `mailAlias` gives email as mail.
- Each write runs in a transaction, with the interceptors' `beforeCommit()`. The writes to one entry take turns, also
  when several instances share the database (on SQLite, every write to the file takes its turn), so two clients changing
  different values of an attribute at the same time both keep their changes.
- The searches and writes that `beforeCommit()` makes through a server on the same Database component run in the write's
  transaction: they see what it has written so far, and the writes are undone with it if it fails. A search made this
  way reads all of its entries before it returns. While it reads, the write's other operations wait and its locks stay
  held. A large search keeps every entry in memory, and its size limit bounds what it returns, not how much it reads.
  Once its time limit passes, it stops reading and is answered timeLimitExceeded with no entries. On PostgreSQL, if the
  database rejects one of these reads (a statement timeout, for example), the write fails as well, even if the
  interceptor catches the error.
- When the database ends a write to break a deadlock, cannot serialize it, or gives up waiting for a lock (a lock
  timeout set on the database, or on SQLite a file another process holds past the busy timeout), the write is answered
  busy (51) and leaves no changes; the client can send it again.
- Configure a MariaDB server as `mariadb`: as `mysql`, the backend locks exclusively the rows it would otherwise share
  (a parent, the entries that values name), so entries added under one parent, and values naming one entry, are written
  one after another.
- On SQLite, a write that `beforeCommit()` makes through another Database component on the same file is refused
  (unwillingToPerform), because it would wait for the write it is made in. Make such writes through a server on the
  same Database component.
- A DN value written at the same time as the entry it names is pointed at that entry once both writes are committed.
  An error in that step is an `error` event of the server, which the component logs; the write itself is already done.
- The plugins of `@lakutata/ldap-engine` doing what the backend does itself (`MemberOfPlugin`,
  `ReferentialIntegrityPlugin`, `IdAllocationPlugin`, `LastBindPlugin`) leave its chain; the others (`UniquePlugin`,
  `AuditPlugin`, `ConstraintPlugin`…) run for it as for any backend.
- `initialize` creates the entry of the suffix and an administrator on the first start (or imports LDIF), once.

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
| `port` | `389` | The port of LDAP (`0` for a free one, `false` for none) |
| `ldapsPort` | | The port of LDAPS, with `tls` |
| `ldapiPath` | | The path of a Unix socket listened on as well (ldapi), for the clients on the same machine; passwords are taken over it as over TLS |
| `ldapiMode` | from the umask | The permissions of the socket, which decide who may connect (`0o666`: every user of the machine) |
| `tls` | | The certificate and key of StartTLS and LDAPS (`cert`, `key`); for SASL EXTERNAL, `requestCert: true` and the CA of the client certificates in `ca` |
| `interface`, `strict`, `family`, `onError`, `interfaceListening` | | Listen on network interfaces instead of an address |
| `backends` | | The backends: objects, or lakutata classes with their options |
| `plugins` | | The plugins: objects, or lakutata classes with their options (and `name`, `suffixes`) |
| `interceptors` | | The interceptors alone: objects, placements, or lakutata classes with their options |
| `schema` | core, cosine, inetorgperson | `bundled` (the bundled schemas by name; `rfc2307bis`, `openssh-lpk` and `ppolicy` are added by naming them, `[]` leaves the system schema alone), `directory` (a directory of schema files, loaded in the order of their names) and `files` (schemas of one's own: paths, texts, or documents of `readSchemaFile()`/`parseSchemaFile()`) |
| `access` | | `admins`, `passwordAdmins`, `anonymousRead`, `authenticatedRead`, `check` |
| `limits` | | The size, time, message, request and connection limits |
| `bindThrottle` | 5 failures lock the DN | The limits on failed binds |
| `plaintextBind` | `'all'` | Where a password is accepted without TLS: `'all'`, `'loopback'`, `'none'` (the Unix socket takes it whatever this says) |
| `allowUnauthenticatedBind` | `false` | Accept a bind with a name and no password as anonymous |
| `passwords` | `{PBKDF2-SHA512}` | The scheme passwords are written in, and the iterations of PBKDF2 |
| `passwordPolicy` | | The password policy (a `PasswordPolicyPlugin` after the plugins): its default policy (the DN of a pwdPolicy entry, or its rules), `quality`, `revealLocked` |
| `rehashOnBind` | `true` | Hash a password again in the scheme of the server after a bind with a weaker one |
| `sasl` | PLAIN, EXTERNAL | The SASL mechanisms |
| `extendedOperations` | | Extended operations of one's own |
| `vendorName`, `vendorVersion`, `defaultNamingContext`, `rootDSEAttributes` | `lakutata` | What the root DSE says |
| `schemaConfigView` | `false` | Show the schema files read-only as OpenLDAP does (`cn=schema,cn=config`) |

### DirectoryBackend

| Option | Default | What it is |
|---|---|---|
| `suffix` | | The DN of the top entry of the backend |
| `database` | | The name the Database component of the application is registered under (its key in `components`); required |
| `groups` | groupOfNames/member, groupOfUniqueNames/uniqueMember, groupOfMembers/member | The group classes and their member attributes |
| `memberOf` | `true` | Give memberOf; a name and an OID of one's own when the schema defines memberOf itself, or `false` |
| `nestedGroups` | `0` | The levels of nested groups memberOf follows |
| `memberUid` | `true` | Give memberUid to the posixGroup entries |
| `unique` | | The attributes whose values are unique in the suffix |
| `idAllocation` | from 10000 | The first uidNumber and gidNumber allocated, or `false` |
| `lastBind` | `true` | Give authTimestamp, the time of the last successful simple bind |
| `mailAlias` | `false` | Give email, the values of mail |
| `referencePlaceholder` | the empty DN | The value left in a required DN attribute whose last value named a deleted entry |
| `sharedThrottle` | `true` | Keep the failed binds in the database |
| `initialize` | | `root`, `ldif` and `admin`: what the first start creates |

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
| `DirectoryBackend`, `DirectoryBackendOptions`, `directoryEntities(type)` | The directory backend, its options, its entities for a type of database |
| `LDAPEntryRecord`, `LDAPValueRecord`, `LDAPMySQLValueRecord`, `LDAPUniqueRecord`, `LDAPBindStateRecord` | The entities of the directory backend |
| `ObjectSpecification`, `PluginSpecification`, `PluginObjectSpecification`, `InterceptorSpecification`, `InterfaceListeningOptions` | The types of the options |
| Everything `@lakutata/ldap-engine` exports | The protocol, the client, the server engine, the directory helper |
| `@lakutata/ldap/schemas` | The bundled schemas as documents (`CORE`, `RFC2307BIS`…, and `DEFAULTS`), those of `@lakutata/ldap-engine/schemas` |

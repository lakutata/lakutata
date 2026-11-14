# Lakutata LDAP

An application signs its users in against a directory (OpenLDAP, Active Directory, 389 Directory Server…), reads and
writes it, or serves its own directory to other software (SSSD, Keycloak, Gitea, Jenkins, Grafana, NAS devices…). Two
packages provide this:

- [`@lakutata/ldap-engine`](https://github.com/lakutata/lakutata/tree/main/packages/ldap-engine), the engine: the
  protocol, a client, and a server whose backends keep the entries. It needs no application; the
  [LDAP Engine](LDAPEngine.md) guide describes it.
- [`@lakutata/ldap`](https://github.com/lakutata/lakutata/tree/main/packages/ldap), the components: `LDAPClient`,
  `LDAPServer`, and the `DirectoryBackend`, which keeps a server's entries in the application's database. It re-exports
  the engine.

This guide describes the components: registering them, injecting them, and what they add to the engine. What the client
and the server do (paging, schema checks, access rules, the password policy, plugins) is described in the LDAP Engine
guide, to which the sections below refer. The `lakutata` package does not re-export these packages: install the one the
application uses.

```shell
npm install @lakutata/ldap                     # the engine comes with it
npm install @lakutata/netif                    # to listen on network interfaces
```

## 1. Signing users in against a directory

The `LDAPClient` component keeps a pool of connections bound as a service account. A controller or a component obtains
it with `@Inject`; `authenticate()` finds the user's entry and binds as the user on its own connection.

```typescript
import {Application, DTO, Exception} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {POST} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {buildLDAPClientOptions, type LDAPClient} from '@lakutata/ldap'

class SignInDTO extends DTO {
    @Expect(DTO.String().required())
    public username: string

    @Expect(DTO.String().required())
    public password: string
}

class SignInRefusedException extends Exception {
    public errno: string = 'E_SIGN_IN_REFUSED'

    public statusCode: number = 401
}

class SessionController extends Controller {
    @Inject('ldap')
    protected readonly ldap: LDAPClient

    @POST('/sign-in', SignInDTO)
    public async signIn(input: SignInDTO): Promise<{dn: string, name?: string, mustChangePassword: boolean}> {
        const result = await this.ldap.authenticate({
            username: input.username,
            password: input.password,
            base: 'DC=example,DC=com',
            attribute: 'sAMAccountName',
            attributes: ['displayName']
        })
        if (!result.ok) {
            //The reason is for the log: telling a locked account from a wrong password helps an attacker
            console.warn('sign-in refused', input.username, result.reason)
            throw new SignInRefusedException('Wrong user name or password')
        }
        return {dn: result.dn!, name: result.entry?.first('displayName'), mustChangePassword: result.mustChangePassword ?? false}
    }
}

Application.run(() => ({
    id: 'portal.app',
    name: 'Portal',
    components: {
        ldap: buildLDAPClientOptions({
            url: ['ldaps://dc1.example.com', 'ldaps://dc2.example.com'],
            bindDN: 'CN=svc-portal,OU=Service,DC=example,DC=com',
            password: process.env.LDAP_PASSWORD
        }),
        entrypoint: buildEntrypoints({
            controllers: [SessionController],
            http: expressHTTPEntrypoint({port: 8080})
        })
    },
    bootstrap: ['entrypoint']
}))
```

- The connections open on the first operation and close with the application. The servers are listed in `url` or found
  in a DNS SRV record (`srv: '_ldap._tcp.dc._msdcs.example.com'`), and tried in turn until one can be reached (`url` in
  its order, the servers of an SRV record by priority and weight).
- An empty password is refused before anything is sent: many servers treat a bind with a name and no password as an
  anonymous success.
- `reason` states why a bind failed: `invalidCredentials`, `accountLocked`, `accountDisabled`, `passwordExpired`,
  `mustChangePassword`…, read from OpenLDAP's password policy control or Active Directory's data codes.
  `timeBeforeExpiration` and `graceAuthNsRemaining` warn before a password expires.
- `authenticate()` sends the user's password only over TLS (an `ldaps` URL or `startTLS: true`) or a local `ldapi`
  socket, unless `requireTLS: false` is specified.
- `bindName` binds with a name built from the user name (`alice@example.com` for Active Directory) instead of searching
  for the entry first. The rest of `authenticate()` is described in section 4 of LDAP Engine.

| Option | Default | What it is |
|---|---|---|
| `url` | | The LDAP URL of the server, or of several tried in order |
| `srv` | | A DNS SRV record naming the servers, instead of `url` |
| `bindDN`, `password` | anonymous | The pool's identity |
| `tls`, `startTLS` | | TLS options (`ca`, `cert`, `key`…), and StartTLS on each connection to an `ldap://` URL |
| `poolSize` | `4` | The maximum number of connections in the pool |
| `connectTimeout`, `timeout`, `idleTimeout` | 5 s, 30 s, 10 min | A connection, an operation, an idle connection |
| `maxMessageSize`, `binaryAttributes` | 64 MiB | The largest message a server may send; additional attributes whose values are bytes |

## 2. Reading and writing a directory

The component provides the operations of an LDAP connection: `search()`, `searchIterator()`, `compare()`, `add()`,
`modify()`, `delete()`, `modifyDN()`, `extended()`, `passwordModify()`, `whoAmI()`, and `readSchema()`.

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {type Entry, filter, type LDAPClient} from '@lakutata/ldap'

export class Staff extends Component {
    @Inject('ldap')
    protected readonly ldap: LDAPClient

    public async inDepartment(department: string): Promise<string[]> {
        const {entries} = await this.ldap.search('OU=Staff,DC=example,DC=com', {
            filter: filter`(&(objectClass=user)(department=${department}))`,
            attributes: ['sAMAccountName', 'mail']
        })
        return entries.map((entry: Entry) => entry.first('sAMAccountName')!)
    }

    public async rename(uid: string, mail: string): Promise<void> {
        const dn: string = `uid=${uid},ou=people,dc=example,dc=com`
        await this.ldap.modify(dn, [
            {operation: 'replace', attribute: 'mail', values: mail},
            {operation: 'add', attribute: 'telephoneNumber', values: '+86 10 1234 5678'}
        ])
        await this.ldap.passwordModify({userIdentity: dn, newPassword: 'new secret'})
    }
}
```

- The `filter` template tag escapes the values written into it, so a value cannot change the filter.
- Searches are paged (500 entries per page); `searchIterator()` yields the entries one by one; `sort` and `window` read
  a window of the sorted entries.
- A result that is not a success throws its exception (`LDAPNoSuchObjectException`,
  `LDAPInsufficientAccessException`…).
- An operation that takes longer than `timeout` is abandoned on the server. The pool assigns no further operations to
  that connection: it closes once the operations still in progress on it have ended, and subsequent operations use a new
  one.
- `connect()` returns a connection outside the pool, with its own session (to bind as another user, or run StartTLS).
- Entries (text and bytes), filters, DNs, Active Directory values and the other operations are described in sections 2
  to 6 of LDAP Engine.

## 3. Serving a directory

The `LDAPServer` component serves the entries that its backends keep. With the `DirectoryBackend`, they are kept in the
application's database (PostgreSQL, MySQL or SQLite).

```typescript
import {readFileSync} from 'node:fs'
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
            ldapsPort: 636,
            tls: {cert: readFileSync('/etc/directory/server.crt'), key: readFileSync('/etc/directory/server.key')},
            backends: [{
                class: DirectoryBackend,
                database: 'database',
                suffix: 'dc=example,dc=com',
                initialize: {admin: {dn: 'cn=admin,dc=example,dc=com', password: process.env.LDAP_ADMIN_PASSWORD!}}
            }],
            access: {admins: ['cn=admin,dc=example,dc=com']}
        })
    },
    bootstrap: ['database', 'ldap']
}))
```

- `initialize` creates the suffix entry (derived from the suffix: `dcObject` and `organization` for `dc=example,dc=com`)
  and the administrator on the first start, once, however many instances start at the same time.
- The server listens for LDAP on `port` (389; `0` for a free one, `false` for none), with StartTLS when `tls` is
  specified, and LDAPS on `ldapsPort`. `host` selects the address; `interface: 'eth1'` listens on a network interface
  regardless of its addresses, when `@lakutata/netif` is installed. `ldap.ports` lists the ports it listens on.
- `ldapiPath` also listens on a Unix socket (ldapi), for clients on the same machine, which may send passwords over it
  without TLS; `ldapiMode` determines who may connect (`0o666`: every user on the machine; by default, with the usual
  umask, only the user that runs the server's process). With `port: false` and the socket as the only listener, only the
  machine's own clients reach the server.
- The migrations for the directory backend's tables belong to the application, as for its other entities: add
  `directoryEntities(type)` to the database's entities, then generate the migrations.
- The other options are the server engine's (sections 9, 11 and 12 of LDAP Engine): `access`, `limits`, `bindThrottle`,
  `plaintextBind`, `passwords`, `passwordPolicy`, `sasl`, `extendedOperations`, and the contents of the root DSE.

## 4. The directory from the application

The application reads and writes its directory through the component, without going over the network: `connect()`
returns a connection with the client's operations, under an identity you choose, with no bind, and `directory()` manages
users, groups and organizational units on such a connection. What they write goes through the same schema checks,
password hashing and access control as network requests.

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import type {LDAPServer} from '@lakutata/ldap'

export class Accounts extends Component {
    @Inject('ldap')
    protected readonly ldap: LDAPServer

    public async hire(name: string, fullName: string, password: string): Promise<string> {
        const directory = this.ldap.directory('cn=admin,dc=example,dc=com')
        const dn: string = await directory.createUser('ou=people,dc=example,dc=com', {uid: name, cn: fullName, sn: fullName.split(' ').pop()!}, password)
        await directory.addMember('cn=staff,ou=groups,dc=example,dc=com', dn)
        return dn
    }

    public async checkPassword(dn: string, password: string): Promise<boolean> {
        return this.ldap.directory('cn=admin,dc=example,dc=com').verifyPassword(dn, password)
    }

    public async departmentOf(dn: string): Promise<string | undefined> {
        const {entries} = await this.ldap.connect('cn=admin,dc=example,dc=com').search(dn, {scope: 'base', attributes: ['departmentNumber']})
        return entries[0]?.first('departmentNumber')
    }
}
```

The directory helper and its methods are described in section 10 of LDAP Engine. The helper consists of LDAP operations,
so `createDirectory(client)` manages a remote OpenLDAP server the same way, as long as its profile fits that server's
schema. `ldap.engine` is the server engine itself, with its `events` (`bind`, `operation`, `error`…) and its schema.

## 5. The schema

The system schema is always loaded; the component's `schema` option names the others:

```typescript
import {buildLDAPServerOptions, MemoryBackend} from '@lakutata/ldap'

const options = buildLDAPServerOptions({
    backends: [new MemoryBackend('dc=example,dc=com')],
    schema: {
        //The POSIX accounts and groups, and the SSH keys, besides core, cosine and inetorgperson
        bundled: ['core', 'cosine', 'inetorgperson', 'rfc2307bis', 'openssh-lpk'],
        //The .ldif and .schema files of a directory, in the order of their names
        directory: '/etc/directory/schema',
        files: ['/etc/directory/devices.ldif']
    }
})
```

- `bundled` names the bundled schemas: core, cosine and inetorgperson by default; rfc2307bis (POSIX accounts and groups,
  for SSSD and nslcd), openssh-lpk (SSH public keys) and ppolicy are loaded when named, and `[]` loads none of them (the
  system schema is always loaded). The password policy loads ppolicy itself.
- `files` adds custom schemas: paths, documents (from `parseSchemaFile()`, or imported from `@lakutata/ldap/schemas`),
  or a file's text as `{name, text}`. A file is OpenLDAP's `cn=config` LDIF, a subschema entry, or the `.schema` format.
- `directory` loads a directory's files before them, comparing the numbers in their names by value (`cn={2}nis.ldif`
  before `cn={10}ppolicy.ldif`, as OpenLDAP numbers its files).
- If a name or an OID is defined twice, the server fails to start with an error that names both files. When the
  directory also holds some of the standard files, leave those out of `bundled` (or set it to `[]` when it holds all of
  them); with OpenLDAP's nis.schema (RFC 2307), leave out rfc2307bis, which has the same OIDs.
- `schemaConfigView: true` shows the files read-only at `cn={N}<name>,cn=schema,cn=config`, as OpenLDAP does; clients
  read the schema at `cn=Subschema`.
- For schema files as documents, to edit or convert at build time, see section 7 of LDAP Engine.

## 6. Access and passwords

`access`, `plaintextBind`, `bindThrottle` and `limits` are the engine's rules (section 11 of LDAP Engine): by default,
anonymous sessions read only the root DSE and the subschema, bound sessions read the directory except `userPassword`,
administrators write, and password administrators change the passwords of the others. `passwords` and `passwordPolicy`
are described in its section 12:

```typescript
import {buildLDAPServerOptions, DirectoryBackend} from '@lakutata/ldap'

const options = buildLDAPServerOptions({
    backends: [{class: DirectoryBackend, database: 'database', suffix: 'dc=example,dc=com'}],
    access: {
        admins: ['cn=admin,dc=example,dc=com'],
        //The service account of Keycloak resets the passwords
        passwordAdmins: ['cn=keycloak,ou=services,dc=example,dc=com']
    },
    plaintextBind: 'loopback',
    passwordPolicy: {
        default: {lockout: true, maxFailure: 5, lockoutDuration: 900, maxAge: 7776000, expireWarning: 1209600, checkQuality: 2, minLength: 10, inHistory: 5},
        quality: (password: Buffer) => /\d/.test(password.toString()) || 'A password needs a digit'
    }
})
```

- Passwords are written as `{PBKDF2-SHA512}`; a bind also checks OpenLDAP's other schemes and hashes the password again,
  so accounts imported from OpenLDAP keep working.
- With the directory backend, failed binds and the password policy state are kept in the database: an application's
  instances share the locks and the expirations. When two instances fail a bind in the same millisecond, before either
  has written, they can record the failure with the same time; the directory backend keeps it once, so the two count as
  one.

## 7. The directory backend

It keeps a suffix's entries in the application's database, whatever their object classes: a table of entries and one row
per value.

- Searches run in the database: filters become SQL on the forms of values that the matching rules compare by (equality,
  substrings, integers and times); the server checks what SQL cannot decide exactly.
- A sorted search is sorted by the backend, which reads only the entries in the window (`window`): an offset-based
  window is ordered, counted and cut by the database on a sort key kept with each value; otherwise the backend reads the
  values of the sort keys and orders the entries by them as the server would. After the schema changes an attribute's
  ordering rule, its values written before the change keep their old sort keys until they are written again. An entry
  with no value for a sort key comes after the others, and before them in reverse order (RFC 2891). With `access.check`
  (unless `access.checkReads` is false, as for a check that does not decide reads), or an interceptor that removes
  entries from searches, the server sorts and windows a virtual list view itself, within `limits.sortCandidates`, so
  that its counts leave out what the session may not read.
- A search's entries come in a fixed order: an entry before the entries below it, siblings in the order they were added
  (entryUUID is a version 7 UUID; an entry imported with its own entryUUID takes its place by that value). Entries with
  equal sort keys keep this order.
- DN values (member, manager, seeAlso…) point to their entries: they follow a rename, and are removed when the entry is
  deleted; a required attribute left empty keeps a placeholder (the empty DN by default).
- `memberOf` is computed when it is read, and a filter on it finds a group's members (`nestedGroups` follows nested
  groups). With a schema that defines memberOf itself, set `memberOf: {name, oid}` or `memberOf: false`.
- POSIX: uidNumber and gidNumber are allocated to entries added without them (a uidNumber is unique, and so is a
  posixGroup's gidNumber among the groups); memberUid is computed for posixGroup entries. The POSIX classes come with
  rfc2307bis, which `schema.bundled` names.
- `unique` keeps attribute values unique in the suffix; `authTimestamp` holds the time of the last successful bind with
  a password, simple or SASL PLAIN (a bind made while a write holds the entry, or on SQLite while any write runs, does
  not wait for it and omits its time; on MySQL before 8.0 and MariaDB before 10.6, which cannot skip a row another write
  holds, the bind waits); `mailAlias` provides email with the values of mail (Grafana reads email).
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

| Option | Default | What it is |
|---|---|---|
| `suffix` | | The DN of the top entry |
| `database` | | The name of the application's Database component (its key in `components`); required |
| `groups` | groupOfNames, groupOfUniqueNames, groupOfMembers | The group classes and their member attributes |
| `memberOf`, `nestedGroups`, `memberUid` | `true`, `0`, `true` | The virtual attributes |
| `unique` | | The attributes whose values are unique |
| `idAllocation` | from 10000 | The first uidNumber and gidNumber allocated, or `false` |
| `lastBind`, `mailAlias` | `true`, `false` | authTimestamp, email |
| `referencePlaceholder` | the empty DN | The value left in a required DN attribute whose last value named a deleted entry |
| `sharedThrottle` | `true` | Keep failed binds in the database |
| `initialize` | | `root`, `ldif`, `admin`: what the first start creates |

## 8. Plugins, interceptors and backends

The plugins and interceptors are the engine's (section 13 of LDAP Engine: memberOf, referential integrity, unique
values, the password policy, audit, constraints…). The component accepts each as an object, or as a Lakutata class with
its options, built in the component's container:

```typescript
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'
import {AuditPlugin, buildLDAPServerOptions, ConstraintPlugin, DirectoryBackend, type InterceptorPlacement, type LDAPPlugin} from '@lakutata/ldap'

//The department of the people added without one, from the options of the plugin
export class DepartmentPlugin extends Component implements LDAPPlugin {
    @Configurable(DTO.String().required())
    protected readonly department: string

    public readonly name: string = 'department'

    public get interceptors(): InterceptorPlacement[] {
        return [{
            //Before the schema step, which checks the value added too
            before: 'schema',
            interceptor: {name: 'department', operations: ['add'], before: (context, request) => {
                if (request.type !== 'add') return
                const attributes = request.entry.attributes
                const named = (type: string) => attributes.find((attribute) => attribute.type.toLowerCase() === type.toLowerCase())
                const person: boolean = named('objectClass')?.values.some((value) => value.toString().toLowerCase() === 'inetorgperson') ?? false
                if (person && !named('departmentNumber')) attributes.push({type: 'departmentNumber', values: [Buffer.from(this.department)]})
            }}
        }]
    }
}

const options = buildLDAPServerOptions({
    backends: [{class: DirectoryBackend, database: 'database', suffix: 'dc=example,dc=com'}],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    plugins: [
        new ConstraintPlugin({rules: [{attribute: 'mail', pattern: /@example\.com$/}]}),
        new AuditPlugin({write: (record) => console.log(record.operation, record.dn, record.resultCode)}),
        {class: DepartmentPlugin, department: 'R&D'}
    ]
})
```

- A plugin class extends `Component` and implements `LDAPPlugin`: its options are declared with `@Configurable`, and
  it may inject the application's components (a database, a logger).
- The directory backend does the work of `MemberOfPlugin`, `ReferentialIntegrityPlugin`, `IdAllocationPlugin` and
  `LastBindPlugin` itself, in each write's transaction: these plugins are left out of its chain, and the others run for
  it.
- `interceptors` accepts standalone interceptors: objects, placements, or Lakutata classes with their options.
- A custom backend (section 14 of LDAP Engine) is an object, or a Lakutata class with its options,
  `{class: DevicesBackend, suffix: 'ou=devices,dc=example,dc=com'}`, built in the component's container: it may inject
  the application's components, including its database. Several backends serve several suffixes.

## 9. Connecting other software

- **SSSD and nslcd**: the server loads rfc2307bis (and openssh-lpk for the SSH keys), named in `schema.bundled`, and
  they use `ldap_schema = rfc2307bis`; groups are found by `member`, and memberUid is available for the `rfc2307`
  mode. SSSD sends the password policy control with every bind, to which the server responds. On the same machine they
  connect to the Unix socket of `ldapiPath` (SSSD 2.9 and later), and SSSD sends passwords over it without TLS. SSSD
  2.10 and later start TLS by default, which the socket does not need:

  ```ini
  [domain/example]
  id_provider = ldap
  auth_provider = ldap
  ldap_uri = ldapi://%2Frun%2Fdirectory%2Fldapi
  ldap_search_base = dc=example,dc=com
  ldap_default_bind_dn = cn=sssd,dc=example,dc=com
  ldap_default_authtok = …
  ldap_schema = rfc2307bis
  ldap_id_use_start_tls = false
  ```

  `ldapiMode` must allow the user that SSSD runs as to connect. Over the network, configure `tls` on the server, and
  provide SSSD with the CA of the server's certificate (`ldap_tls_cacert`).
- **Keycloak**: user federation with the vendor "Other", `uid` as the user name and RDN, `entryUUID` as the UUID
  attribute, "Use password modify extended operation" on; a group mapper on `groupOfNames` and `member`. Add its service
  account to `access.passwordAdmins` to let it set passwords.
- **Gitea**: an LDAP source (via BindDN) with `(&(objectClass=inetOrgPerson)(uid=%s))` as the user filter; an
  administrator filter on memberOf; the SSH keys in `sshPublicKey` (the server loads openssh-lpk).
- **Grafana**: `mailAlias: true` provides the `email` attribute it reads by default.

## 10. The engine alone

Outside a Lakutata application, `@lakutata/ldap-engine` provides the same client and server as functions:
`createLDAPClient()`, `connectLDAP()` and `createLDAPServer()`. The [LDAP Engine](LDAPEngine.md) guide describes them.

## 11. Platforms

Node.js `>=18.10.0`, Bun, Electron and NW.js. The engine has no native code. The directory backend runs on the databases
of `lakutata/orm`, with what their drivers require in Electron and Bun ([Database Drivers](DatabaseDrivers.md)): in Bun,
where better-sqlite3 does not load, it runs on `sqljs`, PostgreSQL or MySQL.

## Exceptions

The components throw the engine's exceptions (section 17 of LDAP Engine): a result that is not a success throws an
`LDAPResultException` subclass named after its result code (`LDAPInvalidCredentialsException`,
`LDAPNoSuchObjectException`…), a lost connection an `LDAPConnectionException`, an operation that takes too long an
`LDAPTimeoutException`, and if a schema cannot be loaded, the server fails to start with an `LDAPSchemaException`.

# LDAP

An application signs its users in against a directory (OpenLDAP, Active Directory, 389 Directory Server…), reads and
writes it, or serves a directory of its own to other software (SSSD, Keycloak, Gitea, Jenkins, Grafana, NAS devices…).
Two packages do it:

- [`@lakutata/ldap-engine`](https://github.com/lakutata/lakutata/tree/main/packages/ldap-engine), the engine: the
  protocol, a client, and a server whose backends keep the entries. It needs no application; the
  [LDAP Engine](LDAPEngine.md) guide describes it.
- [`@lakutata/ldap`](https://github.com/lakutata/lakutata/tree/main/packages/ldap), the components: `LDAPClient`,
  `LDAPServer`, and the `DirectoryBackend`, which keeps the entries of a server in the application's database. It
  re-exports the engine.

This guide is about the components: registering them, injecting them, and what they add to the engine. What the client
and the server do (paging, the schema checks, the access rules, the password policy, the plugins) is described in the
LDAP Engine guide, which the sections below refer to. The `lakutata` package does not re-export these packages:
install the one the application uses.

```shell
npm install @lakutata/ldap                     # the engine comes with it
npm install @lakutata/netif                    # to listen on network interfaces
```

## 1. Signing users in against a directory

The `LDAPClient` component keeps a pool of connections bound as a service account. A controller or a component gets it
with `@Inject`; `authenticate()` finds the user's entry and binds as the user on a connection of its own.

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

- The connections open on the first operation and close with the application. The servers of `url` are tried in
  order until one can be reached, or found in a DNS SRV record (`srv: '_ldap._tcp.dc._msdcs.example.com'`).
- An empty password is refused before anything is sent: many servers take a bind with a name and no password as an
  anonymous success.
- `reason` says why a bind failed: `invalidCredentials`, `accountLocked`, `accountDisabled`, `passwordExpired`,
  `mustChangePassword`…, read from the password policy control of OpenLDAP or the data codes of Active Directory.
  `timeBeforeExpiration` and `graceAuthNsRemaining` warn before a password expires.
- Passwords are sent only over TLS (an `ldaps` URL or `startTLS: true`) or a local `ldapi` socket, unless
  `requireTLS: false` is given.
- `bindName` binds with a name made from the user name (`alice@example.com` for Active Directory) instead of searching
  for the entry first. The rest of `authenticate()` is in section 4 of LDAP Engine.

| Option | Default | What it is |
|---|---|---|
| `url` | | The LDAP URL of the server, or of several tried in order |
| `srv` | | A DNS SRV record naming the servers, instead of `url` |
| `bindDN`, `password` | anonymous | The identity of the pool |
| `tls`, `startTLS` | | The options of TLS (`ca`, `cert`, `key`…), and StartTLS on each connection of an `ldap://` URL |
| `poolSize` | `4` | The most connections of the pool |
| `connectTimeout`, `timeout`, `idleTimeout` | 5 s, 30 s, 10 min | A connection, an operation, an idle connection |
| `maxMessageSize`, `binaryAttributes` | 64 MiB | The largest message a server may send; more attributes whose values are bytes |

## 2. Reading and writing a directory

The component has the operations of an LDAP connection: `search()`, `searchIterator()`, `compare()`, `add()`,
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

- The template `filter` escapes the values written into it, so a value cannot change the filter.
- Searches are paged (500 entries a page); `searchIterator()` gives the entries one by one; `sort` and `window` read a
  window of the sorted entries.
- A result that is not a success throws its exception (`LDAPNoSuchObjectException`,
  `LDAPInsufficientAccessException`…).
- An operation that takes longer than `timeout` is abandoned on the server. The pool gives that connection no more
  operations: it closes once the operations still on it have ended, and the next operations use a new one.
- `connect()` gives a connection outside the pool, with a session of its own (to bind as another user, or run
  StartTLS).
- The entries (text and bytes), filters, DNs, the values of Active Directory and the other operations are in sections
  2 to 6 of LDAP Engine.

## 3. Serving a directory

The `LDAPServer` component serves the entries of its backends. With the `DirectoryBackend`, they are kept in the
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

- `initialize` creates the entry of the suffix (made from it: `dcObject` and `organization` for `dc=example,dc=com`)
  and the administrator on the first start, once, however many instances start together.
- The server listens for LDAP on `port` (389; `0` for a free one, `false` for none), with StartTLS when `tls` is
  given, and LDAPS on `ldapsPort`. `host` chooses the address; `interface: 'eth1'` listens on a network interface
  whatever its addresses, with `@lakutata/netif` installed. `ldap.ports` gives the ports it listens on.
- `ldapiPath` listens on a Unix socket as well (ldapi), for the clients on the same machine, which may send passwords
  over it without TLS; `ldapiMode` decides who may connect (`0o666`: every user of the machine; by default, with the
  usual umask, the user of the server's process alone). With `port: false` and the socket alone, only the machine's
  own clients reach the server.
- The migrations of the tables of the directory backend are the application's, as for its other entities: add
  `directoryEntities(type)` to the entities of the database, then generate the migrations.
- The other options are those of the server engine (sections 9, 11 and 12 of LDAP Engine): `access`, `limits`,
  `bindThrottle`, `plaintextBind`, `passwords`, `passwordPolicy`, `sasl`, `extendedOperations`, what the root DSE
  says.

## 4. The directory from the application

The application reads and writes its directory through the component, without the network: `connect()` gives a
connection with the operations of the client, under an identity of one's choosing, with no bind, and `directory()`
manages users, groups and organizational units on such a connection. What they write goes through the same schema
checks, password hashing and access control as the requests of the network.

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

The directory helper and its methods are in section 10 of LDAP Engine. It is made of LDAP operations, so
`createDirectory(client)` manages a remote OpenLDAP the same way, as long as its profile fits the schema of that
server. `ldap.engine` is the server engine itself: its `events` (`bind`, `operation`, `error`…) and its schema.

## 5. The schema

The system schema is always loaded; the `schema` option of the component names the others:

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

- `bundled` names the bundled schemas: core, cosine and inetorgperson by default; rfc2307bis (POSIX accounts and
  groups, for SSSD and nslcd), openssh-lpk (SSH public keys) and ppolicy are loaded when named, and `[]` leaves the
  system schema alone. The password policy brings ppolicy itself.
- `files` adds schemas of one's own: paths, documents (of `parseSchemaFile()`, or imported from
  `@lakutata/ldap/schemas`), or the text of a file as `{name, text}`. A file is the LDIF of OpenLDAP's `cn=config`, a
  subschema entry, or the `.schema` form.
- `directory` loads the files of a directory before them, the numbers in their names by value (`cn={2}nis.ldif` before
  `cn={10}ppolicy.ldif`, as OpenLDAP numbers its files).
- A name or an OID defined twice stops the server at its start, naming both files. When the directory holds some of
  the standard files too, leave those out of `bundled` (or set it to `[]` when it holds them all); with the nis.schema
  of OpenLDAP (RFC 2307), leave out rfc2307bis, which has the same OIDs.
- `schemaConfigView: true` shows the files read-only at `cn={N}<name>,cn=schema,cn=config`, as OpenLDAP does; clients
  read the schema at `cn=Subschema`.
- Schema files as documents, to edit or to convert at build time: section 7 of LDAP Engine.

## 6. Access and passwords

`access`, `plaintextBind`, `bindThrottle` and `limits` are the rules of the engine (section 11 of LDAP Engine): by
default anonymous sessions read only the root DSE and the subschema, bound sessions read the directory except
`userPassword`, the administrators write, and the password administrators change the passwords of the others.
`passwords` and `passwordPolicy` are those of its section 12:

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

- Passwords are written as `{PBKDF2-SHA512}`; a bind checks the other schemes of OpenLDAP too and hashes the password
  again, so accounts imported from OpenLDAP keep working.
- With the directory backend, the failed binds and the state of the password policy are in the database: the
  instances of an application share the locks and the expirations.

## 7. The directory backend

It keeps the entries of a suffix in the application's database, whatever their object classes: a table of entries and
one row per value.

- The searches run in the database: the filters become SQL on the forms of the values the matching rules compare by
  (equality, substrings, integers and times); the server checks what SQL cannot decide exactly.
- A sorted search is sorted by the backend, which reads only the entries of the window (`window`): a window by an
  offset is ordered, counted and cut by the database on a sort key kept with each value; otherwise the backend reads
  the values of the sort keys and orders the entries by them as the server would. After the schema changes the
  ordering rule of an attribute, its values written before keep their old sort keys until they are written again.
- The entries of a search come in a set order: an entry before the entries below it, siblings in the order they were
  added (entryUUID is a UUID of version 7; an entry imported with its own entryUUID takes its place by that value).
  Entries with equal sort keys keep this order.
- The DN values (member, manager, seeAlso…) point at their entries: they follow a rename, and go when the entry is
  deleted; a required attribute left empty keeps a placeholder (the empty DN by default).
- `memberOf` is computed when it is read, and a filter on it finds the members of a group (`nestedGroups` follows
  nested groups). A schema that defines memberOf itself takes `memberOf: {name, oid}` or `memberOf: false`.
- POSIX: uidNumber and gidNumber are allocated to the entries added without them (a uidNumber is unique, and so is the
  gidNumber of a posixGroup among the groups); memberUid is computed for the posixGroup entries. The POSIX classes
  come with rfc2307bis, which `schema.bundled` names.
- `unique` keeps the values of attributes unique in the suffix; `authTimestamp` gives the time of the last bind;
  `mailAlias` gives email as mail (Grafana reads email).
- Each write runs in a transaction, with the interceptors' `beforeCommit()`.

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
| `sharedThrottle` | `true` | Keep the failed binds in the database |
| `initialize` | | `root`, `ldif`, `admin`: what the first start creates |

## 8. Plugins, interceptors and backends

The plugins and interceptors are those of the engine (section 13 of LDAP Engine: memberOf, referential integrity,
unique values, the password policy, audit, constraints…). The component takes each as an object, or as a lakutata
class with its options, built in the component's container:

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
  `LastBindPlugin` itself, in the transaction of each write: these plugins leave its chain, and the others run for it.
- `interceptors` takes interceptors alone: objects, placements, or lakutata classes with their options.
- A backend of one's own (section 14 of LDAP Engine) is an object, or a lakutata class with its options,
  `{class: DevicesBackend, suffix: 'ou=devices,dc=example,dc=com'}`, built in the container of the component: it may
  inject the application's components, its database among them. Several backends serve several suffixes.

## 9. Connecting other software

- **SSSD and nslcd**: the server loads rfc2307bis (and openssh-lpk for the SSH keys), named in `schema.bundled`, and
  they use `ldap_schema = rfc2307bis`; the groups are found by `member`, and memberUid is there for the `rfc2307`
  mode. SSSD sends the password policy control with every bind, which the server answers. On the same machine they
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

  `ldapiMode` must let the user SSSD runs as connect. Over the network, give the server `tls`, and SSSD its CA
  (`ldap_tls_cacert`).
- **Keycloak**: user federation with the vendor "Other", `uid` as the user name and RDN, `entryUUID` as the UUID
  attribute, "Use password modify extended operation" on; a group mapper on `groupOfNames` and `member`. Its service
  account goes in `access.passwordAdmins` to set passwords.
- **Gitea**: an LDAP source (via BindDN) with `(&(objectClass=inetOrgPerson)(uid=%s))` as the user filter; an
  administrator filter on memberOf; the SSH keys in `sshPublicKey` (the server loads openssh-lpk).
- **Grafana**: `mailAlias: true` gives the `email` it reads by default.

## 10. The engine alone

Outside a lakutata application, `@lakutata/ldap-engine` gives the same client and server as functions:
`createLDAPClient()`, `connectLDAP()` and `createLDAPServer()`. The [LDAP Engine](LDAPEngine.md) guide describes them.

## 11. Platforms

Node.js `>=18.10.0`, Bun, Electron and NW.js. The engine has no native code. The directory backend runs on the
databases of `lakutata/orm`, with what their drivers need in Electron and Bun ([DatabaseDrivers](DatabaseDrivers.md)):
in Bun, where better-sqlite3 does not load, it runs on `sqljs`, PostgreSQL or MySQL.

## Exceptions

The components throw the exceptions of the engine (section 17 of LDAP Engine): a result that is not a success throws
an `LDAPResultException` subclass named after its result code (`LDAPInvalidCredentialsException`,
`LDAPNoSuchObjectException`…), a lost connection an `LDAPConnectionException`, an operation that takes too long an
`LDAPTimeoutException`, and a schema that cannot be loaded stops the server at its start with an
`LDAPSchemaException`.

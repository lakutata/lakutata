# LDAP

An application signs its users in against a directory (OpenLDAP, Active Directory, 389 Directory Server…), reads and
writes it, or serves a directory of its own to other software (SSSD, Keycloak, Gitea, Jenkins, Grafana, NAS devices…).
Two packages do it:

- [`@lakutata/ldap-engine`](https://github.com/lakutata/lakutata/tree/main/packages/ldap-engine), the engine: the
  protocol (messages, controls, DNs, filters, schemas, LDIF), a client, and a server whose backends store the entries.
  It needs no application, and has no dependencies and no native code.
- [`@lakutata/ldap`](https://github.com/lakutata/lakutata/tree/main/packages/ldap), the components: `LDAPClient`,
  `LDAPServer`, and the `DirectoryBackend`, which keeps the entries of a server in the application's database. It
  re-exports the engine.

The `lakutata` package does not re-export them: install the one the application uses.

```shell
npm install @lakutata/ldap                     # the engine comes with it
npm install @lakutata/netif                    # to listen on network interfaces
```

## 1. Signing users in against a directory

The `LDAPClient` component keeps a pool of connections bound as a service account. `authenticate()` finds the user's
entry and binds as the user on a connection of its own.

```typescript
import {Application} from 'lakutata'
import {buildLDAPClientOptions, type LDAPClient} from '@lakutata/ldap'

Application.run(() => ({
    id: 'portal.app',
    name: 'Portal',
    components: {
        ldap: buildLDAPClientOptions({
            url: ['ldaps://dc1.example.com', 'ldaps://dc2.example.com'],
            bindDN: 'CN=svc-portal,OU=Service,DC=example,DC=com',
            password: process.env.LDAP_PASSWORD
        })
    }
})).onLaunched(async (app) => {
    const ldap: LDAPClient = await app.getObject('ldap')
    const result = await ldap.authenticate({username: 'alice', password: 'secret', base: 'DC=example,DC=com', attribute: 'sAMAccountName'})
    if (result.ok) console.log('signed in as', result.dn, result.entry?.first('displayName'))
    else console.log('refused:', result.reason)
})
```

- An empty password is refused before anything is sent: many servers take a bind with a name and no password as an
  anonymous success.
- `reason` says why a bind failed: `invalidCredentials`, `accountLocked`, `passwordExpired`, `changeAfterReset`…,
  read from the password policy control of OpenLDAP or from the data codes of Active Directory. `timeBeforeExpiration`
  and `graceAuthNsRemaining` warn before a password expires.
- Passwords are sent only over TLS (an `ldaps` URL or `startTLS: true`) or a local `ldapi` socket, unless
  `requireTLS: false` is given.
- `bindName` binds with a name built from the user name (`alice@example.com` for Active Directory) instead of searching
  for the entry first.
- The servers are tried in order, or found in a DNS SRV record (`srv: '_ldap._tcp.dc._msdcs.example.com'`).

## 2. Reading and writing a directory

The component has the operations of an LDAP connection.

```typescript
import {type Entry, filter, type LDAPClient} from '@lakutata/ldap'

async function staff(ldap: LDAPClient, department: string): Promise<string[]> {
    const {entries} = await ldap.search('OU=Staff,DC=example,DC=com', {
        filter: filter`(&(objectClass=user)(department=${department}))`,
        attributes: ['sAMAccountName', 'mail', 'objectGUID']
    })
    return entries.map((entry: Entry) => entry.first('sAMAccountName')!)
}

async function rename(ldap: LDAPClient): Promise<void> {
    await ldap.modify('uid=alice,ou=people,dc=example,dc=com', [
        {operation: 'replace', attribute: 'mail', values: 'alice.liu@example.com'},
        {operation: 'add', attribute: 'telephoneNumber', values: '+86 10 1234 5678'}
    ])
    await ldap.modifyDN('uid=alice,ou=people,dc=example,dc=com', 'uid=alice.liu')
    await ldap.passwordModify({userIdentity: 'uid=alice.liu,ou=people,dc=example,dc=com', newPassword: 'new secret'})
}
```

- The template `filter` escapes the values written into it, so a value cannot change the filter.
- Searches are paged (500 entries a page), so the limit of a server on one request does not cut them short;
  `searchIterator()` gives the entries one by one. `sort` and `window` read a window of the sorted entries.
- `entry.get()` gives the values as text and refuses an attribute whose values are bytes (`jpegPhoto`, `objectGUID`);
  `entry.getBuffers()` gives the bytes. `guidToString()`, `sidToString()` and `parseUserAccountControl()` read the
  values of Active Directory; `changeADPassword()` changes a password there.
- A result that is not a success throws its exception (see [Exceptions](#exceptions)).
- An operation that takes longer than `timeout` (30 seconds by default) is abandoned on the server, and the connection
  goes on.

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
- The server listens for LDAP, with StartTLS when `tls` is given, and LDAPS on `ldapsPort`. `interface: 'eth1'` listens
  on a network interface whatever its addresses, with `@lakutata/netif` installed.
- The migrations of the tables of the directory backend are the application's, as for its other entities: add
  `directoryEntities(type)` to the entities of the database, then generate the migrations.

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
}
```

The directory helper is made of LDAP operations, so it works on any connection: `createDirectory(client)` manages a
remote OpenLDAP the same way, as long as its profile fits the schema of that server. The default profile has
`inetOrgPerson` users named by `uid`, `groupOfNames` groups named by `cn` (the empty DN as a member while a group has
none) and `organizationalUnit` units; a directory with classes of its own gives a profile of its own.

## 5. The schema

The schema decides what an entry may hold: its object classes, the attributes they require and allow, the syntaxes and
the matching rules. The server checks every write against it.

- Bundled: the schemas of the RFCs (core, cosine, inetOrgPerson), rfc2307bis (POSIX accounts and groups), openssh-lpk
  (SSH public keys) and ppolicy (the password policy), all loaded by default; `schema.bundled` loads fewer.
- `schema.files` adds schema files of one's own, by path or text: the LDIF of OpenLDAP's `cn=config`, a subschema
  entry, or the `.schema` form. A name or an OID defined twice stops the server at its start, naming both files.
- The tree is the data's: the schema says what an entry holds, not where it goes.
- Clients read the schema at `cn=Subschema`; `schemaConfigView: true` also shows the files read-only at
  `cn={N}<name>,cn=schema,cn=config`, as OpenLDAP does.

## 6. Who may do what

| Who | May |
|---|---|
| An anonymous session | Read the root DSE and the subschema (`access.anonymousRead: true` lets it read the directory) |
| A bound session | Read the directory except `userPassword`, which nobody reads; change its own password |
| An administrator (`access.admins`) | Write, and change any password |
| A password administrator (`access.passwordAdmins`) | Change the passwords of the others (the service accounts of Keycloak or Nextcloud) |

`access.check` decides first when it is given: true allows, false refuses, undefined leaves it to the table.

- `plaintextBind`: where a password is accepted without TLS: everywhere (by default), from the loopback, or nowhere.
- A bind with a name and an empty password is refused (`allowUnauthenticatedBind` accepts it as anonymous).
- Failed binds of a DN or an address are answered later and later, then refused for a while (`bindThrottle`), all with
  invalidCredentials, which does not tell a locked account from a wrong password.
- The limits: 500 entries and 3600 seconds a search for the sessions that are not administrators, the size of the
  messages, the requests outstanding, the depth and the size of the filters, the idle time (`limits`).

## 7. Passwords and the password policy

The server hashes every password it is given, as `{PBKDF2-SHA512}` (the format of OpenLDAP's pw-pbkdf2 module). A bind
also checks the other schemes of OpenLDAP (`{SSHA}`, the SHA-2 schemes, `{CRYPT}` with MD5, SHA-256, SHA-512 and bcrypt,
`{ARGON2}` where node:crypto runs argon2: Node.js 24.7 and later, but not Electron) and the passwords in clear of an
older directory, then hashes the password again in the scheme of the server. An administrator may write a hashed value
as it is, to import accounts.

`passwordPolicy` applies the password policy of draft-behera, with the attributes OpenLDAP's ppolicy uses:

```typescript
import {buildLDAPServerOptions, MemoryBackend} from '@lakutata/ldap'

const options = buildLDAPServerOptions({
    backends: [new MemoryBackend('dc=example,dc=com')],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    passwordPolicy: {
        //Or the DN of a pwdPolicy entry, which a user's pwdPolicySubentry replaces
        default: {lockout: true, maxFailure: 5, lockoutDuration: 900, maxAge: 7776000, expireWarning: 1209600, graceAuthNLimit: 3, minLength: 10, checkQuality: 2, inHistory: 5, mustChange: true},
        quality: (password: Buffer) => /\d/.test(password.toString()) || 'A password needs a digit'
    }
})
```

- Locking after too many failures, for a while or until an administrator sets a new password; locking the accounts
  unused for too long (`maxIdle`).
- Expiration, its warnings, and the binds allowed after it (grace).
- After an administrator sets a password, the user changes it before doing anything else (`mustChange`).
- The new passwords: who changes them, with the old one (`safeModify`), how soon again (`minAge`), their length,
  their quality, and the former ones (`inHistory`).
- The state is in operational attributes of the entries (pwdChangedTime, pwdAccountLockedTime, pwdFailureTime…), so
  every backend keeps it, and the instances of an application on one database share it.
- The clients sending the password policy control get the warnings and the reasons in the response.

## 8. The directory backend

It keeps the entries of a suffix in the application's database, whatever their object classes: a table of entries and
one row per value.

- The searches run in the database: the filters become SQL on the forms of the values the matching rules compare by
  (equality, substrings, integers and times); the server checks what SQL cannot decide exactly.
- The DN values (member, manager, seeAlso…) point at their entries: they follow a rename, and go when the entry is
  deleted; a required attribute left empty keeps a placeholder (the empty DN by default).
- `memberOf` is computed when it is read, and a filter on it finds the members of a group (`nestedGroups` follows
  nested groups). A schema that defines memberOf itself takes `memberOf: {name, oid}` or `memberOf: false`.
- POSIX: uidNumber and gidNumber are allocated to the entries added without them (a uidNumber is unique, and so is the
  gidNumber of a posixGroup among the groups); memberUid is computed for the posixGroup entries.
- `unique` keeps the values of attributes unique in the suffix; `authTimestamp` gives the time of the last bind;
  `mailAlias` gives email as mail (Grafana reads email).
- Each write runs in a transaction, with the interceptors' `beforeCommit()`.

| Option | Default | What it is |
|---|---|---|
| `suffix` | | The DN of the top entry |
| `database` | `'database'` | The name of the Database component |
| `groups` | groupOfNames, groupOfUniqueNames, groupOfMembers | The group classes and their member attributes |
| `memberOf`, `nestedGroups`, `memberUid` | `true`, `0`, `true` | The virtual attributes |
| `unique` | | The attributes whose values are unique |
| `idAllocation` | from 10000 | The first uidNumber and gidNumber allocated, or `false` |
| `lastBind`, `mailAlias` | `true`, `false` | authTimestamp, email |
| `initialize` | | `root`, `ldif`, `admin`: what the first start creates |

## 9. Plugins

Plugins add to the server what the overlays of OpenLDAP add to slapd: code around the operations, and the schema,
controls and extended operations that code needs. `@lakutata/ldap-engine` has these ready, and `@lakutata/ldap` exports
them too:

| Plugin | What it does |
|---|---|
| `MemberOfPlugin` | Keeps the memberOf of the members of the groups |
| `ReferentialIntegrityPlugin` | Changes the DNs in values when entries are deleted, renamed or moved |
| `UniquePlugin` | Refuses a value another entry has |
| `IdAllocationPlugin` | Gives uidNumber and gidNumber to the POSIX entries added without them |
| `LastBindPlugin` | Keeps the time of the last bind in authTimestamp |
| `SambaPasswordPlugin` | Writes the NT hash of a new password in sambaNTPassword, which the SMB of NAS devices reads (the schema of Samba loaded) |
| `AuditPlugin` | Gives a record of each operation and its outcome to a function of one's own |
| `ConstraintPlugin` | Refuses values breaking rules: a pattern, a size, a count, a check of one's own |
| `GroupPresentationPlugin` | Shows each group as both groupOfNames and groupOfUniqueNames, for the clients knowing only one of them |

```typescript
import {AuditPlugin, buildLDAPServerOptions, ConstraintPlugin, MemberOfPlugin, MemoryBackend} from '@lakutata/ldap'

const options = buildLDAPServerOptions({
    backends: [new MemoryBackend('dc=example,dc=com')],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    plugins: [
        new MemberOfPlugin(),
        new ConstraintPlugin({rules: [{attribute: 'mail', pattern: /@example\.com$/}]}),
        new AuditPlugin({write: (record) => console.log(record.operation, record.dn, record.resultCode)})
    ]
})
```

- The directory backend does the work of `MemberOfPlugin`, `ReferentialIntegrityPlugin`, `IdAllocationPlugin` and
  `LastBindPlugin` itself, in the transaction of each write: these plugins leave its chain, and the others run for it.
- Every plugin takes `name` and `suffixes` among its options: to have it twice, or for some backends only.
- A plugin brings interceptors, and may bring schema files, controls, extended operations, SASL mechanisms and password
  schemes, which the root DSE and the subschema publish. Two plugins claiming the same OID stop the server at its
  start.

Interceptors run code around the operations of a backend: `before()` checks or changes a request, `around()` runs
around the rest, `transformEntry()` changes the entries a search returns, `beforeCommit()` runs in the transaction of a
write. Each is placed before or after one of the server's own steps (`access`, `password`, `schema`, `operational`,
`paging`); placed before `password`, it sees the passwords in clear.

A plugin of one's own is a class. It extends `BaseLDAPPlugin`; or, to use the container of the component (its options
declared with `@Configurable`, components injected), it extends `Component`, implements `LDAPPlugin`, and is listed
with its options:

```typescript
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'
import {buildLDAPServerOptions, type LDAPInterceptor, type LDAPPlugin, MemoryBackend} from '@lakutata/ldap'

export class DepartmentPlugin extends Component implements LDAPPlugin {
    @Configurable(DTO.String().required())
    protected readonly department: string

    public readonly name: string = 'department'

    //The department of the new people who have none
    public get interceptors(): LDAPInterceptor[] {
        return [{name: 'department', operations: ['add'], before: (context, request) => {
            if (request.type === 'add' && !request.entry.attributes.some((attribute) => attribute.type === 'departmentNumber')) {
                request.entry.attributes.push({type: 'departmentNumber', values: [Buffer.from(this.department)]})
            }
        }}]
    }
}

const options = buildLDAPServerOptions({
    backends: [new MemoryBackend('dc=example,dc=com')],
    plugins: [{class: DepartmentPlugin, department: 'R&D'}]
})
```

The `interceptors` option takes interceptors alone, for the plugins that have nothing else.

## 10. Backends of one's own

An application that keeps its users in tables of its own serves them with a backend of its own: `get()` gives an entry
by its DN, `search()` the entries of a search (a superset is fine: the server checks the scope and the filter), and the
writes it supports. `createHandlerBackend()` builds one from handlers written operation by operation:

```typescript
import {createHandlerBackend, type LDAPBackend} from '@lakutata/ldap'

const devices: {name: string, address: string}[] = [{name: 'printer1', address: '10.0.0.5'}]

export const deviceBackend: LDAPBackend = createHandlerBackend({
    suffix: 'ou=devices,dc=example,dc=com',
    search: () => [
        {dn: 'ou=devices,dc=example,dc=com', attributes: {objectClass: 'organizationalUnit', ou: 'devices'}},
        ...devices.map((device) => ({dn: `cn=${device.name},ou=devices,dc=example,dc=com`, attributes: {objectClass: 'device', cn: device.name, description: device.address}}))
    ]
})
```

A backend may be a lakutata class with its options, `{class: MyBackend, suffix: '…'}`, built in the container of the
component. A backend doing the work of a plugin itself declares it in its `capabilities` (`memberOf`,
`referentialIntegrity`, `idAllocation`, `lastBind`), and the plugin leaves its chain.

## 11. Connecting other software

- **SSSD and nslcd**: `ldap_schema = rfc2307bis`; the groups are found by `member`, and memberUid is there for the
  `rfc2307` mode. SSSD sends the password policy control with every bind, which the server answers.
- **Keycloak**: user federation with the vendor "Other", `uid` as the user name and RDN, `entryUUID` as the UUID
  attribute, "Use password modify extended operation" on; a group mapper on `groupOfNames` and `member`.
- **Gitea**: an LDAP source (via BindDN) with `(&(objectClass=inetOrgPerson)(uid=%s))` as the user filter; an
  administrator filter on memberOf; the SSH keys in `sshPublicKey`.
- **Grafana**: `mailAlias: true` gives the `email` it reads by default.

## 12. The engine alone

`@lakutata/ldap-engine` works in any Node.js program, without lakutata: `createLDAPClient()` and `connectLDAP()` for the
client, `createLDAPServer()` for a server with `MemoryBackend` or a backend of one's own, `createDirectory()` on either.
Its README describes it.

## 13. Platforms

Node.js `>=18.10.0`, Bun and Electron. The engine has no native code. The directory backend runs on the databases of
`lakutata/orm`, with what their drivers need in Electron and Bun ([DatabaseDrivers](DatabaseDrivers.md)): in Bun, where
better-sqlite3 does not load, it runs on `sqljs`, PostgreSQL or MySQL.

## Exceptions

| Exception | When |
|---|---|
| `LDAPResultException` and its subclasses (`LDAPNoSuchObjectException`, `LDAPInvalidCredentialsException`, `LDAPInsufficientAccessException`, `LDAPEntryAlreadyExistsException`, `LDAPConstraintViolationException`, `LDAPObjectClassViolationException`…) | A result that is not a success, with its `code`, `matchedDN` and `diagnosticMessage` (and `adDataCode` for Active Directory); a backend or an interceptor throws them to answer with their code |
| `LDAPConnectionException` | A connection that cannot be opened, or that closes while operations wait |
| `LDAPTimeoutException` | An operation longer than its `timeout` |
| `LDAPUsageException` | A call refused before anything is sent (an empty password, the text of an attribute of bytes) |
| `LDAPSchemaException` | A schema that cannot be loaded: a definition that cannot be parsed, a name or an OID defined twice |
| `LDAPDecodeException`, `LDAPFilterSyntaxException`, `LDAPDNSyntaxException`, `LDAPLDIFSyntaxException` | Bytes, filters, DNs or LDIF that cannot be read |

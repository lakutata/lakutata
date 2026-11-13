# Lakutata LDAP Engine

The package `@lakutata/ldap-engine` is LDAP for Node.js, written in TypeScript: a client for directories (OpenLDAP,
Active Directory, 389 Directory Server, FreeIPA…), a server whose backends keep the entries wherever they choose, and
the protocol both are made of. It is not part of `lakutata`, and it needs no application. What it is like:

- **A client** that pages its searches, reads text and bytes apart, refuses an empty password before sending anything,
  and tells why a user could not sign in (a wrong password, a locked account, an expired password…).
- **A server** that does the protocol, TLS, the schema checks, the passwords, the access control and the password
  policy itself: a backend only keeps the entries.
- **Connections in the same process**: a program reads and writes its own server without the network, through the same
  checks as the requests of the network.
- **The pieces on their own**: filters, DNs, schemas, LDIF and the messages of LDAPv3, for a script that imports
  accounts, an editor of schema files, or a proxy.
- **No dependencies and no native code**: Node.js `>=18.10.0`, Bun, Electron and NW.js.

The README of `@lakutata/ldap-engine` lists every export; this guide goes through what the package is for, with an
example of each use. In a lakutata application, `@lakutata/ldap` wraps the client and the server in components (see
[LDAP](LDAP.md)); what they do is described here.

```bash
npm install @lakutata/ldap-engine
```

## 1. Connecting to a server

`connectLDAP()` opens one connection, with a session of its own: what it binds as is its identity until it binds
again.

```typescript
import {connectLDAP, type LDAPClientConnection} from '@lakutata/ldap-engine'

const connection: LDAPClientConnection = await connectLDAP({
    url: 'ldaps://ldap.example.com',
    tls: {ca: process.env.LDAP_CA},
    timeout: 10000
})
try {
    await connection.bind('uid=alice,ou=people,dc=example,dc=com', 'secret')
    console.log(await connection.whoAmI()) //dn:uid=alice,ou=people,dc=example,dc=com
} finally {
    await connection.close()
}
```

- The URL says how to connect: `ldap://` (plain TCP), `ldaps://` (TLS from the start) or `ldapi://` with the path of a
  Unix socket, escaped (`ldapi://%2Frun%2Fdirectory%2Fldapi`). `startTLS: true` upgrades an `ldap://` connection
  before anything else is sent; `connection.startTLS()` does it later. The name checked in the certificate is the host
  of the URL, unless `tls.servername` says otherwise.
- Every operation takes a `timeout` (the connection's, 30 seconds by default) and a `signal`. A search or a write that
  takes longer is abandoned on the server, and the connection goes on. A bind or StartTLS that takes longer closes the
  connection, since the state of its session is no longer known. Connecting takes at most `connectTimeout` (5
  seconds).
- `bind()` with a name and an empty password is refused before it is sent: many servers take it as an anonymous
  success. `saslBind(mechanism, credentials, {step})` binds with SASL, `step` answering each challenge of the server.
- `close()` ends the session; the operations still waiting reject. An idle connection does not keep the process alive.
- A server may send messages of up to `maxMessageSize` bytes (64 MiB): a longer one ends the connection rather than
  filling the memory.

## 2. Searching

```typescript
import {connectLDAP, filter} from '@lakutata/ldap-engine'

const connection = await connectLDAP('ldap://ldap.example.com')
const department: string = 'R&D (Beijing)'
const {entries, truncated} = await connection.search('ou=people,dc=example,dc=com', {
    scope: 'one',
    filter: filter`(&(objectClass=inetOrgPerson)(departmentNumber=${department}))`,
    attributes: ['uid', 'cn', 'mail', 'jpegPhoto'],
    sizeLimit: 1000
})
for (const entry of entries) console.log(entry.dn, entry.first('mail'), entry.getBuffers('jpegPhoto')[0]?.length)
console.log(truncated) //true when there were more than 1000

for await (const group of connection.searchIterator('dc=example,dc=com', {filter: '(objectClass=groupOfNames)', attributes: ['cn', 'member']})) {
    console.log(group.first('cn'), group.get('member').length)
    if (group.first('cn') === 'staff') break
}
await connection.close()
```

- `scope` is `'base'`, `'one'`, `'sub'` (the default) or `'children'`. `filter` is the text of a filter or a `Filter`
  (section 6); the template `filter` escapes the values written into it, so a value cannot change the filter.
- Searches are paged, 500 entries a page (`paged: {pageSize}` changes it, `paged: false` leaves it out), so the limit
  a server puts on one request does not cut them short. A search of one entry (`scope: 'base'`) is not paged, nor one
  whose `sizeLimit` is not above the page size.
- `sizeLimit` bounds what the search keeps: the entries after it are left out, whether the server stops there or goes
  on sending, and `truncated` is true. A limit of the server's own, when the search asked for none, rejects with an
  `LDAPSizeLimitExceededException`, its `partial` entries with it.
- Paging that does not advance (a page without entries that gives back the cookie of the page before, or a hundred
  pages without entries) rejects with an `LDAPProtocolErrorException` rather than paging forever.
- `searchIterator()` gives the entries one by one, a page at a time; leaving the loop early ends the paging on the
  server.
- `sort` and `window` read a window of the sorted entries (the virtual list view): `{sort: [{attribute: 'cn'}],
  window: {offset: 1, limit: 20}}`, with `total` the number of entries in the whole list. Both controls are sent as
  critical, so a server that cannot sort fails the search rather than giving every entry unsorted. A window past the
  last entry returns no entries and still gives `total`.
- The `references` of the result are those the server gives; they are not followed.

An `Entry` gives its values as text or as bytes, never one for the other:

| Method | What it gives |
|---|---|
| `entry.dn` | The DN, as the server wrote it |
| `get(name)`, `first(name)` | The values as text, or the first one; they throw for an attribute whose values are bytes |
| `getBuffers(name)` | The values as bytes |
| `has(name)`, `names()`, `isBinary(name)` | Whether it has an attribute, its attributes, whether one is bytes |
| `toObject()`, `toJSON()` | Its attributes as an object (bytes as `Buffer`), and as JSON (bytes in base64) |

The attributes of bytes are those known to hold bytes (`jpegPhoto`, `userCertificate`, the `objectGUID` and
`objectSid` of Active Directory…), those with the `;binary` option, those named in `binaryAttributes`, and those of a
binary syntax when the connection is given the server's schema (section 7). The names are compared without case, as
the server wrote them: `cn` is not `commonName`, nor `cn;lang-en`.

## 3. Writing

```typescript
import {connectLDAP, LDAPEntryAlreadyExistsException, TreeDeleteControl} from '@lakutata/ldap-engine'

const connection = await connectLDAP('ldaps://ldap.example.com')
await connection.bind('cn=admin,dc=example,dc=com', process.env.LDAP_ADMIN_PASSWORD!)
try {
    await connection.add('uid=bob,ou=people,dc=example,dc=com', {objectClass: 'inetOrgPerson', uid: 'bob', cn: 'Bob Chen', sn: 'Chen', description: 'Contractor'})
} catch (error) {
    if (!(error instanceof LDAPEntryAlreadyExistsException)) throw error
}
await connection.modify('uid=bob,ou=people,dc=example,dc=com', [
    {operation: 'replace', attribute: 'mail', values: 'bob.chen@example.com'},
    {operation: 'add', attribute: 'telephoneNumber', values: ['+86 10 1234 5678', '+86 10 8765 4321']},
    {operation: 'delete', attribute: 'description'}
])
console.log(await connection.compare('uid=bob,ou=people,dc=example,dc=com', 'sn', 'Chen')) //true
await connection.modifyDN('uid=bob,ou=people,dc=example,dc=com', 'uid=bob.chen', {newSuperior: 'ou=staff,dc=example,dc=com'})
const generated: string | undefined = await connection.passwordModify({userIdentity: 'uid=bob.chen,ou=staff,dc=example,dc=com'})
console.log(generated) //the password the server generated
//The whole subtree, with the tree delete control
await connection.delete('ou=former,dc=example,dc=com', {controls: [TreeDeleteControl.encode(undefined, true)]})
await connection.close()
```

- The attributes of `add()` are an object (a value or a list of values for each) or a list of `{type, values}`. A
  value is text (written as UTF-8), bytes, a number or a boolean (written `TRUE` and `FALSE`).
- A change is `add`, `delete` (the values given, or the whole attribute), `replace` or `increment`.
- `passwordModify()` changes a password with the extended operation of RFC 3062: the bound user's unless
  `userIdentity` names another; to `newPassword`, or, without one, to a password the server generates and returns.
- `extended(name, value)` runs another extended operation; every operation takes `controls`, encoded by their codecs
  (`TreeDeleteControl`, `AssertionControl`, `PostReadRequestControl`, `ProxiedAuthorizationControl`…).
- A result that is not a success throws its exception, a subclass of `LDAPResultException` named after the result code
  (`LDAPNoSuchObjectException`, `LDAPInsufficientAccessException`…), with `code`, `matchedDN` and `diagnosticMessage`.

## 4. A pool, and signing users in

`createLDAPClient()` gives a pool of connections bound as one identity, for a service that runs many operations at a
time.

```typescript
import {createLDAPClient, type LDAPPool} from '@lakutata/ldap-engine'

const client: LDAPPool = createLDAPClient({
    url: ['ldaps://ldap1.example.com', 'ldaps://ldap2.example.com'],
    bindDN: 'cn=portal,ou=services,dc=example,dc=com',
    password: process.env.LDAP_PASSWORD,
    poolSize: 8
})

export async function signIn(username: string, password: string): Promise<string | undefined> {
    const result = await client.authenticate({username: username, password: password, base: 'ou=people,dc=example,dc=com'})
    if (result.ok) {
        if (result.timeBeforeExpiration) console.log(`The password expires in ${result.timeBeforeExpiration} seconds`)
        return result.dn
    }
    console.log(result.reason) //invalidCredentials, accountLocked, passwordExpired, mustChangePassword…
    return undefined
}
```

- The pool opens a connection when an operation needs one and all are busy, up to `poolSize` (4), runs each operation
  on the least busy one, and closes the connections idle for `idleTimeout` (10 minutes). A search with its pages runs
  on one connection.
- The servers are tried in order until one can be reached, or found in a DNS SRV record (`srv:
  '_ldap._tcp.example.com'`).
- A connection whose server did not answer in time, or answered what cannot be read, gets no more operations and
  closes once the operations still on it have ended; the next operations open a new one.
- The pool has the operations of a connection; `bind()` changes its identity, `connect()` gives a connection outside
  the pool, `close()` closes them all.
- `authenticate()` finds the user's entry (by `uid`, or the `attribute` or `filter` given), then binds as the user on
  a connection of its own, so the pool's identity never changes. `bindName` binds with a name made from the user name
  instead of searching (``(name) => `${name}@example.com` `` for Active Directory).
- Its result says why a bind failed: `invalidCredentials`, `accountLocked`, `accountDisabled`, `accountExpired`,
  `passwordExpired`, `mustChangePassword`…, read from the password policy control of OpenLDAP or the data codes of
  Active Directory, which tell more than the result code. `timeBeforeExpiration` and `graceAuthNsRemaining` warn
  before a password expires.
- It sends passwords only over TLS (an `ldaps` URL or `startTLS: true`) or a local `ldapi` socket; `requireTLS: false`
  allows the others, for a server on the same machine.

## 5. Active Directory

```typescript
import {changeADPassword, connectLDAP, fileTimeToDate, guidToString, parseUserAccountControl, sidToString} from '@lakutata/ldap-engine'

const connection = await connectLDAP('ldaps://dc1.example.com')
await connection.bind('alice@example.com', 'old secret')
const {entries: [user]} = await connection.search('DC=example,DC=com', {
    filter: '(sAMAccountName=alice)',
    attributes: ['objectGUID', 'objectSid', 'userAccountControl', 'pwdLastSet', 'memberOf']
})
console.log(guidToString(user.getBuffers('objectGUID')[0]), sidToString(user.getBuffers('objectSid')[0]))
console.log(parseUserAccountControl(user.first('userAccountControl')!).accountDisable, fileTimeToDate(user.first('pwdLastSet')!))
console.log(user.get('memberOf').length) //every group, however many: the ranges are read to their end
await changeADPassword(connection, user.dn, 'old secret', 'new secret')
await connection.close()
```

- Active Directory takes a bind with the user principal name (`alice@example.com`) or the DN.
- `guidToString()` and `sidToString()` give the text of an objectGUID (the first fields little-endian, as Active
  Directory shows it) and an objectSid; `stringToGuid()` and `stringToSid()` go back, for a filter on those
  attributes.
- `parseUserAccountControl()` gives the flags of userAccountControl by name (`accountDisable`, `lockout`,
  `dontExpirePassword`…); `fileTimeToDate()` gives the date of a FILETIME (pwdLastSet, lastLogon, accountExpires), and
  `undefined` for "never".
- The values of a large attribute (the member of a large group) come in ranges (`member;range=0-1499`): they are read
  to their end, unless `ranges: false`.
- `changeADPassword()` changes the user's own password, with the old one; `resetADPassword()` sets one as an
  administrator. Active Directory takes them over TLS only (LDAPS or StartTLS), and checks its password policy.

## 6. Filters and DNs

```typescript
import {DN, escapeDNValue, Filter, filter, matchFilter} from '@lakutata/ldap-engine'

const name: string = 'Smith, John (*)'
console.log(Filter.stringify(filter`(cn=${name})`)) //(cn=Smith, John \28\2a\29)
const built: Filter = Filter.and(Filter.equal('objectClass', 'person'), Filter.not(Filter.present('mail')))
console.log(Filter.stringify(built)) //(&(objectClass=person)(!(mail=*)))
const parsed: Filter = Filter.parse('(|(uid=al*)(mail=*@example.com))')
console.log(matchFilter(parsed, {attributes: [{type: 'uid', values: [Buffer.from('alice')]}]})) //true

const dn: DN = DN.parse('CN=Smith\\, John,OU=People,DC=Example,DC=Com')
console.log(dn.rdn()?.get('cn'), dn.parent()?.toString(), dn.isDescendantOf('dc=example,dc=com')) //Smith, John OU=People,DC=Example,DC=Com true
console.log(DN.parse('ou=people,dc=example,dc=com').child(`cn=${escapeDNValue('Smith, John')}`).toString()) //cn=Smith\, John,ou=people,dc=example,dc=com
```

- `Filter` builds filters (`and`, `or`, `not`, `equal`, `greaterOrEqual`, `lessOrEqual`, `approx`, `present`,
  `substrings`, `extensible`), reads their text (RFC 4515) with `parse()` and writes it with `stringify()`. The
  template `filter` builds a filter from its text and the values written into it, each escaped.
- `matchFilter()` evaluates a filter on an entry with the three values of RFC 4511: `true`, `false`, or `undefined`
  when it cannot be decided. With a `Schema`, it compares the values by their matching rules (the case, the spaces,
  the subtypes); without one, the text without case.
- `DN.parse()` reads a DN (RFC 4514); `toString()` writes it back escaped. `equals()`, `isDescendantOf()` and
  `isChildOf()` compare DNs by their normalized form (`CN=Alice` and `commonName=alice` are one name with a schema);
  `rdn()`, `parent()` and `child()` walk the tree. `escapeDNValue()` escapes a value written into a DN.

## 7. Schemas

The schema decides what an entry may hold: its object classes, the attributes they require and allow, the syntaxes
and the matching rules that compare the values.

```typescript
import {connectLDAP, readSchema, type Schema} from '@lakutata/ldap-engine'

const connection = await connectLDAP('ldap://ldap.example.com')
const schema: Schema = await readSchema(connection)
console.log(schema.attributesOf(['inetOrgPerson']).must) //[ 'sn', 'cn', 'objectClass' ]
console.log(schema.isSingleValued('displayName'), schema.isBinary('jpegPhoto'), schema.equality('mail')?.names[0]) //true true caseIgnoreIA5Match
await connection.close()
```

- `readSchema()` reads the schema a server publishes (its subschema entry). Given to `connectLDAP({schema})`, it tells
  the entries which attributes are bytes.
- `new Schema().load()` loads schema files: the LDIF of OpenLDAP's `cn=config`, a subschema entry, or the `.schema`
  form. A name or an OID defined twice throws an `LDAPSchemaException` naming both files; `problems()` lists the names
  the definitions refer to that are not defined, with the file and the line.
- `@lakutata/ldap-engine/schemas` exports the bundled schemas as documents: `SYSTEM` (the operational attributes and
  the object classes of the directory itself), `CORE`, `COSINE` and `INETORGPERSON` (`DEFAULTS`, which nearly every
  server has), `RFC2307BIS` (POSIX accounts and groups), `OPENSSH_LPK` (SSH public keys) and `PPOLICY` (the password
  policy). `bundledSchema(names)` gives a `Schema` of them.

A schema file is also data: `parseSchemaFile()` (or `readSchemaFile(path)`) turns it into a document, its definitions
plain objects with their comments and lines, and `stringifySchemaFile()` writes it back with the definitions that did
not change as they were written. An editor of schema files changes the document; a program that loads its own
schema can convert its files at build time and import the documents.

```typescript
import {readFileSync, writeFileSync} from 'node:fs'
import {parseSchemaFile, Schema, type SchemaDocument, stringifySchemaFile} from '@lakutata/ldap-engine'
import {DEFAULTS, SYSTEM} from '@lakutata/ldap-engine/schemas'

const devices: SchemaDocument = parseSchemaFile(readFileSync('devices.ldif', 'utf8'), 'devices')
const device = devices.objectClasses.find((objectClass) => objectClass.names.includes('device'))!
device.may = [...device.may ?? [], 'description']
writeFileSync('devices.ldif', stringifySchemaFile(devices))

const schema: Schema = new Schema().load(SYSTEM)
for (const document of DEFAULTS) schema.load(document)
schema.load(devices)
for (const problem of schema.problems()) console.log(`${problem.source}:${problem.line} ${problem.message}`)
```

## 8. LDIF

`parseLDIF()` reads LDIF (RFC 2849): entries, and changes to apply. `stringifyLDIF()` writes it, wrapping the long
lines and writing the values that are not plain text in base64.

```typescript
import {type LDIFRecord, parseLDIF, stringifyLDIF} from '@lakutata/ldap-engine'

const records: LDIFRecord[] = parseLDIF(`version: 1

# The new people
dn: uid=carol,ou=people,dc=example,dc=com
changetype: add
objectClass: inetOrgPerson
uid: carol
cn: Carol Wang
sn: Wang

dn: uid=bob,ou=people,dc=example,dc=com
changetype: modify
replace: mail
mail: bob@example.com
-
`)
for (const record of records) console.log(record.changeType, record.dn, record.comments) //add uid=carol,… [ ' The new people' ], then modify uid=bob,… undefined
console.log(stringifyLDIF(records))
```

- A record is an entry (`content`) or a change (`add`, `delete`, `modify`, `modifyDN`), with its line and the comments
  before it, which `stringifyLDIF()` writes back.
- `parseLDIF(text, {readURL})` reads the values given by URL (`jpegPhoto:< file:///photos/carol.jpg`); without it,
  they throw.
- The directory helper (section 10) imports LDIF into a directory and exports a subtree as LDIF.

## 9. A server

`createLDAPServer()` serves the entries of its backends, each mounted at its suffix. The backend keeps the entries;
the server does the rest: the protocol, StartTLS and LDAPS, the schema checks on every write, the passwords, the
access control, the limits, the root DSE and the subschema, and the sorting, virtual list view and paged results a
backend does not do itself.

```typescript
import {readFileSync} from 'node:fs'
import {createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'
import {DEFAULTS, RFC2307BIS} from '@lakutata/ldap-engine/schemas'

const server = createLDAPServer({
    backends: [new MemoryBackend('dc=example,dc=com')],
    schema: [...DEFAULTS, RFC2307BIS],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    tls: {cert: readFileSync('server.crt'), key: readFileSync('server.key')}
})
server.events.on('operation', ({operation, dn, resultCode, duration}) => console.log(operation, dn, resultCode, `${duration} ms`))

console.log(await server.listen({port: 389})) //389, with StartTLS since the server has tls
await server.listen({port: 636, secure: true})
await server.listen({path: '/run/directory/ldapi', mode: 0o666})

process.on('SIGTERM', () => void server.close())
```

- `listen()` listens for LDAP on a port (`0` for a free one, which it returns) and an address (`host`), for LDAPS with
  `secure: true`, or on a Unix socket (ldapi) with `path`. A server may listen several times. `attach(server)` and
  `handleConnection(socket)` serve the connections of a `net.Server` made elsewhere.
- The Unix socket is for the clients on the same machine (SSSD 2.9 and later, nslcd, OpenLDAP's tools): its
  connections never leave the machine, so the server takes passwords over them as over TLS, and offers SASL PLAIN
  there. `mode` decides who may connect (`0o666`: every user of the machine; by default, with the usual umask, the
  user of the server's process alone). A socket left by a server that stopped is replaced. The server does not listen
  on Unix sockets on Windows.
- The schema: the system schema always, then the schemas of `schema` in order, `DEFAULTS` by default. A schema of
  one's own is a document (`readSchemaFile()`, or `readSchemaDirectory()` for the files of a directory in the order of
  their names) or the text of a file. A name or an OID defined twice stops the server at its start.
- `MemoryBackend` keeps its entries in memory, for tests and small servers. A backend of one's own is in section 14;
  the `DirectoryBackend` of `@lakutata/ldap` keeps the entries in the database of an application.
- Sorting follows RFC 2891: an entry without a value of a key comes after the others, and before them in reverse; of
  several values, the least counts (the greatest in reverse). A key whose attribute the schema does not know gives
  noSuchAttribute in the sort response, and a sorted paged search carries the sort response on every page.
- The virtual list view follows draft-ietf-ldapext-ldapv3-vlv-09: the offset is scaled to the server's count; an offset
  below 1 or past the last entry fails the search with virtualListViewError, offsetRangeError being the result of the
  view; and a context ID is refused, since the server gives none.
- An attribute asked for with options (`description;lang-en`) returns the attributes that have those options; `binary`
  is a transfer option and plays no part in the match. An attribute asked for by a range of its values
  (`member;range=0-1`, counted from 0, as in the range retrieval of Active Directory) returns those values under a
  description that carries the range. The end is `*` when the range includes the last value, and a range that starts
  past the last value returns nothing. An attribute is returned at most once: when it is also asked for by name or by
  `*`, it is returned whole and the range is left out. A one-level or subtree search from the empty DN is answered
  noSuchObject; the root DSE is read with a base-scope search.
- The server does not dereference aliases: it reads `derefAliases` and returns alias entries as they are. It accepts
  ManageDsaIT: the built-in backends keep no referral entries, so it changes nothing for them, and a backend of one's
  own that gives referrals finds it in `context.controls`.
- `events`: `connection`, `disconnect`, `bind`, `bindFailure`, `operation` (the operation, its DN, its result code and
  its milliseconds), `startTLS`, `connectionError`, and `error` for an error of a backend or an interceptor that is
  not a result.
- `close()` stops listening, ends the sessions with a Notice of Disconnection, and stops the plugins.

## 10. The program's own connections

`server.connect({as})` gives a connection in the same process, bound as the DN given, with the operations of the
client. It needs no `listen()`, sends nothing over a network, and goes through the same schema checks, password
hashing and access control as the network requests. `createDirectory()` manages users, groups and organizational units
with LDAP operations, on any connection.

```typescript
import {createDirectory, createLDAPServer, type Directory, MemoryBackend} from '@lakutata/ldap-engine'

const server = createLDAPServer({backends: [new MemoryBackend('dc=example,dc=com')], access: {admins: ['cn=admin,dc=example,dc=com']}})
const directory: Directory = createDirectory(server.connect({as: 'cn=admin,dc=example,dc=com'}))

await directory.add('dc=example,dc=com', {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
const people: string = await directory.createOrganizationalUnit('dc=example,dc=com', {ou: 'people'})
const groups: string = await directory.createOrganizationalUnit('dc=example,dc=com', {ou: 'groups'})
const alice: string = await directory.createUser(people, {uid: 'alice', cn: 'Alice Liu', sn: 'Liu', mail: 'alice@example.com'}, 'secret')
const staff: string = await directory.createGroup(groups, {cn: 'staff'})
await directory.addMember(staff, alice)

console.log(await directory.verifyPassword(alice, 'secret')) //true
console.log(await directory.groupsOf('dc=example,dc=com', alice)) //[ 'cn=staff,ou=groups,dc=example,dc=com' ]
console.log(await directory.exportLDIF(people))
```

- The helper has `add()`, `createUser()` (with its password, hashed by the server), `createOrganizationalUnit()`,
  `createGroup()`, `addMember()`, `removeMember()`, `groupsOf()`, `setPassword()`, `verifyPassword()`, `move()`,
  `rename()`, `delete()` (`{subtree: true}` for a subtree), `find()`, `importLDIF()` and `exportLDIF()`.
- Its default profile has `inetOrgPerson` users named by `uid`, `groupOfNames` groups named by `cn` (the empty DN as
  their member while they have none) and `organizationalUnit` units; `createDirectory(connection, {profile})` gives
  another, to manage a directory with classes of its own.
- On the client of section 1 or 4, it manages a remote directory (an OpenLDAP) the same way.
- `server.connect({internal: true})` is the connection of the server's own code (a plugin): its operations go through
  the schema checks, and the access control lets them through.

## 11. Who may do what

| Who | May |
|---|---|
| An anonymous session | Read the root DSE and the subschema (`access.anonymousRead: true` lets it read the directory) |
| A bound session | Read the directory except `userPassword`, which nobody reads; change its own password (`access.authenticatedRead: false` keeps the directory from it) |
| An administrator (`access.admins`) | Write, and change any password. With a password in `access.adminPasswords`, it binds with that password, whether or not it has an entry |
| A password administrator (`access.passwordAdmins`) | Change the passwords of others, but not those of administrators. Meant for service accounts such as those of Keycloak or Nextcloud |

```typescript
import {createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'

const WRITES: string[] = ['add', 'modify', 'delete', 'modifyDN']

const server = createLDAPServer({
    backends: [new MemoryBackend('dc=example,dc=com')],
    access: {
        admins: ['cn=admin,dc=example,dc=com'],
        //The helpdesk writes the entries of the people, and nothing else
        check: (request) => request.identity?.equals('cn=helpdesk,dc=example,dc=com') && WRITES.includes(request.operation)
            ? request.dn.isDescendantOf('ou=people,dc=example,dc=com')
            : undefined
    },
    plaintextBind: 'loopback',
    limits: {sizeLimit: 1000}
})
await server.listen({port: 389})
```

- `access.adminPasswords` gives administrators their passwords by DN, in clear or hashed (`{SCHEME}`), like OpenLDAP's
  rootdn and rootpw but stricter: a simple or SASL PLAIN bind of such an administrator takes only that password, whether
  or not an entry has its DN (OpenLDAP's back-mdb also takes the entry's userPassword when the rootpw does not match).
  The administrator's credentials then stay out of the data it governs. The entry's userPassword and the checks plugins
  make at a bind, such as the password policy, do not apply to it; the bind throttle does. A SASL mechanism that
  establishes an identity without a password (SASL EXTERNAL with a client certificate, or a mechanism of the
  application's that does the same) does not check this password. A Password Modify for such an administrator is refused
  with unwillingToPerform; the password is changed in the options. A write to the entry's userPassword is allowed and
  does not change this password. If a value begins with `{…}` and names a scheme the server does not have, the server
  refuses to start, so a clear password that begins with `{…}` must be given hashed.
- `access.check` decides first: `true` allows, `false` refuses, `undefined` leaves it to the table. It is given the
  operation (`read` for what a search returns or a compare reads), the DN, the session's identity, and the entry or the
  attributes when they are known. For a rename it is asked three times: `modifyDN` about the entry; `modifyDN` about the
  DN the entry would get (`from` holds its current DN), so a check that allows writes only below one entry also refuses
  a move out of that subtree; and `modify` about the attributes whose values the new RDN writes and, with deleteOldRDN,
  those whose values the old RDN removes, as OpenLDAP requires the right to add the first and to delete the second. A
  move that keeps its RDN writes no attribute and is not asked the third time. A compare on an entry the session may not
  read is answered as if the entry did not exist.
- With `access.check`, a search asks `read` for each entry as the backend stores it, before the server adds the
  operational attributes it computes and before any plugin changes the entry. Entries the session may not read are left
  out before the search is paged, windowed or counted, so pages and the virtual list view contain and count only what
  the session may read. The server then sorts a virtual list view itself, within `limits.sortCandidates`. An entry an
  interceptor of one's own adds to a search, or returns as a new object, is checked again once the whole chain has run,
  with whatever the later steps added to it.
- A search of the base alone (scope `base`) that the session may not read is answered as if the base did not exist,
  and a matched DN names only entries the session may read. A search below that base still returns the entries the
  session may read, so its answer shows that the base exists. To hide that an entry exists, refuse `search` on its DN:
  such a search is refused with insufficientAccessRights whether the entry exists or not.
- A bind ends the paged searches on its connection, including a bind that is refused.
- `plaintextBind` says where a password is taken without TLS (a simple bind or a SASL PLAIN bind, a write of
  `userPassword`, a Password Modify): everywhere (`'all'`, by default), from the loopback (`'loopback'`), or nowhere
  (`'none'`). The Unix socket takes passwords whatever it says. A SASL mechanism of one's own whose credentials carry a
  password sets `takesPassword`: where `plaintextBind` refuses passwords, it is not offered.
- A bind with a name and an empty password is refused (`allowUnauthenticatedBind` takes it as anonymous). The failed
  binds of a DN or an address are answered later and later, then refused for a while (`bindThrottle`), all with
  invalidCredentials, which does not tell a locked account from a wrong password.
- The `limits`: for the sessions that are not administrators, 500 entries and 3600 seconds a search, the depth and size
  of its filter; for every session, the size of the messages, the requests outstanding, the connections and the idle
  time. The size limit of a paged search covers all of its pages together: once it is reached, the search ends with
  sizeLimitExceeded if the session could still read more entries. For sessions that are not administrators,
  `pagedSizeLimit` sets a separate limit for paged searches (the same as `sizeLimit` when unset, 0 for none).

## 12. Passwords and the password policy

The server hashes every password it is given, as `{PBKDF2-SHA512}` (the format of OpenLDAP's pw-pbkdf2 module;
`passwords: {iterations}` changes its cost). A bind also checks the other schemes of OpenLDAP (`{SSHA}`, the SHA-2
schemes, `{CRYPT}` with MD5, SHA-256, SHA-512 and bcrypt, `{ARGON2}` where node:crypto runs argon2: Node.js 24.7 and
later, but not Electron) and the passwords in clear of an older directory, then hashes the password again in the scheme
of the server (`rehashOnBind`). An administrator may write a hashed value as it is, to import accounts; with
`rehashOnBind`, a value in another scheme than the server's is replaced at its first successful bind, the only time the
password is known in clear. It is replaced only if the entry still holds that value; if the value is found changed or
removed, nothing is written. A backend with `transaction()` and `lock()`, such as the directory backend of
@lakutata/ldap, locks the entry while the value is checked and replaced; other backends read the value again just before
the write. To keep an imported hash (one an application also checks), turn `rehashOnBind` off; an application may also
register a scheme of its own with `PasswordSchemes.register()` (a native bcrypt, say) and give the server those schemes.
A value written by anyone else is treated as a password in clear, even if it looks hashed. When a modify deletes a
password given in clear (the old password of a change), it is checked against the stored one only on the session's own
entry; to change someone else's password, replace it.

`passwordPolicy` applies the password policy of draft-behera, with the attributes OpenLDAP's ppolicy uses:

```typescript
import {createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'

const server = createLDAPServer({
    backends: [new MemoryBackend('dc=example,dc=com')],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    passwordPolicy: {
        //Or the DN of a pwdPolicy entry; a user's pwdPolicySubentry names another
        default: {lockout: true, maxFailure: 5, lockoutDuration: 900, maxAge: 7776000, expireWarning: 1209600, graceAuthNLimit: 3, minLength: 10, checkQuality: 2, inHistory: 5, mustChange: true},
        quality: (password: Buffer) => /\d/.test(password.toString()) || 'A password needs a digit'
    }
})
await server.listen({port: 389})
```

- Accounts are locked after too many failures, for a while or until an administrator sets a new password; the accounts
  unused for too long are locked too (`maxIdle`).
- A password expires (`maxAge`), with warnings before (`expireWarning`) and binds allowed after (`graceAuthNLimit`).
- After an administrator sets a password, the user changes it before doing anything else (`mustChange`); it may still
  start TLS first, so that the change goes over TLS; the restriction ends once the change has been written, and a new
  bind on the same connection is judged afresh.
- An entry governed by a policy holds one password: a write that would leave it with two is refused.
- The request control of the policy may come with any request (draft-behera §6.1), a search of the root DSE included;
  its response control comes where the policy has something to say.
- New passwords: with the old one (`safeModify`), not too soon again (`minAge`), and not one of the former ones
  (`inHistory`); their length (`minLength`, `maxLength`) and the `quality` check are applied when `checkQuality` is 1
  (a hash an administrator imports passes) or 2 (always), as pwdCheckQuality says.
- The state is in operational attributes of the entries (pwdChangedTime, pwdAccountLockedTime, pwdFailureTime…), so
  every backend keeps it. Each failed bind counts, also when several are made at the same time. Two made in the same
  millisecond on two instances sharing a backend, before either is written, can be given the same time; whether they
  then count once or twice depends on what the backend does with a value it already has. The clients that send the
  password policy control get the warnings and the reasons; a locked account is answered as a wrong password, unless
  `revealLocked` is set.
- The policy is a plugin, the `PasswordPolicyPlugin` the option adds after the others, and it loads the schema ppolicy
  itself.

## 13. Plugins and interceptors

Plugins add to the server what the overlays of OpenLDAP add to slapd: code around the operations, and the schema,
controls and extended operations that code needs.

| Plugin | What it does | Like OpenLDAP's |
|---|---|---|
| `MemberOfPlugin` | Keeps the memberOf of the members of the groups | memberof |
| `ReferentialIntegrityPlugin` | Changes the DNs in values when entries are deleted, renamed or moved | refint |
| `UniquePlugin` | Refuses a value another entry has | unique |
| `PasswordPolicyPlugin` | The password policy of section 12 | ppolicy |
| `IdAllocationPlugin` | Gives uidNumber and gidNumber to the POSIX entries added without them | (DNA of 389 Directory Server) |
| `LastBindPlugin` | Records in authTimestamp the time of the last bind that verified a password | lastbind |
| `SambaPasswordPlugin` | Writes the NT hash of a new password in sambaNTPassword (the schema of Samba loaded) | smbk5pwd |
| `AuditPlugin` | Gives a record of each request and its outcome to a function of one's own | accesslog, auditlog |
| `ConstraintPlugin` | Refuses values breaking rules: a pattern, a size, a count, a check of one's own | constraint |
| `GroupPresentationPlugin` | Shows each group as both groupOfNames and groupOfUniqueNames, for clients knowing one of them | |

A plugin of one's own extends `BaseLDAPPlugin` (or is any object of the `LDAPPlugin` shape). Its interceptors run
around the operations of the backends:

```typescript
import {AuditPlugin, BaseLDAPPlugin, createLDAPServer, type InterceptorPlacement, MemberOfPlugin, MemoryBackend, UniquePlugin} from '@lakutata/ldap-engine'

//The department of the people added without one
class DepartmentPlugin extends BaseLDAPPlugin {
    constructor(protected readonly department: string) {
        super('department')
    }

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

const server = createLDAPServer({
    backends: [new MemoryBackend('dc=example,dc=com')],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    plugins: [
        new MemberOfPlugin(),
        new UniquePlugin({attributes: ['uid', 'mail']}),
        new DepartmentPlugin('R&D'),
        new AuditPlugin({write: (record) => console.log(record.operation, record.dn, record.resultCode)})
    ]
})
await server.listen({port: 389})
```

- An interceptor runs for the `operations` it names: `before()` checks or changes a request, `around()` runs around the
  rest of the chain, `transformEntry()` changes the entries a search returns, and `beforeCommit()` runs in the
  transaction of a write, on a backend that has transactions. Throwing an `LDAPResultException` answers with its code. A
  `bind` interceptor runs around the password check of a simple bind and of a SASL PLAIN bind;
  `request.authentication.type` tells which. The bind succeeds only when the password has been checked and the chain
  answers success. An `around()` may refuse a bind without calling `next()`; to let it through, it must call `next()`
  and return that outcome or a success of its own. If it returns a result other than success instead of throwing, the
  bind fails with that result. If it returns nothing, or a value without a result code, the bind fails with other (80).
  The bind also fails with other (80) if the `around()` answers success when the password has not been checked, because
  it did not call `next()` or caught its rejection. The interceptors around it receive that answer, so LastBindPlugin,
  which is around it by default, keeps no time for the bind. A plugin's `authenticate()` that returns without calling
  `verify()`, or catches its rejection, fails the bind in the same way. To check passwords elsewhere, a backend
  implements `bind()`, which then checks the password of every DN under its suffix in place of the server's check of
  userPassword. These binds do not go through a `bind` interceptor: anonymous and unauthenticated binds, a bind of a DN
  no backend holds, an administrator bound by `access.adminPasswords`, and a SASL mechanism that verifies no password,
  such as EXTERNAL.
- An interceptor is placed before or after one of the server's own steps (`access`, `password`, `schema`, `operational`,
  `paging`) by `{interceptor, before: 'schema'}`, and otherwise at the end of the chain, after them all: what it adds to
  a request there is not checked against the schema. Placed before `password`, it sees the passwords in clear. An
  interceptor that removes entries from searches (a `transformEntry()` returning undefined, or an `around()` that
  replaces the entries) must be placed after `paging`; the end of the chain is. Placed earlier, the pages and the
  virtual list view still count the entries it removes. An interceptor that only changes the entries is best placed
  before `paging`, as `GroupPresentationPlugin` is: the backend can then still sort, window and page by itself. The
  sort and the virtual list view then use the entries as stored, without its changes.
- In the interceptors and the plugins, `context.session` is the session for a bind. For any other operation it is a
  view of the session whose identity stays the one the operation started with, whatever bind comes meanwhile: keep
  data of a session in `session.state`, or key it by `session.id`, not by the session object.
- A plugin may also run around every request (`aroundRequest`, which sees the binds, StartTLS and the extended
  operations the server answers itself), around the check of a password (`authenticate`), and on the password changes
  while they are in clear (`passwordChange`, whose `importing` says whether the values that look hashed are hashes an
  administrator imports). It may bring schema files, controls, extended operations, SASL mechanisms and password
  schemes, which the root DSE and the subschema publish. Two plugins claiming one OID stop the server at its start. The
  root DSE and the subschema go through no backend's chain, so a plugin's control reaches them only when the plugin
  applies it in `aroundRequest`. Such a plugin marks the control `serverEntries: true`; without the mark, a search of
  those entries carrying the control as critical is refused.
- Every plugin takes `name` and `suffixes` among its options: to have it twice, or for some backends only. The plugins
  keep the relations within one backend, as the overlays of OpenLDAP keep them within one database.
- `interceptors` (an option of the server) takes interceptors alone, for what needs nothing else.

## 14. Backends of one's own

A program that keeps its users in tables of its own serves them with a backend of its own. `createHandlerBackend()`
builds one from handlers written operation by operation, as the servers of ldapjs are written:

```typescript
import {createHandlerBackend, createLDAPServer, type LDAPBackend, LDAPNoSuchObjectException} from '@lakutata/ldap-engine'

const devices: Map<string, string> = new Map([['printer1', '10.0.0.5'], ['camera2', '10.0.0.9']])
const SUFFIX: string = 'ou=devices,dc=example,dc=com'

const backend: LDAPBackend = createHandlerBackend({
    suffix: SUFFIX,
    //A superset is enough: the server checks the scope and the filter
    search: () => [
        {dn: SUFFIX, attributes: {objectClass: 'organizationalUnit', ou: 'devices'}},
        ...[...devices].map(([name, address]) => ({dn: `cn=${name},${SUFFIX}`, attributes: {objectClass: 'device', cn: name, description: address}}))
    ],
    delete: (context, dn) => {
        const name: string | undefined = dn.rdn()?.get('cn')
        if (!name || !devices.delete(name)) throw new LDAPNoSuchObjectException(`No device ${dn}`)
    }
})

const server = createLDAPServer({backends: [backend], access: {admins: ['cn=admin,dc=example,dc=com']}})
await server.listen({port: 389})
```

- A backend has `get()` (an entry by its DN), `search()` (the entries of a search, a superset being enough), and the
  writes it supports (`add()`, `modify()`, `delete()`, `modifyDN()`); the server answers the others with
  unwillingToPerform. `exists()` tells whether an entry exists without reading it, when that is cheaper.
- A backend may check the binds itself (`bind()`), bring the schema files of the attributes it computes, interceptors of
  its own, and `transaction()`, in which the interceptors' `beforeCommit()` and the write run together. With `lock()` as
  well, the engine reads the entry of a modify or a rename again in that transaction, after the interceptors'
  `beforeCommit()` and just before the write, once the backend has locked it. It makes the changes and checks them from
  what it reads: a write made meanwhile is not undone, increments are counted, and required attributes checked, on the
  entry as it is.
- With `lock()`, `beforeCommit()` sees the changes made from the entry as read before the transaction. Afterwards, the
  changes no interceptor touched are made again from the request, and those edited in place are made again from their
  edits; a change an interceptor removed stays removed, and one it added (or replaced with a new object) is written as
  it is.
- A backend that sorts, windows or pages itself declares it in its `capabilities`, and `sortSearchItems()` orders its
  own records as the server would. When entries can be left out one by one (`access.check`, or an interceptor after
  `paging` that has a `transformEntry()` or an `around()` for searches), the server does the virtual list view and the
  paging itself. The backend still sorts a sorted search, but the server also sorts for a virtual list view. A backend
  doing the work of a plugin (`memberOf`, `referentialIntegrity`, `idAllocation`, `lastBind`) declares it there too, and
  the plugin leaves its chain. The controls a backend handles go in `capabilities.controls`: a request with one of them
  critical is refused when it reaches a different backend or none at all: an anonymous or unauthenticated bind, a step
  of a SASL exchange that has verified no password so far, or an extended operation. Password Modify is checked against
  the backend of the entry it changes.

## 15. The protocol

The messages of LDAPv3 are there for what the client and the server do not do: a proxy, a recorder, a test of a
server.

```typescript
import {decodeMessage, encodeMessage, filter, type LDAPMessage, MessageReader, PagedResultsControl, type ReadMessage} from '@lakutata/ldap-engine'

const bytes: Buffer = encodeMessage({
    messageId: 2,
    protocolOp: {type: 'searchRequest', baseObject: 'dc=example,dc=com', scope: 'sub', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: filter`(uid=${'alice'})`, attributes: ['cn']},
    controls: [PagedResultsControl.encode({size: 100, cookie: Buffer.alloc(0)})]
})
const message: LDAPMessage = decodeMessage(bytes)
console.log(message.protocolOp.type, PagedResultsControl.decode(message.controls![0]).size) //searchRequest 100

const reader: MessageReader = new MessageReader({maxMessageSize: 4 * 1024 * 1024})
const read: ReadMessage[] = reader.push(Buffer.concat([bytes, bytes.subarray(0, 5)]))
console.log(read.length, reader.bufferedBytes) //1 5
```

- `encodeMessage()` and `decodeMessage()` turn every message of LDAPv3 (RFC 4511) into bytes and back. A decoded
  message keeps its DNs as text and its values as bytes: nothing is parsed beyond the encoding, so a server can answer
  a malformed DN with its result code.
- `MessageReader` reads the messages of a stream from its chunks, with a limit on their size. A message it cannot
  decode but whose message ID it knows comes out as an error, and the stream goes on; anything else throws a fatal
  `LDAPDecodeException`. `malformed` tells a wrong encoding, on which a server ends the session, from a value that is
  not allowed, which it answers with protocolError (RFC 4511 §4.1.1).
- The controls (paged results, sort, virtual list view, tree delete, password policy, read entry, proxied
  authorization, persistent search, content synchronization…) and the values of the extended operations (Password
  Modify, Who Am I, Cancel) have codecs; `Ber` and `BerReader` write and read BER for codecs of one's own.

## 16. In an application

In a lakutata application, `@lakutata/ldap` gives the client as the `LDAPClient` component and the server as the
`LDAPServer` component, with the `DirectoryBackend` keeping the entries in the application's database, and plugins and
backends that are lakutata classes with options. The options of the server are those of this guide; the
[LDAP](LDAP.md) guide describes what the components add.

## 17. Exceptions

| Exception | When |
|---|---|
| `LDAPResultException` and its subclasses (`LDAPNoSuchObjectException`, `LDAPInvalidCredentialsException`, `LDAPInsufficientAccessException`, `LDAPEntryAlreadyExistsException`, `LDAPSizeLimitExceededException`, `LDAPProtocolErrorException`…) | A result that is not a success, with its `code`, `matchedDN` and `diagnosticMessage` (and the `adDataCode` of Active Directory); a backend or an interceptor throws them to answer with their code |
| `LDAPConnectionException` | A connection that cannot be opened, or closed while operations were waiting (its `code` is the system's: `ECONNREFUSED`…) |
| `LDAPTimeoutException` | An operation, a connection or a TLS handshake that took longer than its time |
| `LDAPUsageException` | A call refused before anything is sent: an empty password, the text of an attribute whose values are bytes, StartTLS while operations are outstanding |
| `LDAPDecodeException` | A message that cannot be decoded: `fatal` when the stream cannot go on, otherwise with its `messageId` and `operation` |
| `LDAPFilterSyntaxException`, `LDAPDNSyntaxException`, `LDAPLDIFSyntaxException` | The text of a filter, a DN or LDIF that cannot be read, with the `position` or `line` of the error |
| `LDAPSchemaException` | A schema that cannot be loaded: a definition that cannot be parsed, a name or an OID defined twice |
| `LDAPException` | The base of all of them |

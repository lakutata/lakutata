# @lakutata/ldap-engine

English | [中文](README.zh-CN.md)

LDAP for Node.js in TypeScript, part of the [lakutata](https://github.com/lakutata/lakutata) framework, with no native
code and no dependencies. It holds the protocol (the messages of LDAPv3 and their controls, DNs, search filters, schemas
and LDIF), a client and a server. It needs no application: the components that bring LDAP into a lakutata application
are in `@lakutata/ldap`.

## Installation

```shell
npm install @lakutata/ldap-engine
```

Node.js `>=18.10.0`, Bun, Electron and NW.js.

## Usage

### The client

```typescript
import {createLDAPClient, filter, type LDAPPool} from '@lakutata/ldap-engine'

const client: LDAPPool = createLDAPClient({
    url: ['ldaps://ldap1.example.com', 'ldaps://ldap2.example.com'],
    bindDN: 'cn=reader,dc=example,dc=com',
    password: process.env.LDAP_PASSWORD
})

const name: string = 'alice'
const {entries} = await client.search('ou=people,dc=example,dc=com', {
    filter: filter`(&(objectClass=inetOrgPerson)(uid=${name}))`,
    attributes: ['cn', 'mail', 'jpegPhoto']
})
console.log(entries[0]?.first('mail'), entries[0]?.getBuffers('jpegPhoto')[0])

const result = await client.authenticate({username: 'alice', password: 'secret', base: 'ou=people,dc=example,dc=com'})
console.log(result.ok ? result.dn : result.reason)

await client.close()
```

- `createLDAPClient()` gives a pool of connections bound as one identity. It opens them when an operation needs one,
  tries the servers in order (or those of a DNS SRV record), and closes the idle ones. A connection whose server did
  not answer in time, or answered what cannot be read, gets no more operations and closes once the operations still
  on it have ended.
- `connectLDAP()` opens one connection (`ldap://`, `ldaps://`, `ldapi://`, StartTLS) for a session of its own. Its
  operations take a `timeout` and a `signal`; a search or a write that times out is abandoned on the server and the
  connection goes on. A bind or StartTLS that times out closes the connection.
- Searches are paged (500 entries a page) unless `paged: false`, so a server's own limit on a request does not cut
  them short; `searchIterator()` gives the entries one by one and ends the paging on the server when the loop stops
  early. `sort` with `window` reads a window of the sorted entries (virtual list view); both controls are sent as
  critical, so a server that cannot sort or window fails the search rather than giving every entry. The values Active
  Directory gives in ranges (`member;range=0-1499`) are read to their end.
- An entry reads text with `get()` and bytes with `getBuffers()`; `get()` throws on an attribute whose values are bytes
  (`jpegPhoto`, `objectGUID`…), so bytes are never read as text.
- `authenticate()` finds the user's entry, then binds as the user on a connection of its own: an empty password is
  refused before anything is sent, and the result says why a bind failed (`invalidCredentials`, `accountLocked`,
  `passwordExpired`…), read from the password policy control or the data codes of Active Directory. It sends passwords
  only over TLS (an `ldaps` URL or `startTLS`) or a local `ldapi` socket, unless `requireTLS: false`.
- A result that is not a success throws its exception: `LDAPNoSuchObjectException`, `LDAPInvalidCredentialsException`…
- `readSchema()` reads the schema a server publishes. `guidToString()`, `sidToString()`, `parseUserAccountControl()`,
  `fileTimeToDate()` and `changeADPassword()` help with Active Directory.

### The server

```typescript
import {readFileSync} from 'node:fs'
import {createDirectory, createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'

const server = createLDAPServer({
    backends: [new MemoryBackend('dc=example,dc=com')],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    tls: {cert: readFileSync('server.crt'), key: readFileSync('server.key')}
})

const directory = createDirectory(server.connect({as: 'cn=admin,dc=example,dc=com'}))
await directory.add('dc=example,dc=com', {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
const people = await directory.createOrganizationalUnit('dc=example,dc=com', {ou: 'people'})
await directory.createUser(people, {uid: 'alice', cn: 'Alice Liu', sn: 'Liu', mail: 'alice@example.com'}, 'secret')

await server.listen({port: 389})
await server.listen({port: 636, secure: true})
await server.listen({path: '/run/directory/ldapi', mode: 0o666})
```

- `createLDAPServer()` serves the entries of its backends, each mounted at its suffix. A backend stores the entries
  (`get()`, `search()`, the writes it supports, and `exists()` when it can tell an entry exists without reading it);
  the server does the rest: the protocol, StartTLS and LDAPS, the schema checks on every write, the passwords, the
  access control, the limits, the root DSE and the subschema, and sorting, the virtual list view and paged results
  when the backend does not do them itself (a backend that sorts itself calls `sortSearchItems()` on its own lighter
  records, so it orders and windows as the server would). `MemoryBackend` keeps its entries in memory;
  `createHandlerBackend()` makes a backend from handlers written operation by operation, as ldapjs servers are.
- The schema: the system schema (the operational attributes and the object classes of the directory itself) always,
  then the schemas of the `schema` option in order, `DEFAULTS` of `@lakutata/ldap-engine/schemas` by default: core,
  cosine and inetOrgPerson, the schemas of the RFCs that nearly every server has. The other bundled schemas are added
  when needed (`[...DEFAULTS, RFC2307BIS]`): rfc2307bis for POSIX accounts and groups, openssh-lpk for SSH public
  keys, ppolicy for the password policy (the password policy plugin loads it itself). Schemas of one's own are
  documents read from their files (`readSchemaFile()`, or `readSchemaDirectory()` for a directory, in the order of
  their names) or the texts of the files. A name or an OID defined twice stops the server at its start.
- `server.connect({as})` gives a connection in the same process, with the operations of the client: the application
  reads and writes its directory without the network, through the same schema checks, password hashing and access
  control as the network requests. It works without `listen()`.
- `listen({path})` listens on a Unix socket (ldapi) for the clients on the same machine: SSSD 2.9 and later, nslcd,
  OpenLDAP's tools (`ldapi://%2Frun%2Fdirectory%2Fldapi`). Its connections never leave the machine, so the server takes
  passwords over them as over TLS, and offers SASL PLAIN there. EXTERNAL stays on TLS:
  the server cannot tell which user the process at the other end runs as. `mode` decides who may connect (`0o666`:
  every user of the machine; by default, with the usual umask, the user of the server's process alone). A socket left
  by a server that stopped is replaced. Unix sockets are not served on Windows.
- `createDirectory()` manages users, groups and organizational units with LDAP operations, on any connection: the
  in-process one, the client, or a remote OpenLDAP, as long as its profile fits the schema of the server.
- Passwords are written as `{PBKDF2-SHA512}`, as the pw-pbkdf2 module of OpenLDAP writes them; a bind also checks the
  other schemes of OpenLDAP (`{SSHA}`, the SHA-2 schemes, `{CRYPT}`, and `{ARGON2}` where node:crypto runs argon2:
  Node.js 24.7 and later, but not Electron), then hashes the password again in the scheme of the server. Nobody reads
  `userPassword`.
- By default anonymous sessions read only the root DSE and the subschema, bound sessions read the directory, and the
  administrators of `access.admins` write; `access.check` decides first when given. Failed binds of a DN or an
  address are slowed down, then locked for a while, all answered with invalidCredentials.
-  The password policy of draft-behera-ldap-password-policy (`passwordPolicy`, a plugin), with the attributes OpenLDAP's
  ppolicy uses: a default policy (the DN of a pwdPolicy entry, or its rules) that a user's pwdPolicySubentry replaces;
  accounts locked after too many failures, expiration with its warnings and grace binds, the password to change first
  after a reset, the minimum age, length, quality (with a check of one's own) and history of new passwords. Its state is
  in the operational attributes of the entries (pwdChangedTime, pwdAccountLockedTime…), so every backend keeps it. A
  locked account is answered as a wrong password unless `revealLocked` is set.
- A backend may bring the schema files of the attributes it computes, interceptors of its own, a store shared by the
  instances for the bind throttle (its `update()` changes a state in one step, so that failed binds made at the same
  time each count), `transaction()`, in which the interceptors' `beforeCommit()` and the write run together, and `lock()`,
  with which the engine reads the entry of a modify or a rename again once it is locked in that transaction, just
  before the write, and makes and checks the changes from it, keeping what the interceptors did to them.

### Plugins

A plugin adds what an extension needs to the server, as the overlays of OpenLDAP do. Its interceptors run around the
operations of the backends: before a request, around it, on each entry a search returns, or before a write is committed,
placed before or after the server's own steps (`access`, `password`, `schema`, `operational`, `paging`). It may also run
around every request (`aroundRequest`, which sees the binds, the extended operations and the searches the server answers
itself), around the check of a password (`authenticate`), and on the password changes, while the passwords are in clear
(`passwordChange`). It may bring schema files, controls, extended operations, SASL mechanisms and password schemes,
which the root DSE and the subschema publish. Two plugins claiming one OID, or defining one attribute type or object
class differently, stop the server at its start.

```typescript
import {createLDAPServer, MemberOfPlugin, MemoryBackend, ReferentialIntegrityPlugin, UniquePlugin} from '@lakutata/ldap-engine'

const server = createLDAPServer({
    backends: [new MemoryBackend('dc=example,dc=com')],
    plugins: [new MemberOfPlugin(), new ReferentialIntegrityPlugin(), new UniquePlugin({attributes: ['uid', 'mail']})]
})
```

| Plugin | What it does | Like OpenLDAP's |
|---|---|---|
| `MemberOfPlugin` | Keeps the memberOf of the members of the groups | memberof |
| `ReferentialIntegrityPlugin` | Changes the DNs in values when entries are deleted, renamed or moved | refint |
| `UniquePlugin` | Refuses a value another entry has | unique |
| `PasswordPolicyPlugin` | The password policy, which the `passwordPolicy` option gives too | ppolicy |
| `IdAllocationPlugin` | Gives uidNumber and gidNumber to the POSIX entries added without them | DNA of 389 Directory Server |
| `LastBindPlugin` | Keeps the time of the last bind with a password in authTimestamp | lastbind |
| `SambaPasswordPlugin` | Writes the NT hash of a new password in sambaNTPassword (the schema of Samba loaded) | smbk5pwd |
| `AuditPlugin` | Gives a record of each request and its outcome to a function of one's own | accesslog, auditlog |
| `ConstraintPlugin` | Refuses values breaking rules: a pattern, a size, a count, a check of one's own | constraint |
| `GroupPresentationPlugin` | Shows each group as both groupOfNames and groupOfUniqueNames, as lldap does | |

- A plugin is any object of the `LDAPPlugin` shape; the plugins above extend `BaseLDAPPlugin`, which gives the name
  and the suffixes (`{name, suffixes}`: a plugin twice, or for some backends only). Extend one to change what it
  does.
- `server.start()` runs the plugins' `start()`; `listen()` does it first.
- A plugin reads and writes the directory on `context.server.connect({internal: true})`: its operations go through
  the chain and the schema checks, and the access control lets them through.
- The plugins keep the relations within one backend, as OpenLDAP's overlays keep them within one database: a group and
  its members, an entry and the values naming it, and the values kept unique belong in the same backend.
- The plugins writing after a change (memberOf, the references, the time of the last bind) do it once the change is
  done, as OpenLDAP's overlays do. A backend doing their work itself declares it, and the plugin leaves its chain: the
  directory backend of `@lakutata/ldap` computes memberOf, keeps the references, gives the numbers and keeps the time
  of the last bind in its database, in the transaction of the write.
- `interceptors` takes interceptors alone, for the plugins that are interceptors only.

### The protocol

```typescript
import {decodeMessage, encodeMessage, filter, type LDAPMessage, MessageReader, type ReadMessage} from '@lakutata/ldap-engine'

const name: string = 'alice'
const bytes: Buffer = encodeMessage({
    messageId: 2,
    protocolOp: {
        type: 'searchRequest',
        baseObject: 'dc=example,dc=com',
        scope: 'sub',
        derefAliases: 'never',
        sizeLimit: 0,
        timeLimit: 0,
        typesOnly: false,
        filter: filter`(&(objectClass=person)(uid=${name}))`,
        attributes: ['cn', 'mail']
    }
})

const message: LDAPMessage = decodeMessage(bytes)
console.log(message.protocolOp.type)

const reader: MessageReader = new MessageReader({maxMessageSize: 4 * 1024 * 1024})
const read: ReadMessage[] = reader.push(bytes)
console.log(read.length)
```

- `encodeMessage()` and `decodeMessage()` turn every message of LDAPv3 (RFC 4511) into bytes and back. A decoded message
  keeps its DNs as text and its values as bytes: nothing is parsed or checked beyond the encoding, so a server can answer
  a malformed DN with its result code.
- `MessageReader` reads the messages of a stream from its chunks, with a limit on their size. A message it cannot
  decode but whose message ID it knows comes out as an error, and the stream goes on; anything else throws a fatal
  `LDAPDecodeException`.
- `Filter` builds search filters, parses their text (RFC 4515) and writes it; the template `filter` escapes the values
  written into it, so a value cannot change the filter. `matchFilter()` evaluates a filter on an entry with the three
  values of RFC 4511 (true, false, undefined). An approximate match (`~=`) is an equality, except on a name and optional
  UID (uniqueMember), where it compares the names alone, whatever the UIDs, as OpenLDAP's uniqueMemberMatch does
  approximately.
- The controls (paged results, sort, virtual list view, tree delete, password policy, read entry, proxied
  authorization, persistent search, content synchronization…) and the values of the extended operations (Password
  Modify, Who Am I, Cancel) have codecs; `Ber` and `BerReader` write and read BER, for codecs of one's own.
- `DN` parses DNs (RFC 4514), writes them back escaped, and compares them by their normalized form.
- `Schema` loads schemas: documents, or the texts of schema files (the `cn=config` LDIF of OpenLDAP, a subschema
  entry, or the `.schema` form). It refuses a name or an OID defined twice, lists the names the definitions refer to
  without defining them, with the file and line of each (`problems()`), and gives the matching rules of RFC 4517 that
  compare the values.
- `parseSchemaFile()` turns a schema file into a document: its definitions as plain objects, with their comments and
  lines, which go through JSON as they are. `stringifySchemaFile()` writes it back, the definitions unchanged as they
  were written, which is what an editor of schema files needs. The bundled schemas are documents too (`CORE`… of
  `@lakutata/ldap-engine/schemas`), imported without parsing any text.
- `parseLDIF()` and `stringifyLDIF()` read and write LDIF (RFC 2849), entries and changes, with the comments before
  each record.

```typescript
import {DN, Filter, matchFilter, Schema} from '@lakutata/ldap-engine'

const schema: Schema = new Schema().load([
    'attributetype ( 2.5.4.41 NAME \'name\' EQUALITY caseIgnoreMatch SUBSTR caseIgnoreSubstringsMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )',
    'attributetype ( 2.5.4.3 NAME ( \'cn\' \'commonName\' ) SUP name )'
].join('\n'), 'my.schema')

console.log(DN.parse('CN=Alice, DC=Example').equals('commonName=alice,dc=example', schema))
console.log(matchFilter(Filter.parse('(name=ali*)'), {attributes: [{type: 'cn', values: [Buffer.from('Alice')]}]}, schema))
```

A schema file read, changed and written back, then loaded with the bundled schemas:

```typescript
import {readFileSync, writeFileSync} from 'node:fs'
import {parseSchemaFile, Schema, type SchemaDocument, stringifySchemaFile} from '@lakutata/ldap-engine'
import {CORE, SYSTEM} from '@lakutata/ldap-engine/schemas'

const devices: SchemaDocument = parseSchemaFile(readFileSync('devices.ldif', 'utf8'), 'devices')
const device = devices.objectClasses[0]
device.may = [...device.may ?? [], 'description']
writeFileSync('devices.ldif', stringifySchemaFile(devices))

const schema: Schema = new Schema().load(SYSTEM).load(CORE).load(devices)
for (const problem of schema.problems()) console.log(`${problem.source}:${problem.line} ${problem.message}`)
```

## API

| Export | What it is |
|---|---|
| `createLDAPClient(options)`, `LDAPPool` | A pool of connections bound as one identity, with `authenticate()` |
| `connectLDAP(options)`, `LDAPClientConnection` | One connection |
| `LDAPConnection`, `LDAPOperations`, `SearchOptions`, `SearchResult`, `Change`… | The operations and their options |
| `Entry` | An entry found by a search |
| `readSchema(connection)` | The schema a server publishes |
| `parseLDAPURL(url)` | An LDAP URL (RFC 4516) |
| `guidToString()`, `sidToString()`, `parseUserAccountControl()`, `fileTimeToDate()`, `changeADPassword()`, `resetADPassword()`… | Active Directory |
| `createLDAPServer(options)`, `LDAPServerEngine` | A server: `listen()`, `handleConnection()`, `attach()`, `connect()`, `start()`, `close()`, its `events` |
| `LDAPInProcessConnection` | A connection in the same process |
| `LDAPBackend`, `DirectoryEntry`, `OperationContext`, `SearchContext`… | The interface of the backends |
| `MemoryBackend`, `createHandlerBackend(options)` | Backends ready |
| `sortSearchItems(items, valuesOf, context, schema)`, `sortWindowRange(context, count)`, `sortOrderingOf(attribute, schema)` | The sort and the window of a search, for a backend sorting itself: in memory, or in its database by the range of the window and the rule of each key |
| `LDAPPlugin`, `LDAPPluginHost`, `PluginControl`, `PasswordChange`, `BaseLDAPPlugin` | The plugins |
| `MemberOfPlugin`, `ReferentialIntegrityPlugin`, `UniquePlugin`, `PasswordPolicyPlugin`, `IdAllocationPlugin`, `LastBindPlugin`, `SambaPasswordPlugin`, `AuditPlugin`, `ConstraintPlugin`, `GroupPresentationPlugin` | The plugins ready |
| `LDAPInterceptor`, `InterceptorPlacement`, `ServerRequest`… | The interceptors |
| `AccessOptions`, `ServerLimits`, `BindThrottleOptions` | The access rules, the limits, the bind throttle |
| `PasswordSchemes`, `PasswordScheme` | The password storage schemes |
| `PasswordPolicyOptions`, `PasswordPolicyRules`, `rulesOfEntry(entry, schema)` | The password policy |
| `plainMechanism()`, `externalMechanism()`, `SASLMechanism` | SASL |
| `createDirectory(connection, options)`, `Directory`, `DirectoryProfile` | The directory helper |
| `parseSchemaFile(text, name)`, `stringifySchemaFile(document)`, `SchemaDocument` | A schema file as a document, and back |
| `readSchemaFile(path)`, `readSchemaDirectory(directory)` | The documents of a schema file, and of the files of a directory in the order of their names (the numbers in them by their value) |
| `encodeMessage(message)`, `decodeMessage(bytes)` | A message as bytes, and back |
| `MessageReader` | The reader of the messages of a stream |
| `Filter`, `filter`, `escapeFilterValue(value)`, `matchFilter(filter, entry, schema)` | Filters: building, text, the escaping template, evaluation |
| `PagedResultsControl`, `SortRequestControl`, `VLVRequestControl`, `PasswordPolicyResponseControl`… `findControl()` | The codecs of the controls |
| `ExtendedOperation`, `PasswordModifyRequest`, `PasswordModifyResponse`, `WhoAmIResponse`, `CancelRequest`, `SyncInfo` | The OIDs and the values of the extended operations |
| `Ber`, `BerReader`, `isUTF8(bytes)` | Writing and reading BER, for codecs of one's own; whether bytes are UTF-8 |
| `DN`, `RDN`, `escapeDNValue(value)` | DNs |
| `Schema`, `parseAttributeType()`, `parseObjectClass()`… `parseGeneralizedTime()`, `formatGeneralizedTime()` | Schemas, their definitions, the times |
| `parseLDIF(text)`, `stringifyLDIF(records)` | LDIF, with the comments before each record |
| `ResultCode`, `resultCodeName(code)` | The result codes and their names |
| `LDAPMessage`, `ProtocolOp`, `LDAPRequest`, `LDAPResponse`, `LDAPResult`, `Control`, the types of the operations, the filters, the controls and the records | Their types |
| `LDAPException` and its subclasses | The exceptions of the package (see [Errors](#errors)) |

`@lakutata/ldap-engine/schemas` exports the bundled schemas (`@lakutata/ldap/schemas` too):

| Export | What it is |
|---|---|
| `SYSTEM`, `CORE`, `COSINE`, `INETORGPERSON`, `RFC2307BIS`, `OPENSSH_LPK`, `PPOLICY` | The bundled schemas, as documents |
| `DEFAULTS`, `DEFAULT_NAMES`, `BUNDLED`, `BUNDLED_NAMES`, `bundledSchema(names)` | The schemas a server loads by default (core, cosine, inetorgperson), the bundled ones by name, a `Schema` of them |

## Errors

| Exception | When |
|---|---|
| `LDAPDecodeException` | A message that cannot be decoded; `fatal` when the stream cannot go on, otherwise with its `messageId` and `operation`, and `malformed` when the encoding of the operation is wrong rather than one of its values (a server then ends the session) |
| `LDAPFilterSyntaxException` | The text of a filter that is not one, with the `position` of the error |
| `LDAPDNSyntaxException` | The text of a DN that is not one, with the `position` of the error |
| `LDAPSchemaException` | A schema definition that cannot be parsed, a name or an OID defined twice, a reference to what is not defined |
| `LDAPLDIFSyntaxException` | An LDIF text that cannot be parsed, with the `line` of the error |
| `LDAPResultException` and its subclasses (`LDAPNoSuchObjectException`, `LDAPInvalidCredentialsException`, `LDAPSizeLimitExceededException`…) | A result that is not a success, with its `code`, `matchedDN`, `diagnosticMessage` and the `adDataCode` of Active Directory |
| `LDAPConnectionException` | A connection that cannot be opened, or closed while operations were waiting |
| `LDAPTimeoutException` | An operation that took longer than its `timeout` |
| `LDAPUsageException` | A call the client refuses before sending anything (an empty password, the text of an attribute whose values are bytes…) |
| `LDAPException` | The base of all of them, with its `errno` |

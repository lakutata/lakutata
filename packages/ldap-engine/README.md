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
  tries the servers in order (or those of a DNS SRV record), and closes the idle ones.
- `connectLDAP()` opens one connection (`ldap://`, `ldaps://`, `ldapi://`, StartTLS) for a session of its own. Its
  operations take a `timeout` and a `signal`; a search or a write that times out is abandoned on the server and the
  connection goes on. A bind or StartTLS that times out closes the connection.
- Searches are paged (500 entries a page) unless `paged: false`, so a server's own limit on a request does not cut them
  short; `searchIterator()` gives the entries one by one and ends the paging on the server when the loop stops early.
  `sort` with `window` reads a window of the sorted entries (virtual list view). The values Active Directory gives in
  ranges (`member;range=0-1499`) are read to their end.
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
```

- `createLDAPServer()` serves the entries of its backends, each mounted at its suffix. A backend stores the entries
  (`get()`, `search()`, and the writes it supports); the server does the rest: the protocol, StartTLS and LDAPS, the
  schema checks on every write, the passwords, the access control, the limits, the root DSE and the subschema, and
  sorting, the virtual list view and paged results when the backend does not do them itself. `MemoryBackend` keeps its entries in
  memory; `createHandlerBackend()` makes a backend from handlers written operation by operation, as ldapjs servers are.
- The schema is that of the RFCs (core, cosine, inetOrgPerson) by default; schema files of one's own (the LDIF of
  OpenLDAP's `cn=config`, a subschema entry, the `.schema` form) are added with `schema.files`. A name or an OID
  defined twice stops the server at its start.
- `server.connect({as})` gives a connection in the same process, with the operations of the client: the application
  reads and writes its directory without the network, through the same schema checks, password hashing and access
  control as the network requests. It works without `listen()`.
- `createDirectory()` manages users, groups and organizational units with LDAP operations, on any connection: the
  in-process one, the client, or a remote OpenLDAP, as long as its profile fits the schema of the server.
- Passwords are written as `{PBKDF2-SHA512}`, as the pw-pbkdf2 module of OpenLDAP writes them; a bind also checks the
  other schemes of OpenLDAP (`{SSHA}`, the SHA-2 schemes, `{CRYPT}`, and `{ARGON2}` where Node.js has argon2, 24.7 and
  later), then hashes the password again in the scheme of the server. Nobody reads `userPassword`.
- By default anonymous sessions read only the root DSE and the subschema, bound sessions read the directory, and the
  administrators of `access.admins` write; `access.check` decides first when given. Failed binds of a DN or an
  address are slowed down, then locked for a while, all answered with invalidCredentials.
- Interceptors run code around the operations of a backend, as the overlays of OpenLDAP do: before a request, around
  it, on each entry a search returns, or before a write is committed. They are placed before or after the server's
  own (`access`, `password`, `schema`, `operational`, `paging`).

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
  values of RFC 4511 (true, false, undefined).
- The controls (paged results, sort, virtual list view, tree delete, password policy, read entry, proxied
  authorization, persistent search, content synchronization…) and the values of the extended operations (Password
  Modify, Who Am I, Cancel) have codecs; `Ber` and `BerReader` write and read BER, for codecs of one's own.
- `DN` parses DNs (RFC 4514), writes them back escaped, and compares them by their normalized form.
- `Schema` loads schema files (the `cn=config` LDIF of OpenLDAP, a subschema entry, or the `.schema` form), refuses a
  name or an OID defined twice, and gives the matching rules of RFC 4517 that compare the values.
- `parseLDIF()` and `stringifyLDIF()` read and write LDIF (RFC 2849), entries and changes.

```typescript
import {DN, Filter, matchFilter, Schema} from '@lakutata/ldap-engine'

const schema: Schema = new Schema().load([
    'attributetype ( 2.5.4.41 NAME \'name\' EQUALITY caseIgnoreMatch SUBSTR caseIgnoreSubstringsMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )',
    'attributetype ( 2.5.4.3 NAME ( \'cn\' \'commonName\' ) SUP name )'
].join('\n'), 'my.schema')

console.log(DN.parse('CN=Alice, DC=Example').equals('commonName=alice,dc=example', schema))
console.log(matchFilter(Filter.parse('(name=ali*)'), {attributes: [{type: 'cn', values: [Buffer.from('Alice')]}]}, schema))
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
| `createLDAPServer(options)`, `LDAPServerEngine` | A server: `listen()`, `handleConnection()`, `attach()`, `connect()`, `close()`, its `events` |
| `LDAPInProcessConnection` | A connection in the same process |
| `LDAPBackend`, `DirectoryEntry`, `OperationContext`, `SearchContext`… | The interface of the backends |
| `MemoryBackend`, `createHandlerBackend(options)` | Backends ready |
| `LDAPInterceptor`, `InterceptorPlacement`, `ServerRequest`… | The interceptors |
| `AccessOptions`, `ServerLimits`, `BindThrottleOptions` | The access rules, the limits, the bind throttle |
| `PasswordSchemes`, `PasswordScheme` | The password storage schemes |
| `plainMechanism()`, `externalMechanism()`, `SASLMechanism` | SASL |
| `createDirectory(connection, options)`, `Directory`, `DirectoryProfile` | The directory helper |
| `bundledSchema(names)`, `BUNDLED_SCHEMAS` | The schema of the RFCs, bundled |
| `encodeMessage(message)`, `decodeMessage(bytes)` | A message as bytes, and back |
| `MessageReader` | The reader of the messages of a stream |
| `Filter`, `filter`, `escapeFilterValue(value)`, `matchFilter(filter, entry, schema)` | Filters: building, text, the escaping template, evaluation |
| `PagedResultsControl`, `SortRequestControl`, `VLVRequestControl`, `PasswordPolicyResponseControl`… `findControl()` | The codecs of the controls |
| `ExtendedOperation`, `PasswordModifyRequest`, `PasswordModifyResponse`, `WhoAmIResponse`, `CancelRequest`, `SyncInfo` | The OIDs and the values of the extended operations |
| `Ber`, `BerReader` | Writing and reading BER, for codecs of one's own |
| `DN`, `RDN`, `escapeDNValue(value)` | DNs |
| `Schema`, `parseAttributeType()`, `parseObjectClass()`… `parseGeneralizedTime()`, `formatGeneralizedTime()` | Schemas, their definitions, the times |
| `parseLDIF(text)`, `stringifyLDIF(records)` | LDIF |
| `ResultCode`, `resultCodeName(code)` | The result codes and their names |
| `LDAPMessage`, `ProtocolOp`, `LDAPRequest`, `LDAPResponse`, `LDAPResult`, `Control`, the types of the operations, the filters, the controls and the records | Their types |
| `LDAPException` and its subclasses | The exceptions of the package (see [Errors](#errors)) |

## Errors

| Exception | When |
|---|---|
| `LDAPDecodeException` | A message that cannot be decoded; `fatal` when the stream cannot go on, otherwise with its `messageId` and `operation` |
| `LDAPFilterSyntaxException` | The text of a filter that is not one, with the `position` of the error |
| `LDAPDNSyntaxException` | The text of a DN that is not one, with the `position` of the error |
| `LDAPSchemaException` | A schema definition that cannot be parsed, a name or an OID defined twice, a reference to what is not defined |
| `LDAPLDIFSyntaxException` | An LDIF text that cannot be parsed, with the `line` of the error |
| `LDAPResultException` and its subclasses (`LDAPNoSuchObjectException`, `LDAPInvalidCredentialsException`, `LDAPSizeLimitExceededException`…) | A result that is not a success, with its `code`, `matchedDN`, `diagnosticMessage` and the `adDataCode` of Active Directory |
| `LDAPConnectionException` | A connection that cannot be opened, or closed while operations were waiting |
| `LDAPTimeoutException` | An operation that took longer than its `timeout` |
| `LDAPUsageException` | A call the client refuses before sending anything (an empty password, the text of an attribute whose values are bytes…) |
| `LDAPException` | The base of all of them, with its `errno` |

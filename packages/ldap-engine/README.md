# @lakutata/ldap-engine

English | [中文](README.zh-CN.md)

LDAP for Node.js in TypeScript, part of the [lakutata](https://github.com/lakutata/lakutata) framework, with no native
code and no dependencies. It holds the protocol: the messages of LDAPv3 and their controls, DNs, search filters, schemas
and LDIF. It needs no application: the components that bring LDAP into a lakutata application are in `@lakutata/ldap`.

## Installation

```shell
npm install @lakutata/ldap-engine
```

Node.js `>=18.10.0`, Bun, Electron and NW.js.

## Usage

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
| `LDAPException` | The base of all of them, with its `errno` |

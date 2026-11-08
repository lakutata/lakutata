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
  written into it, so a value cannot change the filter.

## API

| Export | What it is |
|---|---|
| `encodeMessage(message)`, `decodeMessage(bytes)` | A message as bytes, and back |
| `MessageReader` | The reader of the messages of a stream |
| `Filter` | The functions building filters, parsing and writing their text |
| `filter` | The template writing a filter with escaped values |
| `escapeFilterValue(value)` | A value escaped for the text of a filter |
| `ResultCode`, `resultCodeName(code)` | The result codes and their names |
| `LDAPMessage`, `ProtocolOp`, `LDAPRequest`, `LDAPResponse`, `LDAPResult`, `Control`, the types of the operations and of the filters | Their types |
| `LDAPException`, `LDAPDecodeException`, `LDAPFilterSyntaxException` | The exceptions of the package (see [Errors](#errors)) |

## Errors

| Exception | When |
|---|---|
| `LDAPDecodeException` | A message that cannot be decoded; `fatal` when the stream cannot go on, otherwise with its `messageId` and `operation` |
| `LDAPFilterSyntaxException` | The text of a filter that is not one, with the `position` of the error |
| `LDAPException` | The base of all of them, with its `errno` |

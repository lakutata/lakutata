# @lakutata/ldap-engine

[English](README.md) | 中文

Node.js 的 LDAP 库，用 TypeScript 编写，属于 [lakutata](https://github.com/lakutata/lakutata) 框架，没有原生代码，也没有任何依赖。它包含协议本身（LDAPv3 的消息和控制项、DN、搜索过滤器、schema 和 LDIF）和一个客户端。它不需要应用；把 LDAP 接入 lakutata 应用的组件在 `@lakutata/ldap` 里。

## 安装

```shell
npm install @lakutata/ldap-engine
```

支持 Node.js `>=18.10.0`、Bun、Electron 和 NW.js。

## 用法

### 客户端

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

- `createLDAPClient()` 返回一个连接池，池里的连接都以同一个身份绑定。操作需要连接时它才打开连接，按顺序尝试各个服务器（或 DNS SRV 记录给出的服务器），并关闭空闲的连接。
- `connectLDAP()` 打开单独一个连接（`ldap://`、`ldaps://`、`ldapi://`、StartTLS），用于独立的会话。它的操作可以传 `timeout` 和 `signal`；搜索或写操作超时后，客户端会在服务器上放弃（abandon）这个操作，连接继续可用。绑定或 StartTLS 超时则会关闭连接。
- 搜索默认分页（每页 500 条），除非传 `paged: false`，这样服务器对单个请求的条数限制不会把结果截断；`searchIterator()` 逐条给出条目，循环提前结束时会通知服务器结束分页。`sort` 加上 `window` 可以读取排序后条目中的一段（虚拟列表视图）。Active Directory 分段返回的值（`member;range=0-1499`）会一直读到最后。
- 条目用 `get()` 读文本，用 `getBuffers()` 读字节；对值是字节的属性（`jpegPhoto`、`objectGUID` 等）调用 `get()` 会抛出异常，字节不会被转成乱码文本。
- `authenticate()` 先找到用户的条目，再在单独的连接上以该用户身份绑定：空密码在发送任何请求之前就被拒绝；绑定失败时，结果会说明原因（`invalidCredentials`、`accountLocked`、`passwordExpired` 等），原因来自密码策略控制项或 Active Directory 的 data 代码。它只通过 TLS（`ldaps` URL 或 `startTLS`）或本机的 `ldapi` 套接字发送密码，除非设置 `requireTLS: false`。
- 结果不是成功时会抛出对应的异常：`LDAPNoSuchObjectException`、`LDAPInvalidCredentialsException` 等。
- `readSchema()` 读取服务器发布的 schema。`guidToString()`、`sidToString()`、`parseUserAccountControl()`、`fileTimeToDate()` 和 `changeADPassword()` 用于处理 Active Directory 的数据。

### 协议

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

- `encodeMessage()` 和 `decodeMessage()` 把 LDAPv3（RFC 4511）的每种消息编码成字节，或从字节解码回来。解码出的消息里，DN 保持为文本，值保持为字节：除了编码本身，不做任何解析和检查，所以服务器可以对格式错误的 DN 回复相应的结果码。
- `MessageReader` 从数据流的一个个数据块里读出完整的消息，并限制消息的大小。消息解码失败但已经知道它的 message ID 时，会作为错误返回，数据流可以继续；其他情况抛出致命的 `LDAPDecodeException`。
- `Filter` 用来构造搜索过滤器、解析过滤器文本（RFC 4515）并把过滤器写成文本；模板 `filter` 会转义写进去的值，所以值无法改变过滤器的结构。`matchFilter()` 按 RFC 4511 的三值逻辑（真、假、未定义）对一个条目求过滤器的值。
- 控制项（分页、排序、虚拟列表视图、树删除、密码策略、读取条目、代理授权、持久搜索、内容同步等）和扩展操作的值（改密码、Who Am I、Cancel）都有编解码；`Ber` 和 `BerReader` 用来自己读写 BER。
- `DN` 解析 DN（RFC 4514），把它转义后写回，并按规范化后的形式比较。
- `Schema` 加载 schema 文件（OpenLDAP 的 `cn=config` LDIF、subschema 条目，或 `.schema` 格式），拒绝重复定义的名字或 OID，并提供 RFC 4517 中比较属性值的匹配规则。
- `parseLDIF()` 和 `stringifyLDIF()` 读写 LDIF（RFC 2849），包括条目和变更。

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

| 导出 | 说明 |
|---|---|
| `createLDAPClient(options)`、`LDAPPool` | 以同一个身份绑定的连接池，带 `authenticate()` |
| `connectLDAP(options)`、`LDAPClientConnection` | 单个连接 |
| `LDAPConnection`、`LDAPOperations`、`SearchOptions`、`SearchResult`、`Change` 等 | 各种操作和它们的选项 |
| `Entry` | 搜索得到的条目 |
| `readSchema(connection)` | 服务器发布的 schema |
| `parseLDAPURL(url)` | LDAP URL（RFC 4516） |
| `guidToString()`、`sidToString()`、`parseUserAccountControl()`、`fileTimeToDate()`、`changeADPassword()`、`resetADPassword()` 等 | Active Directory |
| `encodeMessage(message)`、`decodeMessage(bytes)` | 把消息编码成字节，或从字节解码 |
| `MessageReader` | 读取数据流里的消息 |
| `Filter`、`filter`、`escapeFilterValue(value)`、`matchFilter(filter, entry, schema)` | 过滤器：构造、文本、转义模板、求值 |
| `PagedResultsControl`、`SortRequestControl`、`VLVRequestControl`、`PasswordPolicyResponseControl` 等，`findControl()` | 控制项的编解码 |
| `ExtendedOperation`、`PasswordModifyRequest`、`PasswordModifyResponse`、`WhoAmIResponse`、`CancelRequest`、`SyncInfo` | 扩展操作的 OID 和值 |
| `Ber`、`BerReader` | 读写 BER，用来自己写编解码 |
| `DN`、`RDN`、`escapeDNValue(value)` | DN |
| `Schema`、`parseAttributeType()`、`parseObjectClass()` 等，`parseGeneralizedTime()`、`formatGeneralizedTime()` | schema、schema 定义、时间 |
| `parseLDIF(text)`、`stringifyLDIF(records)` | LDIF |
| `ResultCode`、`resultCodeName(code)` | 结果码和它们的名字 |
| `LDAPMessage`、`ProtocolOp`、`LDAPRequest`、`LDAPResponse`、`LDAPResult`、`Control`，以及各种操作、过滤器、控制项和记录的类型 | 相关的类型 |
| `LDAPException` 及其子类 | 这个包的异常（见[错误](#错误)） |

## 错误

| 异常 | 什么时候 |
|---|---|
| `LDAPDecodeException` | 消息无法解码；数据流无法继续时 `fatal` 为 true，否则带有它的 `messageId` 和 `operation` |
| `LDAPFilterSyntaxException` | 过滤器文本不合法，`position` 是出错的位置 |
| `LDAPDNSyntaxException` | DN 文本不合法，`position` 是出错的位置 |
| `LDAPSchemaException` | schema 定义无法解析、名字或 OID 重复定义，或引用了没有定义的内容 |
| `LDAPLDIFSyntaxException` | LDIF 文本无法解析，`line` 是出错的行 |
| `LDAPResultException` 及其子类（`LDAPNoSuchObjectException`、`LDAPInvalidCredentialsException`、`LDAPSizeLimitExceededException` 等） | 结果不是成功，带有 `code`、`matchedDN`、`diagnosticMessage`，以及 Active Directory 的 `adDataCode` |
| `LDAPConnectionException` | 连接无法打开，或在还有操作等待时关闭了 |
| `LDAPTimeoutException` | 操作超过了它的 `timeout` |
| `LDAPUsageException` | 客户端在发送任何请求之前就拒绝的调用（空密码、读取值是字节的属性的文本等） |
| `LDAPException` | 以上所有异常的基类，带有 `errno` |

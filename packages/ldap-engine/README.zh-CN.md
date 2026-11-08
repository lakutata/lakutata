# @lakutata/ldap-engine

[English](README.md) | 中文

Node.js 的 LDAP 库，用 TypeScript 编写，属于 [lakutata](https://github.com/lakutata/lakutata) 框架，没有原生代码，也没有任何依赖。它包含协议本身：LDAPv3 的消息和控制项、DN、搜索过滤器、schema 和 LDIF。它不需要应用；把 LDAP 接入 lakutata 应用的组件在 `@lakutata/ldap` 里。

## 安装

```shell
npm install @lakutata/ldap-engine
```

支持 Node.js `>=18.10.0`、Bun、Electron 和 NW.js。

## 用法

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
| `LDAPException` | 以上所有异常的基类，带有 `errno` |

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
- `Filter` 用来构造搜索过滤器、解析过滤器文本（RFC 4515）并把过滤器写成文本；模板 `filter` 会转义写进去的值，所以值无法改变过滤器的结构。

## API

| 导出 | 说明 |
|---|---|
| `encodeMessage(message)`、`decodeMessage(bytes)` | 把消息编码成字节，或从字节解码 |
| `MessageReader` | 读取数据流里的消息 |
| `Filter` | 构造过滤器、解析和写出过滤器文本的函数 |
| `filter` | 写过滤器的模板，写进去的值会被转义 |
| `escapeFilterValue(value)` | 转义后可以写进过滤器文本的值 |
| `ResultCode`、`resultCodeName(code)` | 结果码和它们的名字 |
| `LDAPMessage`、`ProtocolOp`、`LDAPRequest`、`LDAPResponse`、`LDAPResult`、`Control`，以及各种操作和过滤器的类型 | 相关的类型 |
| `LDAPException`、`LDAPDecodeException`、`LDAPFilterSyntaxException` | 这个包的异常（见[错误](#错误)） |

## 错误

| 异常 | 什么时候 |
|---|---|
| `LDAPDecodeException` | 消息无法解码；数据流无法继续时 `fatal` 为 true，否则带有它的 `messageId` 和 `operation` |
| `LDAPFilterSyntaxException` | 过滤器文本不合法，`position` 是出错的位置 |
| `LDAPException` | 以上所有异常的基类，带有 `errno` |

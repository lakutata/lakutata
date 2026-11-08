# @lakutata/ldap

[English](README.md) | 中文

[lakutata](https://www.npmjs.com/package/lakutata) 框架的 LDAP 组件。`LDAPClient` 组件为应用提供一个连接 LDAP 服务器（OpenLDAP、Active Directory、389 Directory Server 等）的连接池：池里的连接都以同一个身份绑定，第一次操作时才打开，随应用一起关闭。协议和客户端来自 [`@lakutata/ldap-engine`](https://www.npmjs.com/package/@lakutata/ldap-engine)，本包会重新导出它的全部内容。

## 安装

```shell
npm install lakutata @lakutata/ldap
```

支持 Node.js `>=18.10.0`、Bun、Electron 和 NW.js。

## 用法

```typescript
import {Application} from 'lakutata'
import {buildLDAPClientOptions, filter, type LDAPClient} from '@lakutata/ldap'

Application.run(() => ({
    id: 'directory.app',
    name: 'Directory',
    components: {
        ldap: buildLDAPClientOptions({
            url: 'ldaps://dc1.example.com',
            bindDN: 'CN=svc-app,OU=Service,DC=example,DC=com',
            password: process.env.LDAP_PASSWORD
        })
    }
})).onLaunched(async (app) => {
    const ldap: LDAPClient = await app.getObject('ldap')
    const name: string = 'alice'
    const {entries} = await ldap.search('DC=example,DC=com', {
        filter: filter`(&(objectClass=user)(sAMAccountName=${name}))`,
        attributes: ['displayName', 'mail', 'memberOf']
    })
    console.log(entries[0]?.get('memberOf'))

    const result = await ldap.authenticate({username: 'alice', password: 'secret', base: 'DC=example,DC=com', attribute: 'sAMAccountName'})
    console.log(result.ok ? result.dn : result.reason)
})
```

组件提供 LDAP 连接的各种操作（`search()`、`searchIterator()`、`compare()`、`add()`、`modify()`、`delete()`、`modifyDN()`、`extended()`、`passwordModify()`、`whoAmI()`），以及在单独的连接上检查用户密码的 `authenticate()`、`readSchema()`，还有用于在连接池之外单独开连接的 `connect()`。搜索默认分页，结果不是成功时会抛出对应的异常；详见 `@lakutata/ldap-engine` 的 README。`authenticate()` 只通过 TLS（`ldaps` URL 或 `startTLS: true`）或本机的 `ldapi` 套接字发送密码，除非传入 `requireTLS: false`。

## 选项

| 选项 | 默认值 | 说明 |
|---|---|---|
| `url` | | 服务器的 LDAP URL，或按顺序尝试的多个 URL |
| `srv` | | 给出服务器的 DNS SRV 记录，代替 `url` |
| `bindDN`、`password` | 匿名 | 连接池的身份 |
| `tls` | | TLS 选项（`ca`、`cert`、`key`、`rejectUnauthorized` 等） |
| `startTLS` | `false` | 对 `ldap://` URL 的每个连接执行 StartTLS |
| `poolSize` | `4` | 连接池最多的连接数 |
| `connectTimeout` | `5000` | 建立连接最多可用的毫秒数 |
| `timeout` | `30000` | 操作最多可用的毫秒数，超过后放弃该操作（`0` 表示不限） |
| `idleTimeout` | `600000` | 连接空闲这么多毫秒后关闭 |
| `maxMessageSize` | 64 MiB | 服务器可发送的消息大小上限 |
| `binaryAttributes` | | 值为字节的其他属性 |

## API

| 导出 | 说明 |
|---|---|
| `LDAPClient` | 组件 |
| `buildLDAPClientOptions(options)` | 组件的选项，用于应用的 `components` |
| `LDAPClientOptions` | 选项的类型 |
| `@lakutata/ldap-engine` 导出的全部内容 | 协议和客户端 |

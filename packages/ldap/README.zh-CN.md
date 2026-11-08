# @lakutata/ldap

[English](README.md) | 中文

[lakutata](https://www.npmjs.com/package/lakutata) 框架的 LDAP 组件。`LDAPServer` 组件让应用提供一个目录服务：条目放在它的后端里（`DirectoryBackend` 把条目存进应用的数据库），应用不经过网络就能读写这些条目。`LDAPClient` 组件为应用提供一个连接 LDAP 服务器（OpenLDAP、Active Directory、389 Directory Server 等）的连接池。两个组件都建在 [`@lakutata/ldap-engine`](https://www.npmjs.com/package/@lakutata/ldap-engine) 之上，本包会重新导出它的全部内容。

## 安装

```shell
npm install lakutata @lakutata/ldap
```

支持 Node.js `>=18.10.0`、Bun、Electron 和 NW.js。要按网卡监听，还需要安装 `@lakutata/netif`。

## 用法

### 服务器

```typescript
import {readFileSync} from 'node:fs'
import {Application} from 'lakutata'
import {buildLDAPServerOptions, type LDAPServer, MemoryBackend} from '@lakutata/ldap'

Application.run(() => ({
    id: 'directory.app',
    name: 'Directory',
    components: {
        ldap: buildLDAPServerOptions({
            port: 389,
            ldapsPort: 636,
            tls: {cert: readFileSync('server.crt'), key: readFileSync('server.key')},
            backends: [new MemoryBackend('dc=example,dc=com')],
            access: {admins: ['cn=admin,dc=example,dc=com']}
        })
    },
    bootstrap: ['ldap']
})).onLaunched(async (app) => {
    const ldap: LDAPServer = await app.getObject('ldap')
    const directory = ldap.directory('cn=admin,dc=example,dc=com')
    await directory.add('dc=example,dc=com', {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
    const people = await directory.createOrganizationalUnit('dc=example,dc=com', {ou: 'people'})
    await directory.createUser(people, {uid: 'alice', cn: 'Alice Liu', sn: 'Liu'}, 'secret')
})
```

组件监听 LDAP（给了 `tls` 时同时提供 StartTLS）和 LDAPS，可以监听某个地址，也可以按网卡监听（`interface: 'eth1'`，不管网卡的地址是什么）。后端和拦截器可以是对象，也可以是带选项的 lakutata 类（`{class: DevicesBackend, suffix: 'ou=devices,dc=example,dc=com'}`），由组件在自己的容器里创建。`connect()` 返回一个进程内连接，操作和客户端相同；`directory()` 返回建在进程内连接上的目录助手；两者经过的 schema 校验、密码哈希和访问控制都和网络请求相同。服务器具体做什么（schema、密码、访问规则、拦截器）见 `@lakutata/ldap-engine` 的 README。

### 目录后端

```typescript
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
            backends: [{
                class: DirectoryBackend,
                suffix: 'dc=example,dc=com',
                unique: ['uid', 'mail'],
                initialize: {admin: {dn: 'cn=admin,dc=example,dc=com', password: process.env.LDAP_ADMIN_PASSWORD!}}
            }],
            access: {admins: ['cn=admin,dc=example,dc=com']},
            passwordPolicy: {default: {lockout: true, maxFailure: 5, lockoutDuration: 900, maxAge: 7776000, expireWarning: 1209600}}
        })
    },
    bootstrap: ['database', 'ldap']
}))
```

目录后端把它后缀下的条目存进应用的数据库（PostgreSQL、MySQL 或 SQLite）：一张条目表，每个值一行，不管条目是什么对象类，所以条目能有哪些属性由服务器的 schema 决定。把 `directoryEntities(type)`（参数是数据库的类型；MySQL 把值存在 LONGTEXT 列里）返回的实体加进数据库的实体；迁移和应用的其他实体一样，由应用自己管理。

- 搜索由数据库执行：过滤器翻译成 SQL，按匹配规则比较时所用的值的形式（相等、子串、整数和时间）查找，SQL 不能精确判断的部分由服务器再检查。
- 值里写的 DN（member、manager、seeAlso 等）指向对应的条目：条目改名时跟着改，条目删除时被移除（必需属性因此变空时，留下一个占位值，默认是空 DN）。
- memberOf 在读取时计算，用它做过滤器可以找到一个组的成员；`nestedGroups` 可以展开嵌套组。posixGroup 条目会算出 memberUid，供 RFC 2307 的客户端使用。
- 新增的 posixAccount 和 posixGroup 条目没有 uidNumber、gidNumber 时自动分配（从 10000 开始）；uidNumber 唯一，posixGroup 的 gidNumber 在各个组之间也唯一。
- `unique` 里的属性，其值在整个后缀内唯一；最近一次成功绑定的时间作为 authTimestamp 返回；绑定失败的记录存在数据库里，应用的多个实例共用，密码策略的状态也是这样；`mailAlias` 让 email 等于 mail。
- 每个写操作在一个事务里执行，拦截器的 `beforeCommit()` 也在其中。
- `initialize` 在第一次启动时建立后缀条目和管理员（或者导入 LDIF），只做一次。

### 客户端

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

组件提供 LDAP 连接的各种操作（`search()`、`searchIterator()`、`compare()`、`add()`、`modify()`、`delete()`、`modifyDN()`、`extended()`、`passwordModify()`、`whoAmI()`），以及在单独的连接上检查用户密码的 `authenticate()`、`readSchema()`，还有用于在连接池之外单独开连接的 `connect()`。连接在第一次操作时才打开，随应用一起关闭。搜索默认分页，结果不是成功时会抛出对应的异常。`authenticate()` 只通过 TLS（`ldaps` URL 或 `startTLS: true`）或本机的 `ldapi` 套接字发送密码，除非传入 `requireTLS: false`。

## 选项

### LDAPServer

| 选项 | 默认值 | 说明 |
|---|---|---|
| `host` | 所有地址 | 监听的地址 |
| `port` | `389` | LDAP 端口（`0` 表示任选一个空闲端口） |
| `ldapsPort` | | LDAPS 端口，需要同时给 `tls` |
| `tls` | | StartTLS 和 LDAPS 用的证书和私钥（`cert`、`key`）；用 SASL EXTERNAL 时还要 `requestCert: true`，并在 `ca` 里给出客户端证书的 CA |
| `interface`、`strict`、`family`、`onError`、`interfaceListening` | | 按网卡监听，代替按地址监听 |
| `backends` | | 后端：对象，或带选项的 lakutata 类 |
| `interceptors` | | 拦截器：对象、带位置的拦截器，或带选项的 lakutata 类 |
| `schema` | 自带的文件 | `bundled`（要加载的自带文件）和 `files`（自己的 schema 文件，给路径或文本） |
| `access` | | `admins`、`passwordAdmins`、`anonymousRead`、`authenticatedRead`、`check` |
| `limits` | | 条数、时间、消息大小、请求数和连接数的上限 |
| `bindThrottle` | 连续失败 5 次后锁定 | 绑定失败的限制 |
| `plaintextBind` | `'all'` | 不用 TLS 时在哪里接受密码：`'all'`、`'loopback'`、`'none'` |
| `allowUnauthenticatedBind` | `false` | 把带名字、不带密码的绑定当作匿名绑定接受 |
| `passwords` | `{PBKDF2-SHA512}` | 写入密码用的格式，以及 PBKDF2 的迭代次数 |
| `passwordPolicy` | | 密码策略：默认策略（pwdPolicy 条目的 DN，或者直接给出规则）、`quality`、`revealLocked` |
| `rehashOnBind` | `true` | 用较弱格式的密码绑定成功后，按服务器的格式重新哈希 |
| `sasl` | PLAIN、EXTERNAL | SASL 机制 |
| `extendedOperations`、`controls` | | 自己的扩展操作和控制项 |
| `vendorName`、`vendorVersion`、`defaultNamingContext`、`rootDSEAttributes` | `lakutata` | rootDSE 里的内容 |
| `schemaConfigView` | `false` | 像 OpenLDAP 那样以只读方式公布 schema 文件（`cn=schema,cn=config`） |

### DirectoryBackend

| 选项 | 默认值 | 说明 |
|---|---|---|
| `suffix` | | 后端最上层条目的 DN |
| `database` | `'database'` | Database 组件注册的名字 |
| `groups` | groupOfNames/member、groupOfUniqueNames/uniqueMember、groupOfMembers/member | 组类以及表示成员的属性 |
| `memberOf` | `true` | 提供 memberOf；schema 自己定义了 memberOf 时，给出自己的名字和 OID，或者设为 `false` |
| `nestedGroups` | `0` | memberOf 展开嵌套组的层数 |
| `memberUid` | `true` | 为 posixGroup 条目算出 memberUid |
| `unique` | | 值在整个后缀内唯一的属性 |
| `idAllocation` | 从 10000 开始 | 自动分配的第一个 uidNumber 和 gidNumber，或者 `false` |
| `lastBind` | `true` | 提供 authTimestamp，即最近一次成功绑定的时间 |
| `mailAlias` | `false` | 提供 email，值和 mail 相同 |
| `referencePlaceholder` | 空 DN | 必需的 DN 属性的最后一个值指向的条目被删除时，留下的占位值 |
| `sharedThrottle` | `true` | 把绑定失败的记录存在数据库里 |
| `initialize` | | `root`、`ldif` 和 `admin`：第一次启动时要建立的内容 |

### LDAPClient

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
| `LDAPServer`、`buildLDAPServerOptions(options)`、`LDAPServerOptions` | 服务器组件及其选项 |
| `LDAPClient`、`buildLDAPClientOptions(options)`、`LDAPClientOptions` | 客户端组件及其选项 |
| `DirectoryBackend`、`DirectoryBackendOptions`、`directoryEntities(type)` | 目录后端、它的选项、某种数据库用的实体 |
| `LDAPEntryRecord`、`LDAPValueRecord`、`LDAPMySQLValueRecord`、`LDAPUniqueRecord`、`LDAPBindStateRecord` | 目录后端的实体 |
| `ObjectSpecification`、`InterceptorSpecification`、`InterfaceListeningOptions` | 选项用到的类型 |
| `@lakutata/ldap-engine` 导出的全部内容 | 协议、客户端、服务器引擎、目录助手 |

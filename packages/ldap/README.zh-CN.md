# @lakutata/ldap

[English](README.md) | 中文

[Lakutata](https://www.npmjs.com/package/lakutata) 框架的 LDAP 组件。`LDAPServer` 组件使应用能够提供目录服务：条目存放在该组件的后端中（`DirectoryBackend` 将条目存入应用的数据库），应用无需经过网络即可读写这些条目。`LDAPClient` 组件为应用提供一个连接池，用于连接 LDAP 服务器（OpenLDAP、Active Directory、389 Directory Server 等）。两个组件都构建于 [`@lakutata/ldap-engine`](https://www.npmjs.com/package/@lakutata/ldap-engine) 之上，本包重新导出其全部内容。

## 安装

```shell
npm install lakutata @lakutata/ldap
```

支持 Node.js `>=18.10.0`、Bun、Electron 和 NW.js。如需按网口监听，还需要安装 `@lakutata/netif`。

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

组件监听 LDAP（配置了 `tls` 时同时提供 StartTLS）和 LDAPS，可以监听某个地址，也可以按网口监听（`interface: 'eth1'`，无论网口使用什么地址）。配置了 `ldapiPath` 时，组件还监听一个 Unix socket，供同一台机器上的客户端使用（SSSD、nslcd），在该 socket 上发送的密码与通过 TLS 发送的一样被接受。`port: false` 表示不开启 LDAP 端口。后端、插件和拦截器可以是对象（`@lakutata/ldap-engine` 的插件：`new MemberOfPlugin()`），也可以是带选项的 Lakutata 类（`{class: DevicesBackend, suffix: 'ou=devices,dc=example,dc=com'}`），后者由组件在其自身的容器中创建。`connect()` 返回一个进程内连接，其操作与客户端相同；`directory()` 返回基于进程内连接的目录助手。两者经过的 schema 校验、密码哈希和访问控制都与网络请求相同。服务器的具体行为（schema、密码、访问规则、插件）见 `@lakutata/ldap-engine` 的 README。

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
                database: 'database',
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

目录后端将其后缀下的条目存入应用的数据库（PostgreSQL、MySQL 或 SQLite）：一张条目表，每个值一行，无论条目属于什么对象类，因此条目能包含哪些属性由服务器的 schema 决定。请将 `directoryEntities(type)`（参数为数据库的类型；MySQL 将值存放在 LONGTEXT 列中）返回的实体加入数据库的实体；与应用的其他实体一样，迁移由应用自行管理。

- 搜索由数据库执行。过滤器会转换为 SQL，按匹配规则比较时所用的值的形式（相等、子串、整数和时间）查找，SQL 无法精确判断的部分再由服务器检查。
- 排序搜索（排序控制项，以及虚拟列表视图的窗口）由后端自行排序，后端只读取窗口内的条目：按偏移量取的窗口由数据库根据每个值附带的排序键完成排序、计数和截取；其他情况下，后端读出排序键的值，按服务器的规则排序。排序键在写入值时按属性的排序规则生成。schema 修改该规则后，之前写入的值需要重新写入一次才会换成新的键（OpenLDAP 修改规则后同样需要用 slapindex 重建索引）。某个排序键没有值的条目排在其他条目之后，逆序时排在其他条目之前（RFC 2891）。设置了 `access.check` 且未将 `access.checkReads` 设为 false（不判断读取的检查可以如此设置），或者存在会从搜索结果中去掉条目的拦截器时，虚拟列表视图由服务器自行排序和开窗，受 `limits.sortCandidates` 限制，从而使其计数不包括会话不能读取的条目。
- 搜索结果的顺序是确定的：条目排在其下级条目之前，同级条目按添加的先后排列（entryUUID 是第 7 版 UUID，其顺序即创建顺序；携带自身 entryUUID 导入的条目按该值确定位置）。排序键相同的条目也保持这一顺序。
- 值中的 DN（member、manager、seeAlso 等）指向对应的条目：条目改名时随之更新，条目删除时随之移除（必需属性因此变空时，留下一个占位值，默认为空 DN）。
- memberOf 在读取时计算，以其作为过滤条件可以找到一个组的成员；`nestedGroups` 可以展开嵌套组。posixGroup 条目的 memberUid 通过计算得出，供 RFC 2307 的客户端使用。
- 新增的 posixAccount 和 posixGroup 条目没有 uidNumber、gidNumber 时，会自动分配所缺的编号（从 10000 开始）；uidNumber 唯一，posixGroup 的 gidNumber 在各组之间也唯一。POSIX 的对象类来自自带的 rfc2307bis，该 schema 默认不加载，需要在 `schema.bundled` 中列出。
- `unique` 中的属性，其值在整个后缀内唯一。authTimestamp 返回最近一次成功的带密码绑定的时间，简单绑定和 SASL PLAIN 均计入（条目正被其他写操作占用时，绑定不会等待，此次的时间不会记录；在 SQLite 上，只要有写操作正在进行，就会出现这种情况；MySQL 8.0 之前和 MariaDB 10.6 之前的版本无法跳过被其他写操作占用的行，绑定会等待该写操作完成）。绑定失败的记录保存在数据库中，由应用的多个实例共用，密码策略的状态也是如此（两个实例在同一毫秒内、均尚未写入时各有一次绑定失败，可能记下相同的时间；该时间只保存一个，因此两次失败算作一次）。`mailAlias` 使 email 等于 mail。
- 每个写操作都在一个事务中执行，拦截器的 `beforeCommit()` 也在该事务中执行。对同一条目的写操作依次执行，多个实例共用一个数据库时也是如此（在 SQLite 上，对同一个文件的所有写操作都依次执行），因此两个客户端同时修改同一属性的不同值时，双方的修改都会保留。
- `beforeCommit()` 通过使用同一个 Database 组件的服务器所做的搜索和写操作，都在其所在的那个写操作的事务中进行：这些搜索和写操作能读到该事务中已写入的内容；该写操作失败时，这些写操作也一并撤销。此类搜索会先读完全部结果再返回。读取期间，该写操作的其他操作须等待读取完成，该写操作持有的锁也不会释放。结果较多时会占用大量内存；条数限制只限制返回的条数，不限制读取的条数。超过时间限制后，搜索停止读取，并以 timeLimitExceeded 失败，不返回任何条目。在 PostgreSQL 上，如果此类读取被数据库拒绝（例如语句超时），即使拦截器捕获了错误，该写操作也会失败。
- 写操作因死锁被数据库中止、因无法串行化被拒绝，或者等待锁超时（数据库设置了锁等待超时；SQLite 上则是文件被另一个进程占用超过 busy timeout）时，回应为 busy（51），且不会留下任何改动，客户端可以重新发送。
- MariaDB 服务器请配置为 `mariadb` 类型。配置为 `mysql` 时，后端原本使用共享锁的行（父条目、值所指的条目）会改用排他锁，此时在同一个父条目下添加条目、写入指向同一个条目的值，都须依次进行。
- 在 SQLite 上，`beforeCommit()` 通过另一个 Database 组件对同一个文件所做的写操作会被拒绝（unwillingToPerform），因为该写操作要等待的正是其所在的那个写操作。此类写操作请通过使用同一个 Database 组件的服务器完成。
- DN 值与其所指的条目同时写入时，要等两个写操作都提交后，才将该值指向那个条目。这一步出错时，错误会作为服务器的 `error` 事件报告，组件会将其记入日志；写操作本身已经完成。
- `@lakutata/ldap-engine` 中功能已由目录后端自行完成的插件（`MemberOfPlugin`、`ReferentialIntegrityPlugin`、`IdAllocationPlugin`、`LastBindPlugin`）不进入该后端的处理链。其他插件（`UniquePlugin`、`AuditPlugin`、`ConstraintPlugin` 等）与在其他后端上一样运行。
- `initialize` 在首次启动时创建后缀条目和管理员（或者导入 LDIF），且只执行一次。

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

组件提供 LDAP 连接的各种操作（`search()`、`searchIterator()`、`compare()`、`add()`、`modify()`、`delete()`、`modifyDN()`、`extended()`、`passwordModify()`、`whoAmI()`）。此外还提供 `authenticate()`（在单独的连接上检查用户密码）、`readSchema()`，以及 `connect()`（在连接池之外另开连接）。连接在首次操作时才打开，随应用一起关闭。搜索默认分页，结果不是成功时会抛出对应的异常。`authenticate()` 只通过 TLS（`ldaps` URL 或 `startTLS: true`）或本机的 `ldapi` 套接字发送密码，除非传入 `requireTLS: false`。

## 选项

### LDAPServer

| 选项 | 默认值 | 含义 |
|---|---|---|
| `host` | 所有地址 | 监听的地址 |
| `port` | `389` | LDAP 端口（`0` 表示任选一个空闲端口，`false` 表示不开启） |
| `ldapsPort` | | LDAPS 端口，需要同时配置 `tls` |
| `ldapiPath` | | 在端口之外另行监听的 Unix socket（ldapi）的路径，供同一台机器上的客户端使用；在该 socket 上发送的密码与通过 TLS 发送的一样被接受 |
| `ldapiMode` | 由 umask 决定 | socket 的权限，决定谁可以连接（`0o666`：本机的所有用户） |
| `tls` | | StartTLS 和 LDAPS 使用的证书和私钥（`cert`、`key`）；使用 SASL EXTERNAL 时还需要 `requestCert: true`，并在 `ca` 中给出客户端证书的 CA |
| `interface`、`strict`、`family`、`onError`、`interfaceListening` | | 按网口监听，代替按地址监听 |
| `backends` | | 后端：对象，或带选项的 Lakutata 类 |
| `plugins` | | 插件：对象，或带选项的 Lakutata 类（还可以指定 `name`、`suffixes`） |
| `interceptors` | | 单独给出的拦截器：对象、带位置的拦截器，或带选项的 Lakutata 类 |
| `schema` | core、cosine、inetorgperson | `bundled`（按名称选择自带的 schema；`rfc2307bis`、`openssh-lpk`、`ppolicy` 需要列出名称才会加载，`[]` 表示不加载其中任何一个）、`directory`（schema 文件所在的目录，按文件名顺序加载）和 `files`（自定义的 schema：路径、文本，或 `readSchemaFile()`、`parseSchemaFile()` 得到的文档） |
| `access` | | `admins`、`adminPasswords`、`passwordAdmins`、`anonymousRead`、`authenticatedRead`、`check` |
| `limits` | | 条数、时间、消息大小、请求数和连接数的上限 |
| `bindThrottle` | 连续失败 5 次后锁定 | 绑定失败的限制 |
| `plaintextBind` | `'all'` | 不使用 TLS 时在何处接受密码：`'all'`、`'loopback'`、`'none'`（Unix socket 不受此选项限制） |
| `allowUnauthenticatedBind` | `false` | 将带名称、不带密码的绑定作为匿名绑定接受 |
| `passwords` | `{PBKDF2-SHA512}` | 写入密码所用的格式，以及 PBKDF2 的迭代次数 |
| `passwordPolicy` | | 密码策略（排在其他插件之后的一个 `PasswordPolicyPlugin`）：默认策略（pwdPolicy 条目的 DN，或者直接给出规则）、`quality`、`revealLocked` |
| `rehashOnBind` | `true` | 用较弱格式的密码绑定成功后，按服务器的格式重新哈希 |
| `sasl` | PLAIN、EXTERNAL | SASL 机制 |
| `extendedOperations` | | 自定义的扩展操作 |
| `vendorName`、`vendorVersion`、`defaultNamingContext`、`rootDSEAttributes` | `lakutata` | rootDSE 中的内容 |
| `schemaConfigView` | `false` | 像 OpenLDAP 一样以只读方式公布 schema 文件（`cn=schema,cn=config`） |

### DirectoryBackend

| 选项 | 默认值 | 含义 |
|---|---|---|
| `suffix` | | 后端最上层条目的 DN |
| `database` | | 应用的 Database 组件注册的名称（其在 `components` 中的键），必填 |
| `groups` | groupOfNames/member、groupOfUniqueNames/uniqueMember、groupOfMembers/member | 组类以及表示成员的属性 |
| `memberOf` | `true` | 提供 memberOf；schema 自身定义了 memberOf 时，给出自定义的名称和 OID，或者设为 `false` |
| `nestedGroups` | `0` | memberOf 展开嵌套组的层数 |
| `memberUid` | `true` | 为 posixGroup 条目计算 memberUid |
| `unique` | | 值在整个后缀内唯一的属性 |
| `idAllocation` | 从 10000 开始 | 自动分配的第一个 uidNumber 和 gidNumber，或者 `false` |
| `lastBind` | `true` | 提供 authTimestamp，即最近一次成功的带密码绑定的时间 |
| `mailAlias` | `false` | 提供 email，值与 mail 相同 |
| `referencePlaceholder` | 空 DN | 必需的 DN 属性中，最后一个值所指的条目被删除时留下的占位值 |
| `sharedThrottle` | `true` | 将绑定失败的记录保存在数据库中 |
| `initialize` | | `root`、`ldif` 和 `admin`：首次启动时要创建的内容 |

### LDAPClient

| 选项 | 默认值 | 含义 |
|---|---|---|
| `url` | | 服务器的 LDAP URL，或按顺序尝试的多个 URL |
| `srv` | | 给出服务器的 DNS SRV 记录，代替 `url` |
| `bindDN`、`password` | 匿名 | 连接池的身份 |
| `tls` | | TLS 选项（`ca`、`cert`、`key`、`rejectUnauthorized` 等） |
| `startTLS` | `false` | 对 `ldap://` URL 的每个连接执行 StartTLS |
| `poolSize` | `4` | 连接池的最大连接数 |
| `connectTimeout` | `5000` | 建立连接最多可用的毫秒数 |
| `timeout` | `30000` | 操作最多可用的毫秒数，超过后放弃该操作（`0` 表示不限） |
| `idleTimeout` | `600000` | 连接空闲达到该毫秒数后关闭 |
| `maxMessageSize` | 64 MiB | 服务器可发送的消息大小上限 |
| `binaryAttributes` | | 值为字节的其他属性 |

## API

| 导出 | 说明 |
|---|---|
| `LDAPServer`、`buildLDAPServerOptions(options)`、`LDAPServerOptions` | 服务器组件及其选项 |
| `LDAPClient`、`buildLDAPClientOptions(options)`、`LDAPClientOptions` | 客户端组件及其选项 |
| `DirectoryBackend`、`DirectoryBackendOptions`、`directoryEntities(type)` | 目录后端、其选项、特定类型数据库所用的实体 |
| `LDAPEntryRecord`、`LDAPValueRecord`、`LDAPMySQLValueRecord`、`LDAPUniqueRecord`、`LDAPBindStateRecord` | 目录后端的实体 |
| `ObjectSpecification`、`PluginSpecification`、`PluginObjectSpecification`、`InterceptorSpecification`、`InterfaceListeningOptions` | 选项用到的类型 |
| `@lakutata/ldap-engine` 导出的全部内容 | 协议、客户端、服务器引擎、目录助手 |
| `@lakutata/ldap/schemas` | 自带的 schema 文档（`CORE`、`RFC2307BIS` 等，以及 `DEFAULTS`），即 `@lakutata/ldap-engine/schemas` 的内容 |

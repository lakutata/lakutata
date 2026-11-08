# LDAP

应用可以用目录服务（OpenLDAP、Active Directory、389 Directory Server……）验证用户登录、读写目录，也可以自己提供一个目录，给其他软件使用（SSSD、Keycloak、Gitea、Jenkins、Grafana、NAS 设备……）。由两个包完成：

- [`@lakutata/ldap-engine`](https://github.com/lakutata/lakutata/tree/main/packages/ldap-engine)，引擎：协议（消息、控制、DN、过滤器、schema、LDIF）、客户端，以及由后端存放条目的服务器。它不需要 lakutata 应用，没有依赖，也没有原生代码。
- [`@lakutata/ldap`](https://github.com/lakutata/lakutata/tree/main/packages/ldap)，组件：`LDAPClient`、`LDAPServer`，以及把服务器的条目存进应用数据库的 `DirectoryBackend`。它重新导出了引擎。

`lakutata` 包不重新导出它们：应用用到哪个就安装哪个。

```shell
npm install @lakutata/ldap                     # 会一起安装引擎
npm install @lakutata/netif                    # 按网卡监听时需要
```

## 1. 用目录验证用户登录

`LDAPClient` 组件维护一个连接池，连接以服务账号绑定。`authenticate()` 先找到用户的条目，再在一个单独的连接上以该用户绑定。

```typescript
import {Application} from 'lakutata'
import {buildLDAPClientOptions, type LDAPClient} from '@lakutata/ldap'

Application.run(() => ({
    id: 'portal.app',
    name: 'Portal',
    components: {
        ldap: buildLDAPClientOptions({
            url: ['ldaps://dc1.example.com', 'ldaps://dc2.example.com'],
            bindDN: 'CN=svc-portal,OU=Service,DC=example,DC=com',
            password: process.env.LDAP_PASSWORD
        })
    }
})).onLaunched(async (app) => {
    const ldap: LDAPClient = await app.getObject('ldap')
    const result = await ldap.authenticate({username: 'alice', password: 'secret', base: 'DC=example,DC=com', attribute: 'sAMAccountName'})
    if (result.ok) console.log('signed in as', result.dn, result.entry?.first('displayName'))
    else console.log('refused:', result.reason)
})
```

- 空密码在发送任何请求之前就被拒绝：很多服务器把有名字、没有密码的绑定当作匿名绑定成功。
- `reason` 说明绑定失败的原因：`invalidCredentials`、`accountLocked`、`passwordExpired`、`changeAfterReset`……，取自 OpenLDAP 的密码策略控制或 Active Directory 的数据代码。`timeBeforeExpiration` 和 `graceAuthNsRemaining` 在密码过期之前给出提醒。
- 密码只经 TLS（`ldaps` 地址或 `startTLS: true`）或本机的 `ldapi` 套接字发送，除非设置 `requireTLS: false`。
- `bindName` 用用户名拼出绑定名（Active Directory 上是 `alice@example.com`），不先搜索条目。
- 服务器按顺序尝试，也可以从 DNS SRV 记录中查找（`srv: '_ldap._tcp.dc._msdcs.example.com'`）。

## 2. 读写目录

组件提供 LDAP 连接的各种操作。

```typescript
import {type Entry, filter, type LDAPClient} from '@lakutata/ldap'

async function staff(ldap: LDAPClient, department: string): Promise<string[]> {
    const {entries} = await ldap.search('OU=Staff,DC=example,DC=com', {
        filter: filter`(&(objectClass=user)(department=${department}))`,
        attributes: ['sAMAccountName', 'mail', 'objectGUID']
    })
    return entries.map((entry: Entry) => entry.first('sAMAccountName')!)
}

async function rename(ldap: LDAPClient): Promise<void> {
    await ldap.modify('uid=alice,ou=people,dc=example,dc=com', [
        {operation: 'replace', attribute: 'mail', values: 'alice.liu@example.com'},
        {operation: 'add', attribute: 'telephoneNumber', values: '+86 10 1234 5678'}
    ])
    await ldap.modifyDN('uid=alice,ou=people,dc=example,dc=com', 'uid=alice.liu')
    await ldap.passwordModify({userIdentity: 'uid=alice.liu,ou=people,dc=example,dc=com', newPassword: 'new secret'})
}
```

- 模板 `filter` 会转义写进去的值，值改变不了过滤器的结构。
- 搜索默认分页（每页 500 个条目），服务器对单次请求的条数限制不会把结果截断；`searchIterator()` 逐个给出条目。`sort` 和 `window` 读取排序后条目中的一段。
- `entry.get()` 以文本给出值，值是字节的属性（`jpegPhoto`、`objectGUID`）会被拒绝；`entry.getBuffers()` 给出字节。`guidToString()`、`sidToString()` 和 `parseUserAccountControl()` 读取 Active Directory 的值；`changeADPassword()` 在 Active Directory 上修改密码。
- 结果不是成功时抛出对应的异常（见[异常](#异常)）。
- 超过 `timeout`（默认 30 秒）的操作会在服务器上放弃，连接继续可用。

## 3. 提供目录服务

`LDAPServer` 组件提供它的后端里的条目。用 `DirectoryBackend` 时，条目存在应用的数据库里（PostgreSQL、MySQL 或 SQLite）。

```typescript
import {readFileSync} from 'node:fs'
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
            ldapsPort: 636,
            tls: {cert: readFileSync('/etc/directory/server.crt'), key: readFileSync('/etc/directory/server.key')},
            backends: [{
                class: DirectoryBackend,
                suffix: 'dc=example,dc=com',
                initialize: {admin: {dn: 'cn=admin,dc=example,dc=com', password: process.env.LDAP_ADMIN_PASSWORD!}}
            }],
            access: {admins: ['cn=admin,dc=example,dc=com']}
        })
    },
    bootstrap: ['database', 'ldap']
}))
```

- `initialize` 在第一次启动时创建后缀条目（由后缀推出：`dc=example,dc=com` 对应 `dcObject` 和 `organization`）和管理员，只创建一次，多个实例同时启动也一样。
- 服务器监听 LDAP，设置了 `tls` 时支持 StartTLS，并在 `ldapsPort` 上监听 LDAPS。安装 `@lakutata/netif` 后，`interface: 'eth1'` 按网卡监听，不管它的地址是什么。
- `ldapiPath` 另外监听一个 Unix socket（ldapi），供同一台机器上的客户端使用；`ldapiMode` 决定谁能连接（`0o666`：本机的所有用户；默认按 umask 决定，通常只有服务器进程所属的用户）。`port: false` 表示不开 LDAP 端口，适合只给本机客户端用的服务器。
- 目录后端的表和应用的其他实体一样由应用自己迁移：把 `directoryEntities(type)` 返回的实体加进数据库的实体，再生成迁移。

## 4. 在应用内使用目录

应用可以不经网络，通过组件读写自己的目录：`connect()` 以指定的身份给出一个连接，不需要绑定，提供客户端的各种操作；`directory()` 在这样的连接上管理用户、组和组织单位。它们写入的内容和网络请求一样，要经过 schema 检查、密码哈希和访问控制。

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import type {LDAPServer} from '@lakutata/ldap'

export class Accounts extends Component {
    @Inject('ldap')
    protected readonly ldap: LDAPServer

    public async hire(name: string, fullName: string, password: string): Promise<string> {
        const directory = this.ldap.directory('cn=admin,dc=example,dc=com')
        const dn: string = await directory.createUser('ou=people,dc=example,dc=com', {uid: name, cn: fullName, sn: fullName.split(' ').pop()!}, password)
        await directory.addMember('cn=staff,ou=groups,dc=example,dc=com', dn)
        return dn
    }

    public async checkPassword(dn: string, password: string): Promise<boolean> {
        return this.ldap.directory('cn=admin,dc=example,dc=com').verifyPassword(dn, password)
    }
}
```

目录助手由 LDAP 操作组成，所以在任何连接上都能用：`createDirectory(client)` 用同样的方式管理远程的 OpenLDAP，只要它的 profile 和那台服务器的 schema 对得上。默认的 profile 里，用户是以 `uid` 命名的 `inetOrgPerson`，组是以 `cn` 命名的 `groupOfNames`（组里没有成员时以空 DN 作为成员），组织单位是 `organizationalUnit`；对象类不同的目录给出自己的 profile。

## 5. Schema

Schema 决定一个条目能存什么：它的对象类、对象类要求和允许的属性、语法和匹配规则。服务器按它检查每一次写入。

- 自带：各 RFC 的 schema（core、cosine、inetOrgPerson）、rfc2307bis（POSIX 账号和组）、openssh-lpk（SSH 公钥）和 ppolicy（密码策略），默认全部加载；`schema.bundled` 可以少加载一些。
- `schema.files` 按路径或文本加入自己的 schema 文件：OpenLDAP `cn=config` 的 LDIF、subschema 条目，或 `.schema` 格式。同一个名字或 OID 定义了两次时，服务器在启动时就停下，并指出两个文件。
- 目录树的结构由数据决定：schema 只规定条目存什么，不规定它放在哪里。
- 客户端在 `cn=Subschema` 读取 schema；`schemaConfigView: true` 还会像 OpenLDAP 那样，在 `cn={N}<name>,cn=schema,cn=config` 以只读方式列出这些文件。

## 6. 谁能做什么

| 谁 | 能做什么 |
|---|---|
| 匿名会话 | 读取根 DSE 和 subschema（`access.anonymousRead: true` 允许它读取目录） |
| 已绑定的会话 | 读取目录（`userPassword` 除外，谁都不能读）；修改自己的密码 |
| 管理员（`access.admins`） | 写入，修改任何人的密码 |
| 密码管理员（`access.passwordAdmins`） | 修改别人的密码（Keycloak 或 Nextcloud 的服务账号） |

给了 `access.check` 时由它先判断：返回 true 允许，false 拒绝，undefined 交给上表。

- `plaintextBind`：不经 TLS 时在哪里接受密码：任何地方（默认）、只限回环地址，或任何地方都不接受。`ldapiPath` 的 Unix socket 不受它限制，因为这种连接不会离开本机。
- 有名字、密码为空的绑定会被拒绝（`allowUnauthenticatedBind` 把它当作匿名绑定接受）。
- 同一个 DN 或地址的绑定失败后，回应一次比一次慢，再失败就拒绝一段时间（`bindThrottle`），回应的都是 invalidCredentials，分不出账号被锁定还是密码错误。
- 限制：非管理员的会话每次搜索最多 500 个条目、3600 秒，以及消息的大小、未完成的请求数、过滤器的深度和大小、空闲时间（`limits`）。

## 7. 密码和密码策略

服务器把收到的每个密码哈希成 `{PBKDF2-SHA512}`（OpenLDAP 的 pw-pbkdf2 模块的格式）。绑定时也能验证 OpenLDAP 的其他格式（`{SSHA}`、SHA-2 系列、MD5、SHA-256、SHA-512 和 bcrypt 的 `{CRYPT}`，以及 node:crypto 能运行 argon2 时的 `{ARGON2}`：Node.js 24.7 及以后可以，Electron 不行）和旧目录里的明文密码，验证成功后再按服务器的格式重新哈希。管理员可以原样写入已经哈希过的值，用来导入账号。

`passwordPolicy` 实现 draft-behera 的密码策略，和 OpenLDAP 的 ppolicy 用同一套属性：

```typescript
import {buildLDAPServerOptions, MemoryBackend} from '@lakutata/ldap'

const options = buildLDAPServerOptions({
    backends: [new MemoryBackend('dc=example,dc=com')],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    passwordPolicy: {
        //也可以是 pwdPolicy 条目的 DN；用户的 pwdPolicySubentry 会替换它
        default: {lockout: true, maxFailure: 5, lockoutDuration: 900, maxAge: 7776000, expireWarning: 1209600, graceAuthNLimit: 3, minLength: 10, checkQuality: 2, inHistory: 5, mustChange: true},
        quality: (password: Buffer) => /\d/.test(password.toString()) || 'A password needs a digit'
    }
})
```

- 多次失败后锁定账号，锁定一段时间，或直到管理员重设密码；长期没有登录的账号也会锁定（`maxIdle`）。
- 密码过期、过期前的提醒，以及过期后还允许的几次绑定（宽限）。
- 管理员设置密码后，用户必须先改密码才能做别的事（`mustChange`）。
- 新密码：谁能改、是否要提供旧密码（`safeModify`）、多久后才能再改（`minAge`）、长度、质量，以及用过的密码（`inHistory`）。
- 状态存在条目的操作属性里（pwdChangedTime、pwdAccountLockedTime、pwdFailureTime……），所以每种后端都能保存，同一个数据库上的多个应用实例共享它。
- 发送密码策略控制的客户端会在响应里收到提醒和原因。
- 密码策略也是一个插件（第 9 节）：`passwordPolicy` 会在其他插件之后加上一个 `PasswordPolicyPlugin`。

## 8. 目录后端

它把一个后缀下的条目存进应用的数据库，不管条目是什么对象类：一张条目表，每个值一行。

- 搜索在数据库里执行：过滤器翻译成 SQL，比较的是匹配规则所用的值的形式（相等、子串、整数和时间）；SQL 不能精确判断的部分由服务器再检查。
- DN 类的值（member、manager、seeAlso……）指向对应的条目：条目改名时跟着改，条目删除时一起去掉；必需属性因此变空时留一个占位值（默认是空 DN）。
- `memberOf` 在读取时算出，按它过滤可以找到一个组的成员（`nestedGroups` 展开嵌套的组）。自己定义了 memberOf 的 schema 用 `memberOf: {name, oid}` 或 `memberOf: false`。
- POSIX：新增的条目没有 uidNumber、gidNumber 时自动分配（uidNumber 唯一，posixGroup 的 gidNumber 在各个组之间也唯一）；posixGroup 条目会算出 memberUid。
- `unique` 让若干属性的值在后缀内唯一；`authTimestamp` 给出最后一次绑定的时间；`mailAlias` 把 mail 同时以 email 给出（Grafana 读的是 email）。
- 每次写入都在一个事务里执行，拦截器的 `beforeCommit()` 也在其中。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `suffix` | | 顶层条目的 DN |
| `database` | `'database'` | Database 组件的名字 |
| `groups` | groupOfNames、groupOfUniqueNames、groupOfMembers | 组的对象类和它们的成员属性 |
| `memberOf`、`nestedGroups`、`memberUid` | `true`、`0`、`true` | 虚拟属性 |
| `unique` | | 值必须唯一的属性 |
| `idAllocation` | 从 10000 开始 | 分配的第一个 uidNumber 和 gidNumber，或 `false` |
| `lastBind`、`mailAlias` | `true`、`false` | authTimestamp、email |
| `initialize` | | `root`、`ldif`、`admin`：第一次启动时创建的内容 |

## 9. 插件

插件给服务器加上的，就是 OpenLDAP 的 overlay 给 slapd 加上的东西：在操作前后运行的代码，以及它需要的 schema、控制项和扩展操作。`@lakutata/ldap-engine` 自带下面这些插件，`@lakutata/ldap` 也导出了它们：

| 插件 | 作用 |
|---|---|
| `MemberOfPlugin` | 维护组成员的 memberOf |
| `ReferentialIntegrityPlugin` | 条目删除、改名或移动时，修改值里的 DN |
| `UniquePlugin` | 拒绝和别的条目重复的值 |
| `PasswordPolicyPlugin` | 第 7 节的密码策略，`passwordPolicy` 选项给出的也是它 |
| `IdAllocationPlugin` | 给新增时没有 uidNumber、gidNumber 的 POSIX 条目分配编号 |
| `LastBindPlugin` | 把最后一次绑定的时间记在 authTimestamp 里 |
| `SambaPasswordPlugin` | 把新密码的 NT 哈希写进 sambaNTPassword，NAS 设备的 SMB 读的就是它（需要加载 Samba 的 schema） |
| `AuditPlugin` | 把每个请求及其结果的记录交给自己写的函数 |
| `ConstraintPlugin` | 拒绝违反规则的值：格式、大小、个数，或者自己写的检查 |
| `GroupPresentationPlugin` | 让每个组同时以 groupOfNames 和 groupOfUniqueNames 呈现，给只认识其中一种的客户端用 |

```typescript
import {AuditPlugin, buildLDAPServerOptions, ConstraintPlugin, MemberOfPlugin, MemoryBackend} from '@lakutata/ldap'

const options = buildLDAPServerOptions({
    backends: [new MemoryBackend('dc=example,dc=com')],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    plugins: [
        new MemberOfPlugin(),
        new ConstraintPlugin({rules: [{attribute: 'mail', pattern: /@example\.com$/}]}),
        new AuditPlugin({write: (record) => console.log(record.operation, record.dn, record.resultCode)})
    ]
})
```

- `MemberOfPlugin`、`ReferentialIntegrityPlugin`、`IdAllocationPlugin` 和 `LastBindPlugin` 做的事，目录后端自己就在每次写操作的事务里做了：这几个插件不进它的处理链，其他插件照常运行。
- 每个插件的选项里都有 `name` 和 `suffixes`，用来把同一个插件配两份，或者只让它对部分后端生效。
- 插件只维护同一个后端里的关系，和 OpenLDAP 的 overlay 只管一个数据库一样：组和它的成员、条目和指向它的值，要放在同一个后端里。
- 插件带着拦截器，还可以包住每一个请求、包住密码的验证、检查密码的修改；也可以带上 schema 文件、控制项、扩展操作、SASL 机制和密码格式，由根 DSE 和 subschema 公布出去。两个插件认领同一个 OID 时，服务器在启动时就会报错。

拦截器在后端的操作前后运行代码：`before()` 检查或修改请求，`around()` 包住后面的处理，`transformEntry()` 修改搜索返回的条目，`beforeCommit()` 在写操作的事务里执行。每个拦截器排在服务器自带的某个步骤（`access`、`password`、`schema`、`operational`、`paging`）之前或之后；排在 `password` 之前，就能看到明文密码。

自己的插件写成一个类：继承 `BaseLDAPPlugin`；或者，要用组件的容器（用 `@Configurable` 声明选项、注入别的组件）时，继承 `Component` 并实现 `LDAPPlugin`，连同选项一起列出：

```typescript
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'
import {buildLDAPServerOptions, type LDAPInterceptor, type LDAPPlugin, MemoryBackend} from '@lakutata/ldap'

export class DepartmentPlugin extends Component implements LDAPPlugin {
    @Configurable(DTO.String().required())
    protected readonly department: string

    public readonly name: string = 'department'

    //没有部门的新员工，给他们填上部门
    public get interceptors(): LDAPInterceptor[] {
        return [{name: 'department', operations: ['add'], before: (context, request) => {
            if (request.type === 'add' && !request.entry.attributes.some((attribute) => attribute.type === 'departmentNumber')) {
                request.entry.attributes.push({type: 'departmentNumber', values: [Buffer.from(this.department)]})
            }
        }}]
    }
}

const options = buildLDAPServerOptions({
    backends: [new MemoryBackend('dc=example,dc=com')],
    plugins: [{class: DepartmentPlugin, department: 'R&D'}]
})
```

只有拦截器、没有别的东西的插件，可以直接放进 `interceptors` 选项。

## 10. 自己的后端

把用户存在自己表里的应用，用自己的后端提供它们：`get()` 按 DN 给出一个条目，`search()` 给出一次搜索的条目（多给一些也可以：服务器会再检查范围和过滤器），再加上它支持的写操作。`createHandlerBackend()` 用逐个操作写的处理函数构建后端：

```typescript
import {createHandlerBackend, type LDAPBackend} from '@lakutata/ldap'

const devices: {name: string, address: string}[] = [{name: 'printer1', address: '10.0.0.5'}]

export const deviceBackend: LDAPBackend = createHandlerBackend({
    suffix: 'ou=devices,dc=example,dc=com',
    search: () => [
        {dn: 'ou=devices,dc=example,dc=com', attributes: {objectClass: 'organizationalUnit', ou: 'devices'}},
        ...devices.map((device) => ({dn: `cn=${device.name},ou=devices,dc=example,dc=com`, attributes: {objectClass: 'device', cn: device.name, description: device.address}}))
    ]
})
```

后端也可以是带选项的 lakutata 类，`{class: MyBackend, suffix: '…'}`，在组件的容器里构建。后端自己就做某个插件的事时，在 `capabilities` 里声明（`memberOf`、`referentialIntegrity`、`idAllocation`、`lastBind`），这个插件就不进它的处理链。

## 11. 接入其他软件

- **SSSD 和 nslcd**：`ldap_schema = rfc2307bis`；按 `member` 查找组，memberUid 供 `rfc2307` 模式使用。SSSD 每次绑定都发送密码策略控制，服务器能处理。在同一台机器上，它们连接 `ldapiPath` 的 Unix socket（SSSD 需要 2.9 及以后），SSSD 在上面不经 TLS 发送密码。SSSD 2.10 起默认先启动 TLS，走 socket 时不需要：

  ```ini
  [domain/example]
  id_provider = ldap
  auth_provider = ldap
  ldap_uri = ldapi://%2Frun%2Fdirectory%2Fldapi
  ldap_search_base = dc=example,dc=com
  ldap_default_bind_dn = cn=sssd,dc=example,dc=com
  ldap_default_authtok = …
  ldap_schema = rfc2307bis
  ldap_id_use_start_tls = false
  ```

  `ldapiMode` 要允许 SSSD 运行时所用的用户连接。通过网络连接时，给服务器配置 `tls`，并把 CA 交给 SSSD（`ldap_tls_cacert`）。
- **Keycloak**：用户联合选供应商“Other”，`uid` 作为用户名和 RDN，`entryUUID` 作为 UUID 属性，打开“Use password modify extended operation”；组映射器用 `groupOfNames` 和 `member`。
- **Gitea**：LDAP 认证源（via BindDN），用户过滤器写 `(&(objectClass=inetOrgPerson)(uid=%s))`；管理员过滤器按 memberOf；SSH 公钥在 `sshPublicKey` 里。
- **Grafana**：`mailAlias: true` 提供它默认读取的 `email`。

## 12. 单独使用引擎

`@lakutata/ldap-engine` 可以用在任何 Node.js 程序里，不需要 lakutata：客户端用 `createLDAPClient()` 和 `connectLDAP()`，服务器用 `createLDAPServer()` 加 `MemoryBackend` 或自己的后端，`createDirectory()` 两边都能用。详见它的 README。

## 13. 运行平台

Node.js `>=18.10.0`、Bun 和 Electron。引擎没有原生代码。目录后端运行在 `lakutata/orm` 的数据库上，各驱动在 Electron 和 Bun 里的要求见 [DatabaseDrivers](DatabaseDrivers.md)：Bun 加载不了 better-sqlite3，在 Bun 上它运行在 `sqljs`、PostgreSQL 或 MySQL 上。

## 异常

| 异常 | 何时抛出 |
|---|---|
| `LDAPResultException` 及其子类（`LDAPNoSuchObjectException`、`LDAPInvalidCredentialsException`、`LDAPInsufficientAccessException`、`LDAPEntryAlreadyExistsException`、`LDAPConstraintViolationException`、`LDAPObjectClassViolationException`……） | 结果不是成功，带有 `code`、`matchedDN` 和 `diagnosticMessage`（Active Directory 还有 `adDataCode`）；后端或拦截器抛出它们，就以对应的结果码回应 |
| `LDAPConnectionException` | 连接打不开，或在还有操作等待时断开 |
| `LDAPTimeoutException` | 操作超过了它的 `timeout` |
| `LDAPUsageException` | 调用在发送任何请求之前就被拒绝（空密码、要求以文本读取字节属性） |
| `LDAPSchemaException` | schema 加载不了：定义无法解析，名字或 OID 定义了两次 |
| `LDAPDecodeException`、`LDAPFilterSyntaxException`、`LDAPDNSyntaxException`、`LDAPLDIFSyntaxException` | 无法读取的字节、过滤器、DN 或 LDIF |

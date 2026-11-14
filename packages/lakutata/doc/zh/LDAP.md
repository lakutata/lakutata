# Lakutata LDAP

应用可以通过目录服务（OpenLDAP、Active Directory、389 Directory Server……）验证用户登录、读写目录，也可以提供自身的目录，供其他软件使用（SSSD、Keycloak、Gitea、Jenkins、Grafana、NAS 设备……）。这些功能由以下两个包实现：

- [`@lakutata/ldap-engine`](https://github.com/lakutata/lakutata/tree/main/packages/ldap-engine)，引擎：协议、客户端，以及由后端存放条目的服务器。引擎无需应用即可使用，详见 [LDAP Engine](LDAPEngine.md) 指南。
- [`@lakutata/ldap`](https://github.com/lakutata/lakutata/tree/main/packages/ldap)，组件：`LDAPClient`、`LDAPServer`，以及将服务器的条目存入应用数据库的 `DirectoryBackend`。该包重新导出了引擎。

本指南介绍组件：如何注册、如何注入，以及组件在引擎之上增加的功能。客户端和服务器本身的行为（分页、schema 检查、访问规则、密码策略、插件）见 LDAP Engine 指南，下文各节会指出对应的章节。`lakutata` 包不重新导出这两个包，因此请安装应用所用的包。

```shell
npm install @lakutata/ldap                     # 会一起安装引擎
npm install @lakutata/netif                    # 按网卡监听时需要
```

## 1. 用目录验证用户登录

`LDAPClient` 组件维护一个连接池，池中的连接以服务账号绑定。控制器或组件通过 `@Inject` 获取该组件；`authenticate()` 先查找用户的条目，再在一个单独的连接上以该用户的身份绑定。

```typescript
import {Application, DTO, Exception} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {POST} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {buildLDAPClientOptions, type LDAPClient} from '@lakutata/ldap'

class SignInDTO extends DTO {
    @Expect(DTO.String().required())
    public username: string

    @Expect(DTO.String().required())
    public password: string
}

class SignInRefusedException extends Exception {
    public errno: string = 'E_SIGN_IN_REFUSED'

    public statusCode: number = 401
}

class SessionController extends Controller {
    @Inject('ldap')
    protected readonly ldap: LDAPClient

    @POST('/sign-in', SignInDTO)
    public async signIn(input: SignInDTO): Promise<{dn: string, name?: string, mustChangePassword: boolean}> {
        const result = await this.ldap.authenticate({
            username: input.username,
            password: input.password,
            base: 'DC=example,DC=com',
            attribute: 'sAMAccountName',
            attributes: ['displayName']
        })
        if (!result.ok) {
            //原因只写进日志：告诉对方是账号被锁定还是密码错误，会帮到攻击者
            console.warn('sign-in refused', input.username, result.reason)
            throw new SignInRefusedException('Wrong user name or password')
        }
        return {dn: result.dn!, name: result.entry?.first('displayName'), mustChangePassword: result.mustChangePassword ?? false}
    }
}

Application.run(() => ({
    id: 'portal.app',
    name: 'Portal',
    components: {
        ldap: buildLDAPClientOptions({
            url: ['ldaps://dc1.example.com', 'ldaps://dc2.example.com'],
            bindDN: 'CN=svc-portal,OU=Service,DC=example,DC=com',
            password: process.env.LDAP_PASSWORD
        }),
        entrypoint: buildEntrypoints({
            controllers: [SessionController],
            http: expressHTTPEntrypoint({port: 8080})
        })
    },
    bootstrap: ['entrypoint']
}))
```

- 连接在首次操作时打开，随应用一起关闭。服务器列在 `url` 中，或通过 DNS SRV 记录查找（`srv: '_ldap._tcp.dc._msdcs.example.com'`），并依次尝试，直到成功连接其中一个（`url` 按其顺序，SRV 记录中的服务器按优先级和权重）。
- 空密码在发送之前即被拒绝，因为许多服务器会将带名称、不带密码的绑定视为匿名绑定并返回成功。
- `reason` 说明绑定失败的原因：`invalidCredentials`、`accountLocked`、`accountDisabled`、`passwordExpired`、`mustChangePassword` 等，取自 OpenLDAP 的密码策略控制或 Active Directory 的数据代码。`timeBeforeExpiration` 和 `graceAuthNsRemaining` 会在密码过期之前给出提醒。
- `authenticate()` 只通过 TLS（`ldaps` URL 或 `startTLS: true`）或本机的 `ldapi` 套接字发送用户的密码，除非设置了 `requireTLS: false`。
- `bindName` 不先搜索条目，而是直接以由用户名构造的名称绑定（Active Directory 可以使用 `alice@example.com`）。`authenticate()` 的其余内容见 LDAP Engine 第 4 节。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `url` | | 服务器的 LDAP URL，或者按顺序尝试的多个 URL |
| `srv` | | 给出服务器的 DNS SRV 记录，代替 `url` |
| `bindDN`、`password` | 匿名 | 连接池的身份 |
| `tls`、`startTLS` | | TLS 选项（`ca`、`cert`、`key`……），以及是否对 `ldap://` URL 的每个连接执行 StartTLS |
| `poolSize` | `4` | 连接池的最大连接数 |
| `connectTimeout`、`timeout`、`idleTimeout` | 5 秒、30 秒、10 分钟 | 建立连接、单个操作、空闲连接的时间 |
| `maxMessageSize`、`binaryAttributes` | 64 MiB | 服务器可发送的最大消息；值为字节的其他属性 |

## 2. 读写目录

组件提供 LDAP 连接的全部操作：`search()`、`searchIterator()`、`compare()`、`add()`、`modify()`、`delete()`、`modifyDN()`、`extended()`、`passwordModify()`、`whoAmI()`，以及 `readSchema()`。

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {type Entry, filter, type LDAPClient} from '@lakutata/ldap'

export class Staff extends Component {
    @Inject('ldap')
    protected readonly ldap: LDAPClient

    public async inDepartment(department: string): Promise<string[]> {
        const {entries} = await this.ldap.search('OU=Staff,DC=example,DC=com', {
            filter: filter`(&(objectClass=user)(department=${department}))`,
            attributes: ['sAMAccountName', 'mail']
        })
        return entries.map((entry: Entry) => entry.first('sAMAccountName')!)
    }

    public async rename(uid: string, mail: string): Promise<void> {
        const dn: string = `uid=${uid},ou=people,dc=example,dc=com`
        await this.ldap.modify(dn, [
            {operation: 'replace', attribute: 'mail', values: mail},
            {operation: 'add', attribute: 'telephoneNumber', values: '+86 10 1234 5678'}
        ])
        await this.ldap.passwordModify({userIdentity: dn, newPassword: 'new secret'})
    }
}
```

- 模板 `filter` 会转义写入其中的值，因此值无法改变过滤器的结构。
- 搜索默认分页（每页 500 个条目）；`searchIterator()` 逐个返回条目；`sort` 和 `window` 读取排序后条目中的一段。
- 结果不是成功时抛出对应的异常（`LDAPNoSuchObjectException`、`LDAPInsufficientAccessException`……）。
- 超过 `timeout` 的操作会在服务器上被放弃。连接池不再向该连接分配新的操作，待该连接上的操作结束后即将其关闭，之后的操作使用新的连接。
- `connect()` 返回一个不属于连接池的连接，该连接拥有独立的会话（用于以其他用户的身份绑定，或者执行 StartTLS）。
- 条目（文本和字节）、过滤器、DN、Active Directory 的值以及其他操作，见 LDAP Engine 第 2 到第 6 节。

## 3. 提供目录服务

`LDAPServer` 组件对外提供其后端中的条目。使用 `DirectoryBackend` 时，条目保存在应用的数据库中（PostgreSQL、MySQL 或 SQLite）。

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
                database: 'database',
                suffix: 'dc=example,dc=com',
                initialize: {admin: {dn: 'cn=admin,dc=example,dc=com', password: process.env.LDAP_ADMIN_PASSWORD!}}
            }],
            access: {admins: ['cn=admin,dc=example,dc=com']}
        })
    },
    bootstrap: ['database', 'ldap']
}))
```

- `initialize` 在首次启动时创建后缀对应的条目（根据后缀生成：`dc=example,dc=com` 对应 `dcObject` 和 `organization`）和管理员，且只创建一次，多个实例同时启动时也是如此。
- 服务器在 `port` 上监听 LDAP（默认 389；`0` 表示任选一个空闲端口，`false` 表示不监听），配置了 `tls` 时支持 StartTLS，并在 `ldapsPort` 上监听 LDAPS。`host` 指定监听的地址；安装了 `@lakutata/netif` 时，`interface: 'eth1'` 按网口监听，无论该网口当前使用什么地址。`ldap.ports` 给出实际监听的端口。
- `ldapiPath` 使服务器同时监听一个 Unix 套接字（ldapi），供本机的客户端使用，这些客户端可以不经过 TLS 在该套接字上发送密码。`ldapiMode` 决定谁可以连接（`0o666`：本机的所有用户；默认按通常的 umask，只有运行服务器进程的用户）。设置 `port: false`、只保留套接字时，只有本机的客户端能访问服务器。
- 与应用的其他实体一样，目录后端各表的迁移由应用管理：将 `directoryEntities(type)` 加入数据库的实体，再生成迁移。
- 其他选项即服务器引擎的选项（LDAP Engine 第 9、11 和 12 节）：`access`、`limits`、`bindThrottle`、`plaintextBind`、`passwords`、`passwordPolicy`、`sasl`、`extendedOperations`，以及根 DSE 的内容。

## 4. 在应用内使用目录

应用不经过网络，直接通过组件读写自身的目录：`connect()` 返回一个具备客户端全部操作的连接，其身份由调用方指定，无需绑定；`directory()` 在这样的连接上管理用户、组和组织单元。二者写入的内容所经过的 schema 检查、密码哈希和访问控制与网络请求完全相同。

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

    public async departmentOf(dn: string): Promise<string | undefined> {
        const {entries} = await this.ldap.connect('cn=admin,dc=example,dc=com').search(dn, {scope: 'base', attributes: ['departmentNumber']})
        return entries[0]?.first('departmentNumber')
    }
}
```

目录助手及其方法见 LDAP Engine 第 10 节。目录助手由 LDAP 操作组成，因此 `createDirectory(client)` 可以用同样的方式管理远程的 OpenLDAP，前提是目录助手的配置与该服务器的 schema 相符。`ldap.engine` 是服务器引擎本身，通过它可以获取引擎的 `events`（`bind`、`operation`、`error`……）和 schema。

## 5. Schema

系统 schema 始终会加载；组件的 `schema` 选项指定其他 schema：

```typescript
import {buildLDAPServerOptions, MemoryBackend} from '@lakutata/ldap'

const options = buildLDAPServerOptions({
    backends: [new MemoryBackend('dc=example,dc=com')],
    schema: {
        //除了 core、cosine 和 inetorgperson，再加上 POSIX 账号和组，以及 SSH 公钥
        bundled: ['core', 'cosine', 'inetorgperson', 'rfc2307bis', 'openssh-lpk'],
        //按文件名顺序加载一个目录里的 .ldif 和 .schema 文件
        directory: '/etc/directory/schema',
        files: ['/etc/directory/devices.ldif']
    }
})
```

- `bundled` 按名称指定自带的 schema：默认为 core、cosine 和 inetorgperson；rfc2307bis（POSIX 账号和组，供 SSSD 和 nslcd 使用）、openssh-lpk（SSH 公钥）和 ppolicy 需要列出名称才会加载，`[]` 表示不加载其中任何一个（系统 schema 始终加载）。密码策略会自行加载 ppolicy。
- `files` 添加自定义的 schema：可以是路径、文档（`parseSchemaFile()` 的结果，或从 `@lakutata/ldap/schemas` 导入的文档），也可以通过 `{name, text}` 直接给出文件的文本。文件可以是 OpenLDAP `cn=config` 的 LDIF、子模式条目，或者 `.schema` 格式。
- `directory` 在这些文件之前加载一个目录中的文件，文件名中的数字按数值排序（`cn={2}nis.ldif` 在 `cn={10}ppolicy.ldif` 之前，与 OpenLDAP 为文件编号的方式一致）。
- 名称或 OID 重复定义时，服务器在启动时即报错，并指出两处定义所在的文件。如果目录中也包含部分标准 schema 文件，请将这些文件从 `bundled` 中去掉（全部包含时设为 `[]`）；使用 OpenLDAP 的 nis.schema（RFC 2307）时，请去掉 rfc2307bis，因为两者的 OID 相同。
- `schemaConfigView: true` 会像 OpenLDAP 一样，在 `cn={N}<name>,cn=schema,cn=config` 下以只读方式展示这些文件；客户端从 `cn=Subschema` 读取 schema。
- 如需将 schema 文件作为文档编辑，或者在构建时预先转换，请参阅 LDAP Engine 第 7 节。

## 6. 访问和密码

`access`、`plaintextBind`、`bindThrottle` 和 `limits` 即引擎的规则（LDAP Engine 第 11 节）：默认情况下，匿名会话只能读取根 DSE 和子模式条目，已绑定的会话可以读取 `userPassword` 以外的目录内容，管理员可以写入，密码管理员可以修改其他人的密码。`passwords` 和 `passwordPolicy` 见引擎指南第 12 节：

```typescript
import {buildLDAPServerOptions, DirectoryBackend} from '@lakutata/ldap'

const options = buildLDAPServerOptions({
    backends: [{class: DirectoryBackend, database: 'database', suffix: 'dc=example,dc=com'}],
    access: {
        admins: ['cn=admin,dc=example,dc=com'],
        //Keycloak 的服务账号负责重置密码
        passwordAdmins: ['cn=keycloak,ou=services,dc=example,dc=com']
    },
    plaintextBind: 'loopback',
    passwordPolicy: {
        default: {lockout: true, maxFailure: 5, lockoutDuration: 900, maxAge: 7776000, expireWarning: 1209600, checkQuality: 2, minLength: 10, inHistory: 5},
        quality: (password: Buffer) => /\d/.test(password.toString()) || 'A password needs a digit'
    }
})
```

- 密码以 `{PBKDF2-SHA512}` 格式写入；绑定时也能校验 OpenLDAP 的其他格式，并重新哈希，因此从 OpenLDAP 导入的账号可以继续使用。
- 使用目录后端时，失败的绑定和密码策略的状态都保存在数据库中，应用的多个实例因而共享锁定和过期状态。两个实例在同一毫秒内、均尚未写入时各有一次绑定失败，可能记下相同的时间；目录后端只保存一个，因此这两次算作一次。

## 7. 目录后端

目录后端将一个后缀下的条目存入应用的数据库，无论这些条目属于什么对象类：一张条目表，每个值一行。

- 搜索在数据库中执行。过滤器会转换为 SQL，作用于匹配规则比较时所用的值的形式（相等、子串、整数和时间）；SQL 无法精确判断的部分由服务器检查。
- 排序搜索由后端完成，后端只读取窗口（`window`）内的条目：按偏移量取窗口时，数据库根据随每个值保存的排序键完成排序、计数和截取；否则后端读取排序键的值，按服务器的方式为条目排序。schema 修改某个属性的排序规则后，该属性之前写入的值仍保留旧的排序键，直到被重新写入为止。某个排序键没有值的条目排在其他条目之后，逆序时排在其他条目之前（RFC 2891）。设置了 `access.check` 且未将 `access.checkReads` 设为 false（不判断读取的检查可以如此设置），或者存在会从搜索结果中去掉条目的拦截器时，虚拟列表视图由服务器自行排序和开窗，受 `limits.sortCandidates` 限制，从而使其计数不包括会话不能读取的条目。
- 搜索返回的条目有固定的顺序：一个条目排在其下级条目之前，兄弟条目按添加顺序排列（entryUUID 是第 7 版 UUID；携带自身 entryUUID 导入的条目按该值确定位置）。排序键相同的条目保持这一顺序。
- DN 类型的值（member、manager、seeAlso……）指向对应的条目：条目改名时随之改变，条目删除时随之删除；必需的属性被删空时，保留一个占位值（默认为空 DN）。
- `memberOf` 在读取时计算，以其作为过滤条件可以找到一个组的成员（`nestedGroups` 会展开嵌套的组）。schema 自身定义了 memberOf 时，请使用 `memberOf: {name, oid}` 或 `memberOf: false`。
- POSIX：新增时没有 uidNumber 和 gidNumber 的条目会被分配所缺的编号（uidNumber 唯一，posixGroup 的 gidNumber 在各组之间唯一）；posixGroup 条目的 memberUid 通过计算得出。POSIX 的对象类来自 rfc2307bis，需要在 `schema.bundled` 中列出。
- `unique` 使属性的值在后缀内唯一。`authTimestamp` 给出最后一次成功的带密码绑定的时间，简单绑定和 SASL PLAIN 均计入（条目正被其他写操作占用时，绑定不会等待，此次的时间不会记录；在 SQLite 上，只要有写操作正在进行，就会出现这种情况；MySQL 8.0 之前和 MariaDB 10.6 之前的版本无法跳过被其他写操作占用的行，绑定会等待该写操作完成）。`mailAlias` 将 mail 的值作为 email 提供（Grafana 读取 email）。
- 每次写入都在一个事务中执行，拦截器的 `beforeCommit()` 也在该事务中执行。对同一条目的写入依次执行，多个实例共用一个数据库时也是如此（在 SQLite 上，对同一个文件的所有写入都依次执行），因此两个客户端同时修改同一属性的不同值时，双方的修改都会保留。
- `beforeCommit()` 通过使用同一个 Database 组件的服务器所做的搜索和写入，都在其所在的那次写入的事务中进行：这些搜索和写入能读到事务中已写入的内容；此次写入失败时，这些写入也一并撤销。此类搜索会先读完全部结果再返回。读取期间，该次写入的其他操作须等待读取完成，该次写入持有的锁也不会释放。结果较多时会占用大量内存；条数限制只限制返回的条数，不限制读取的条数。超过时间限制后，搜索停止读取，并以 timeLimitExceeded 失败，不返回任何条目。在 PostgreSQL 上，如果此类读取被数据库拒绝（例如语句超时），即使拦截器捕获了错误，那次写入也会失败。
- 写操作因死锁被数据库中止、因无法串行化被拒绝，或者等待锁超时（数据库设置了锁等待超时；SQLite 上则是文件被另一个进程占用超过 busy timeout）时，回应为 busy（51），且不会留下任何改动，客户端可以重新发送。
- MariaDB 服务器请配置为 `mariadb` 类型。配置为 `mysql` 时，后端原本使用共享锁的行（父条目、值所指的条目）会改用排他锁，此时在同一个父条目下添加条目、写入指向同一个条目的值，都须依次进行。
- 在 SQLite 上，`beforeCommit()` 通过另一个 Database 组件对同一个文件所做的写入会被拒绝（unwillingToPerform），因为该写入要等待的正是其所在的那次写入。此类写入请通过使用同一个 Database 组件的服务器完成。
- DN 值与其所指的条目同时写入时，要等两次写入都提交后，才将该值指向那个条目。这一步出错时，错误会作为服务器的 `error` 事件报告，组件会将其记入日志；写入本身已经完成。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `suffix` | | 顶层条目的 DN |
| `database` | | 应用的 Database 组件的名称（其在 `components` 中的键）；必填 |
| `groups` | groupOfNames、groupOfUniqueNames、groupOfMembers | 组的对象类及其成员属性 |
| `memberOf`、`nestedGroups`、`memberUid` | `true`、`0`、`true` | 虚拟属性 |
| `unique` | | 值必须唯一的属性 |
| `idAllocation` | 从 10000 开始 | 分配的第一个 uidNumber 和 gidNumber，或 `false` |
| `lastBind`、`mailAlias` | `true`、`false` | authTimestamp、email |
| `referencePlaceholder` | 空 DN | 必需的 DN 属性中，最后一个值所指的条目被删除后留下的占位值 |
| `sharedThrottle` | `true` | 将失败的绑定保存在数据库中 |
| `initialize` | | `root`、`ldif`、`admin`：首次启动时创建的内容 |

## 8. 插件、拦截器和后端

插件和拦截器即引擎的插件和拦截器（LDAP Engine 第 13 节：memberOf、引用完整性、唯一值、密码策略、审计、约束……）。组件既接受对象形式的插件和拦截器，也接受带选项的 Lakutata 类，后者由组件的容器创建：

```typescript
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'
import {AuditPlugin, buildLDAPServerOptions, ConstraintPlugin, DirectoryBackend, type InterceptorPlacement, type LDAPPlugin} from '@lakutata/ldap'

//给新增时没有部门的人员加上部门，部门来自插件的选项
export class DepartmentPlugin extends Component implements LDAPPlugin {
    @Configurable(DTO.String().required())
    protected readonly department: string

    public readonly name: string = 'department'

    public get interceptors(): InterceptorPlacement[] {
        return [{
            //放在 schema 步骤之前，加上的值也会经过检查
            before: 'schema',
            interceptor: {name: 'department', operations: ['add'], before: (context, request) => {
                if (request.type !== 'add') return
                const attributes = request.entry.attributes
                const named = (type: string) => attributes.find((attribute) => attribute.type.toLowerCase() === type.toLowerCase())
                const person: boolean = named('objectClass')?.values.some((value) => value.toString().toLowerCase() === 'inetorgperson') ?? false
                if (person && !named('departmentNumber')) attributes.push({type: 'departmentNumber', values: [Buffer.from(this.department)]})
            }}
        }]
    }
}

const options = buildLDAPServerOptions({
    backends: [{class: DirectoryBackend, database: 'database', suffix: 'dc=example,dc=com'}],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    plugins: [
        new ConstraintPlugin({rules: [{attribute: 'mail', pattern: /@example\.com$/}]}),
        new AuditPlugin({write: (record) => console.log(record.operation, record.dn, record.resultCode)}),
        {class: DepartmentPlugin, department: 'R&D'}
    ]
})
```

- 插件类继承 `Component` 并实现 `LDAPPlugin`，其选项通过 `@Configurable` 声明，还可以注入应用的组件（数据库、日志……）。
- 目录后端在每次写入的事务中自行完成 `MemberOfPlugin`、`ReferentialIntegrityPlugin`、`IdAllocationPlugin` 和 `LastBindPlugin` 的工作。因此，这些插件会退出该后端的处理链，其他插件则照常为该后端运行。
- `interceptors` 只接受拦截器：对象、放置方式，或者带选项的 Lakutata 类。
- 自定义的后端（LDAP Engine 第 14 节）可以是对象，也可以是带选项的 Lakutata 类，例如 `{class: DevicesBackend, suffix: 'ou=devices,dc=example,dc=com'}`。后者由组件的容器创建，因此可以注入应用的组件，包括数据库。多个后端可以提供多个后缀。

## 9. 接入其他软件

- **SSSD 和 nslcd**：服务器加载 rfc2307bis（需要 SSH 公钥时再加载 openssh-lpk），二者均在 `schema.bundled` 中列出，SSSD 和 nslcd 使用 `ldap_schema = rfc2307bis`。组按 `member` 查找，memberUid 供 `rfc2307` 模式使用。SSSD 每次绑定都会发送密码策略控制，服务器会回应该控制。在同一台机器上时，SSSD 和 nslcd 连接 `ldapiPath` 的 Unix 套接字（SSSD 2.9 及以上），SSSD 会不经过 TLS 在该套接字上发送密码。SSSD 2.10 及以上版本默认会启动 TLS，而该套接字不需要 TLS：

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

  `ldapiMode` 必须允许运行 SSSD 的用户连接。经过网络连接时，请为服务器配置 `tls`，并将签发服务器证书的 CA 提供给 SSSD（`ldap_tls_cacert`）。
- **Keycloak**：用户联合选择厂商“Other”，用户名和 RDN 使用 `uid`，UUID 属性使用 `entryUUID`，并开启“Use password modify extended operation”。组映射器使用 `groupOfNames` 和 `member`。Keycloak 的服务账号需要加入 `access.passwordAdmins` 才能设置密码。
- **Gitea**：添加一个 LDAP 认证源（via BindDN），用户过滤器为 `(&(objectClass=inetOrgPerson)(uid=%s))`；管理员过滤器基于 memberOf；SSH 公钥位于 `sshPublicKey` 中（服务器需要加载 openssh-lpk）。
- **Grafana**：`mailAlias: true` 提供 Grafana 默认读取的 `email`。

## 10. 单独使用引擎

在 Lakutata 应用之外，`@lakutata/ldap-engine` 以函数的形式提供同样的客户端和服务器：`createLDAPClient()`、`connectLDAP()` 和 `createLDAPServer()`。[LDAP Engine](LDAPEngine.md) 指南介绍了这些函数。

## 11. 运行平台

Node.js `>=18.10.0`、Bun、Electron 和 NW.js。引擎不包含原生代码。目录后端运行在 `lakutata/orm` 的数据库上，在 Electron 和 Bun 中需要满足各驱动的要求（[数据库驱动](DatabaseDrivers.md)）。Bun 无法加载 better-sqlite3，因此在 Bun 中可以使用 `sqljs`、PostgreSQL 或 MySQL。

## 异常

组件抛出的异常即引擎的异常（LDAP Engine 第 17 节）：结果不是成功时，抛出以结果码命名的 `LDAPResultException` 子类（`LDAPInvalidCredentialsException`、`LDAPNoSuchObjectException`……）；连接断开时抛出 `LDAPConnectionException`；操作超时时抛出 `LDAPTimeoutException`；schema 无法加载时，服务器在启动时即以 `LDAPSchemaException` 报错。

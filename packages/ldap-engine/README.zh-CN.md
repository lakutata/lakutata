# @lakutata/ldap-engine

[English](README.md) | 中文

Node.js 的 LDAP 库，用 TypeScript 编写，属于 [lakutata](https://github.com/lakutata/lakutata) 框架，没有原生代码，也没有任何依赖。它包含协议本身（LDAPv3 的消息和控制项、DN、搜索过滤器、schema 和 LDIF）、一个客户端和一个服务器。它不需要应用；把 LDAP 接入 lakutata 应用的组件在 `@lakutata/ldap` 里。

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

- `createLDAPClient()` 返回一个连接池，池里的连接都以同一个身份绑定。操作需要连接时它才打开连接，按顺序尝试各个服务器（或 DNS SRV 记录给出的服务器），并关闭空闲的连接。如果某个连接上的服务器没有按时回应，或者回应的内容无法读取，这个连接就不再接新的操作，等它上面的操作结束后关闭。
- `connectLDAP()` 打开单独一个连接（`ldap://`、`ldaps://`、`ldapi://`、StartTLS），用于独立的会话。它的操作可以传 `timeout` 和 `signal`；搜索或写操作超时后，客户端会在服务器上放弃（abandon）这个操作，连接继续可用。绑定或 StartTLS 超时则会关闭连接。
- 搜索默认分页（每页 500 条），除非传 `paged: false`，这样服务器对单个请求的条数限制不会把结果截断；`searchIterator()` 逐条给出条目，循环提前结束时会通知服务器结束分页。`sort` 加上 `window` 可以读取排序后条目中的一段（虚拟列表视图）；这两个控制项都标为关键，服务器排不了序或给不了窗口时搜索会失败，而不是返回全部条目。Active Directory 分段返回的值（`member;range=0-1499`）会一直读到最后。
- 条目用 `get()` 读文本，用 `getBuffers()` 读字节；对值是字节的属性（`jpegPhoto`、`objectGUID` 等）调用 `get()` 会抛出异常，字节不会被转成乱码文本。
- `authenticate()` 先找到用户的条目，再在单独的连接上以该用户身份绑定：空密码在发送任何请求之前就被拒绝；绑定失败时，结果会说明原因（`invalidCredentials`、`accountLocked`、`passwordExpired` 等），原因来自密码策略控制项或 Active Directory 的 data 代码。它只通过 TLS（`ldaps` URL 或 `startTLS`）或本机的 `ldapi` 套接字发送密码，除非设置 `requireTLS: false`。
- 结果不是成功时会抛出对应的异常：`LDAPNoSuchObjectException`、`LDAPInvalidCredentialsException` 等。
- `readSchema()` 读取服务器发布的 schema。`guidToString()`、`sidToString()`、`parseUserAccountControl()`、`fileTimeToDate()` 和 `changeADPassword()` 用于处理 Active Directory 的数据。

### 服务器

```typescript
import {readFileSync} from 'node:fs'
import {createDirectory, createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'

const server = createLDAPServer({
    backends: [new MemoryBackend('dc=example,dc=com')],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    tls: {cert: readFileSync('server.crt'), key: readFileSync('server.key')}
})

const directory = createDirectory(server.connect({as: 'cn=admin,dc=example,dc=com'}))
await directory.add('dc=example,dc=com', {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
const people = await directory.createOrganizationalUnit('dc=example,dc=com', {ou: 'people'})
await directory.createUser(people, {uid: 'alice', cn: 'Alice Liu', sn: 'Liu', mail: 'alice@example.com'}, 'secret')

await server.listen({port: 389})
await server.listen({port: 636, secure: true})
await server.listen({path: '/run/directory/ldapi', mode: 0o666})
```

- `createLDAPServer()` 提供各个后端里的条目，每个后端挂在自己的后缀上。后端负责存取条目（`get()`、`search()`、它支持的写操作，以及不读条目就能判断条目是否存在时的 `exists()`），其余都由服务器负责：协议、StartTLS 和 LDAPS、每次写入时的 schema 校验、密码、访问控制、各种上限、rootDSE 和 subschema；后端自己不做排序、虚拟列表视图和分页时，也由服务器来做（自己排序的后端用 `sortSearchItems()` 给代表条目的轻量数据排序和取窗口，规则和服务器相同）。`MemoryBackend` 把条目放在内存里；`createHandlerBackend()` 用 ldapjs 服务器那种按操作写处理函数的方式生成一个后端。
- schema：系统 schema（操作属性和目录自身的对象类）总是加载，然后按顺序加载 `schema` 选项列出的 schema，默认是 `@lakutata/ldap-engine/schemas` 里的 `DEFAULTS`，即 core、cosine 和 inetOrgPerson 这几套几乎所有服务器都有的 RFC schema。其余自带的 schema 需要时再加上（`[...DEFAULTS, RFC2307BIS]`）：rfc2307bis 用于 POSIX 账号和组，openssh-lpk 用于 SSH 公钥，ppolicy 用于密码策略（密码策略插件会自己加载它）。自己的 schema 可以是从文件读出的文档（`readSchemaFile()`，或用 `readSchemaDirectory()` 按文件名顺序读取一个目录），也可以直接给文件的文本。名字或 OID 重复定义时，服务器在启动时就会报错。
- `server.connect({as})` 返回一个进程内连接，操作和客户端一样：应用不经过网络读写自己的目录，经过的 schema 校验、密码哈希和访问控制都和网络请求相同。不调用 `listen()` 也能用。
- `listen({path})` 监听 Unix socket（ldapi），给同一台机器上的客户端用：SSSD 2.9 及以后、nslcd、OpenLDAP 的命令行工具（`ldapi://%2Frun%2Fdirectory%2Fldapi`）。这种连接不会离开本机，所以服务器像对待 TLS 一样接受从这里发来的密码，也会在这里提供 SASL PLAIN。EXTERNAL 仍然只在 TLS 上提供，因为服务器无法知道对端进程是以哪个用户运行的。`mode` 决定谁能连接（`0o666`：本机的所有用户；默认按 umask 决定，通常只有服务器进程所属的用户）。服务器停止后留下的 socket 文件会被替换。Windows 上不支持 Unix socket。
- `createDirectory()` 用 LDAP 操作管理用户、组和组织单元，可以用在任何连接上：进程内连接、客户端，或者远程的 OpenLDAP，只要 profile 和那台服务器的 schema 对得上。
- 密码以 `{PBKDF2-SHA512}` 写入，格式和 OpenLDAP 的 pw-pbkdf2 模块相同；绑定时也能验证 OpenLDAP 的其他格式（`{SSHA}`、SHA-2 系列、`{CRYPT}`，以及 node:crypto 能运行 argon2 时的 `{ARGON2}`：Node.js 24.7 及以后可以，Electron 不行），验证成功后再按服务器的格式重新哈希。任何人都读不到 `userPassword`。
- 默认情况下，匿名会话只能读 rootDSE 和 subschema，已绑定的会话可以读整个目录，`access.admins` 里的管理员可以写；给了 `access.check` 时先由它决定。同一个 DN 或同一个地址连续绑定失败时，响应会被放慢，之后锁定一段时间，所有失败一律返回 invalidCredentials。
- 密码策略按 draft-behera-ldap-password-policy 实现（`passwordPolicy`，一个插件），和 OpenLDAP 的 ppolicy 用同一套属性：有一条默认策略（pwdPolicy 条目的 DN，或者直接给出规则），用户的 pwdPolicySubentry 可以换成别的策略；连续失败太多次就锁定账号，有过期、过期前提醒和宽限登录，管理员重置后必须先改密码，新密码有最短修改间隔、长度、复杂度（可以加自己的检查）和历史的限制。状态保存在条目的操作属性里（pwdChangedTime、pwdAccountLockedTime 等），所以任何后端都能保存。账号被锁定时默认和密码错误一样回答，除非设置 `revealLocked`。
- 后端可以带上它计算的属性所需的 schema 文件、自己的拦截器、多个实例共用的绑定限速存储（它的 `update()` 一步改完一个状态，同时发生的几次绑定失败各算一次）、`transaction()`（拦截器的 `beforeCommit()` 和写操作在同一个事务里执行），以及 `lock()`（引擎在这个事务里锁住条目后重新读取它，按读到的内容重新算出修改或改名的改动并检查）。

### 插件

插件像 OpenLDAP 的 overlay 一样，给服务器加上一个扩展需要的东西。它的拦截器在后端的操作外面运行代码：在请求之前、包住请求、对搜索返回的每个条目，或者在写操作提交之前，排在服务器自带的步骤（`access`、`password`、`schema`、`operational`、`paging`）之前或之后。插件还可以包住每一个请求（`aroundRequest`：包括绑定、扩展操作，以及服务器自己回答的搜索），包住密码的验证（`authenticate`），在密码还是明文时检查密码的修改（`passwordChange`）。插件可以带上 schema 文件、控制项、扩展操作、SASL 机制和密码格式，由 rootDSE 和 subschema 公布出去。两个插件认领同一个 OID，或者对同一个名字给出不同的定义时，服务器在启动时就会报错。

```typescript
import {createLDAPServer, MemberOfPlugin, MemoryBackend, ReferentialIntegrityPlugin, UniquePlugin} from '@lakutata/ldap-engine'

const server = createLDAPServer({
    backends: [new MemoryBackend('dc=example,dc=com')],
    plugins: [new MemberOfPlugin(), new ReferentialIntegrityPlugin(), new UniquePlugin({attributes: ['uid', 'mail']})]
})
```

| 插件 | 作用 | 对应 OpenLDAP 的 |
|---|---|---|
| `MemberOfPlugin` | 维护组成员的 memberOf | memberof |
| `ReferentialIntegrityPlugin` | 条目删除、改名或移动时，修改值里的 DN | refint |
| `UniquePlugin` | 拒绝和别的条目重复的值 | unique |
| `PasswordPolicyPlugin` | 密码策略，`passwordPolicy` 选项给出的也是它 | ppolicy |
| `IdAllocationPlugin` | 给新增时没有 uidNumber、gidNumber 的 POSIX 条目分配编号 | 389 Directory Server 的 DNA |
| `LastBindPlugin` | 把最后一次绑定的时间记在 authTimestamp 里 | lastbind |
| `SambaPasswordPlugin` | 把新密码的 NT 哈希写进 sambaNTPassword（需要加载 Samba 的 schema） | smbk5pwd |
| `AuditPlugin` | 把每个请求及其结果的记录交给自己写的函数 | accesslog、auditlog |
| `ConstraintPlugin` | 拒绝违反规则的值：格式、大小、个数，或者自己写的检查 | constraint |
| `GroupPresentationPlugin` | 像 lldap 那样，让每个组同时以 groupOfNames 和 groupOfUniqueNames 呈现 | |

- 插件可以是任何符合 `LDAPPlugin` 形状的对象。上面这些插件都继承 `BaseLDAPPlugin`，它提供名字和后缀（`{name, suffixes}`：同一个插件配两份，或者只对部分后端生效）。想改变某个插件的做法，就继承它。
- `server.start()` 调用各插件的 `start()`；`listen()` 会先调用它。
- 插件用 `context.server.connect({internal: true})` 读写目录：这些操作照样经过处理链和 schema 校验，访问控制放行。
- 插件只维护同一个后端里的关系，和 OpenLDAP 的 overlay 只管一个数据库一样：组和它的成员、条目和指向它的值、要保持唯一的值，都要在同一个后端里。
- 在修改之后还要写入的插件（memberOf、引用、最后绑定时间）都在修改完成后再写，和 OpenLDAP 的 overlay 一样。后端自己就做这些事时会声明出来，插件就不进它的处理链：`@lakutata/ldap` 的目录后端在数据库里计算 memberOf、维护引用、分配编号、记录最后绑定时间，都在写操作的事务里完成。
- `interceptors` 选项可以单独给出拦截器，相当于只有拦截器的插件。

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
- `Filter` 用来构造搜索过滤器、解析过滤器文本（RFC 4515）并把过滤器写成文本；模板 `filter` 会转义写进去的值，所以值无法改变过滤器的结构。`matchFilter()` 按 RFC 4511 的三值逻辑（真、假、未定义）对一个条目求过滤器的值。近似匹配（`~=`）按相等处理，只有“名字加可选 UID”（uniqueMember）例外：它只比较名字，不管 UID，和 OpenLDAP 的 uniqueMemberMatch 做近似匹配时一样。
- 控制项（分页、排序、虚拟列表视图、树删除、密码策略、读取条目、代理授权、持久搜索、内容同步等）和扩展操作的值（改密码、Who Am I、Cancel）都有编解码；`Ber` 和 `BerReader` 用来自己读写 BER。
- `DN` 解析 DN（RFC 4514），把它转义后写回，并按规范化后的形式比较。
- `Schema` 加载 schema：文档，或 schema 文件的文本（OpenLDAP 的 `cn=config` LDIF、subschema 条目，或 `.schema` 格式）。它拒绝重复定义的名字或 OID，能列出定义里引用了却没有定义的东西，并给出每一处所在的文件和行（`problems()`），还提供 RFC 4517 中比较属性值的匹配规则。
- `parseSchemaFile()` 把一个 schema 文件转成文档：其中的定义都是普通对象，带着各自的注释和行号，可以原样经过 JSON 序列化。`stringifySchemaFile()` 把文档写回文件，没改动的定义保持原来的写法，这正是做 schema 文件编辑器所需要的。自带的 schema 也是文档（`@lakutata/ldap-engine/schemas` 里的 `CORE` 等），import 进来就能用，不用解析文本。
- `parseLDIF()` 和 `stringifyLDIF()` 读写 LDIF（RFC 2849），包括条目和变更，每条记录前面的注释也会保留。

```typescript
import {DN, Filter, matchFilter, Schema} from '@lakutata/ldap-engine'

const schema: Schema = new Schema().load([
    'attributetype ( 2.5.4.41 NAME \'name\' EQUALITY caseIgnoreMatch SUBSTR caseIgnoreSubstringsMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )',
    'attributetype ( 2.5.4.3 NAME ( \'cn\' \'commonName\' ) SUP name )'
].join('\n'), 'my.schema')

console.log(DN.parse('CN=Alice, DC=Example').equals('commonName=alice,dc=example', schema))
console.log(matchFilter(Filter.parse('(name=ali*)'), {attributes: [{type: 'cn', values: [Buffer.from('Alice')]}]}, schema))
```

读入一个 schema 文件，修改后写回，再和自带的 schema 一起加载：

```typescript
import {readFileSync, writeFileSync} from 'node:fs'
import {parseSchemaFile, Schema, type SchemaDocument, stringifySchemaFile} from '@lakutata/ldap-engine'
import {CORE, SYSTEM} from '@lakutata/ldap-engine/schemas'

const devices: SchemaDocument = parseSchemaFile(readFileSync('devices.ldif', 'utf8'), 'devices')
const device = devices.objectClasses[0]
device.may = [...device.may ?? [], 'description']
writeFileSync('devices.ldif', stringifySchemaFile(devices))

const schema: Schema = new Schema().load(SYSTEM).load(CORE).load(devices)
for (const problem of schema.problems()) console.log(`${problem.source}:${problem.line} ${problem.message}`)
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
| `createLDAPServer(options)`、`LDAPServerEngine` | 服务器：`listen()`、`handleConnection()`、`attach()`、`connect()`、`start()`、`close()`，以及它的 `events` |
| `LDAPInProcessConnection` | 进程内连接 |
| `LDAPBackend`、`DirectoryEntry`、`OperationContext`、`SearchContext` 等 | 后端接口 |
| `MemoryBackend`、`createHandlerBackend(options)` | 现成的后端 |
| `sortSearchItems(items, valuesOf, context, schema)`、`sortWindowRange(context, count)`、`sortOrderingOf(attribute, schema)` | 给自己排序的后端用的排序和窗口：在内存里排，或者按窗口的范围和每个键的规则在数据库里排 |
| `LDAPPlugin`、`LDAPPluginHost`、`PluginControl`、`PasswordChange`、`BaseLDAPPlugin` | 插件 |
| `MemberOfPlugin`、`ReferentialIntegrityPlugin`、`UniquePlugin`、`PasswordPolicyPlugin`、`IdAllocationPlugin`、`LastBindPlugin`、`SambaPasswordPlugin`、`AuditPlugin`、`ConstraintPlugin`、`GroupPresentationPlugin` | 现成的插件 |
| `LDAPInterceptor`、`InterceptorPlacement`、`ServerRequest` 等 | 拦截器 |
| `AccessOptions`、`ServerLimits`、`BindThrottleOptions` | 访问规则、各种上限、绑定限速 |
| `PasswordSchemes`、`PasswordScheme` | 密码存储格式 |
| `PasswordPolicyOptions`、`PasswordPolicyRules`、`rulesOfEntry(entry, schema)` | 密码策略 |
| `plainMechanism()`、`externalMechanism()`、`SASLMechanism` | SASL |
| `createDirectory(connection, options)`、`Directory`、`DirectoryProfile` | 目录助手 |
| `parseSchemaFile(text, name)`、`stringifySchemaFile(document)`、`SchemaDocument` | schema 文件和文档之间的转换 |
| `readSchemaFile(path)`、`readSchemaDirectory(directory)` | 把一个 schema 文件、或一个目录里的文件按文件名顺序读成文档（文件名里的数字按数值比较） |
| `encodeMessage(message)`、`decodeMessage(bytes)` | 把消息编码成字节，或从字节解码 |
| `MessageReader` | 读取数据流里的消息 |
| `Filter`、`filter`、`escapeFilterValue(value)`、`matchFilter(filter, entry, schema)` | 过滤器：构造、文本、转义模板、求值 |
| `PagedResultsControl`、`SortRequestControl`、`VLVRequestControl`、`PasswordPolicyResponseControl` 等，`findControl()` | 控制项的编解码 |
| `ExtendedOperation`、`PasswordModifyRequest`、`PasswordModifyResponse`、`WhoAmIResponse`、`CancelRequest`、`SyncInfo` | 扩展操作的 OID 和值 |
| `Ber`、`BerReader`、`isUTF8(bytes)` | 读写 BER，用来自己写编解码；判断字节是否为 UTF-8 |
| `DN`、`RDN`、`escapeDNValue(value)` | DN |
| `Schema`、`parseAttributeType()`、`parseObjectClass()` 等，`parseGeneralizedTime()`、`formatGeneralizedTime()` | schema、schema 定义、时间 |
| `parseLDIF(text)`、`stringifyLDIF(records)` | LDIF，保留每条记录前面的注释 |
| `ResultCode`、`resultCodeName(code)` | 结果码和它们的名字 |
| `LDAPMessage`、`ProtocolOp`、`LDAPRequest`、`LDAPResponse`、`LDAPResult`、`Control`，以及各种操作、过滤器、控制项和记录的类型 | 相关的类型 |
| `LDAPException` 及其子类 | 这个包的异常（见[错误](#错误)） |

自带的 schema 由 `@lakutata/ldap-engine/schemas` 导出（`@lakutata/ldap/schemas` 也一样）：

| 导出 | 说明 |
|---|---|
| `SYSTEM`、`CORE`、`COSINE`、`INETORGPERSON`、`RFC2307BIS`、`OPENSSH_LPK`、`PPOLICY` | 自带的 schema，以文档形式提供 |
| `DEFAULTS`、`DEFAULT_NAMES`、`BUNDLED`、`BUNDLED_NAMES`、`bundledSchema(names)` | 服务器默认加载的 schema（core、cosine、inetorgperson）、按名字取自带的 schema、由它们组成的 `Schema` |

## 错误

| 异常 | 什么时候 |
|---|---|
| `LDAPDecodeException` | 消息无法解码；数据流无法继续时 `fatal` 为 true，否则带有它的 `messageId` 和 `operation`；如果错在操作本身的编码而不是某个取值，`malformed` 为 true（服务器会因此结束会话） |
| `LDAPFilterSyntaxException` | 过滤器文本不合法，`position` 是出错的位置 |
| `LDAPDNSyntaxException` | DN 文本不合法，`position` 是出错的位置 |
| `LDAPSchemaException` | schema 定义无法解析、名字或 OID 重复定义，或引用了没有定义的内容 |
| `LDAPLDIFSyntaxException` | LDIF 文本无法解析，`line` 是出错的行 |
| `LDAPResultException` 及其子类（`LDAPNoSuchObjectException`、`LDAPInvalidCredentialsException`、`LDAPSizeLimitExceededException` 等） | 结果不是成功，带有 `code`、`matchedDN`、`diagnosticMessage`，以及 Active Directory 的 `adDataCode` |
| `LDAPConnectionException` | 连接无法打开，或在还有操作等待时关闭了 |
| `LDAPTimeoutException` | 操作超过了它的 `timeout` |
| `LDAPUsageException` | 客户端在发送任何请求之前就拒绝的调用（空密码、读取值是字节的属性的文本等） |
| `LDAPException` | 以上所有异常的基类，带有 `errno` |

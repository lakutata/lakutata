# Lakutata LDAP 引擎

`@lakutata/ldap-engine` 包是以 TypeScript 编写的 Node.js LDAP 库，包括三个部分：访问目录服务（OpenLDAP、Active Directory、389 Directory Server、FreeIPA……）的客户端；一个服务器，其条目由后端存放，存放位置由后端决定；以及客户端和服务器共同使用的协议层。该包不属于 `lakutata`，也无需应用即可使用。其特点如下：

- **客户端**：搜索自动分页，文本和字节分开读取，空密码在发送之前即被拒绝；用户登录失败时，客户端会说明原因（密码错误、账号被锁定、密码过期……）。
- **服务器**：协议、TLS、schema 检查、密码、访问控制和密码策略都由服务器自行完成，后端只负责存放条目。
- **进程内连接**：程序可以不经过网络读写自身的服务器，所经过的检查与网络请求完全相同。
- **各部分可以单独使用**：过滤器、DN、schema、LDIF 和 LDAPv3 的消息可以用于导入账号的脚本、schema 文件编辑器或代理程序。
- **没有依赖，也没有原生代码**：支持 Node.js `>=18.10.0`、Bun、Electron 和 NW.js。

`@lakutata/ldap-engine` 的 README 列出了所有导出；本指南按用途逐一说明该包的功能，并为每种用途给出一个示例。在 Lakutata 应用中，`@lakutata/ldap` 将客户端和服务器包装为组件（见 [LDAP](LDAP.md)），组件的行为即本指南所描述的行为。

```bash
npm install @lakutata/ldap-engine
```

## 1. 连接服务器

`connectLDAP()` 打开一个连接，该连接拥有独立的会话：连接绑定所用的身份保留到下一次绑定为止。

```typescript
import {connectLDAP, type LDAPClientConnection} from '@lakutata/ldap-engine'

const connection: LDAPClientConnection = await connectLDAP({
    url: 'ldaps://ldap.example.com',
    tls: {ca: process.env.LDAP_CA},
    timeout: 10000
})
try {
    await connection.bind('uid=alice,ou=people,dc=example,dc=com', 'secret')
    console.log(await connection.whoAmI()) //dn:uid=alice,ou=people,dc=example,dc=com
} finally {
    await connection.close()
}
```

- URL 决定连接方式：`ldap://`（普通 TCP）、`ldaps://`（从一开始即使用 TLS），或者 `ldapi://` 加上转义后的 Unix 套接字路径（`ldapi://%2Frun%2Fdirectory%2Fldapi`）。`startTLS: true` 会在发送任何内容之前将 `ldap://` 连接升级为 TLS；如需稍后升级，可以调用 `connection.startTLS()`。证书校验所用的名称默认为 URL 中的主机名，可以通过 `tls.servername` 指定其他名称。
- 每个操作都可以传入 `timeout`（默认使用连接的设置，30 秒）和 `signal`。搜索或写操作超时后，该操作会在服务器上被放弃（abandon），连接仍可继续使用。绑定或 StartTLS 超时则会关闭连接，因为此时已无法确定会话的状态。建立连接的时间最长为 `connectTimeout`（5 秒）。
- 带名称、密码为空的 `bind()` 在发送之前即被拒绝，因为许多服务器会将此类绑定视为匿名绑定并返回成功。`saslBind(mechanism, credentials, {step})` 以 SASL 方式绑定，由 `step` 回应服务器的每一次质询。
- `close()` 结束会话，仍在等待的操作会被拒绝。空闲的连接不会阻止进程退出。
- 服务器发来的消息最大为 `maxMessageSize` 字节（64 MiB）；超过该大小的消息会直接结束连接，而不会持续占用内存。

## 2. 搜索

```typescript
import {connectLDAP, filter} from '@lakutata/ldap-engine'

const connection = await connectLDAP('ldap://ldap.example.com')
const department: string = 'R&D (Beijing)'
const {entries, truncated} = await connection.search('ou=people,dc=example,dc=com', {
    scope: 'one',
    filter: filter`(&(objectClass=inetOrgPerson)(departmentNumber=${department}))`,
    attributes: ['uid', 'cn', 'mail', 'jpegPhoto'],
    sizeLimit: 1000
})
for (const entry of entries) console.log(entry.dn, entry.first('mail'), entry.getBuffers('jpegPhoto')[0]?.length)
console.log(truncated) //超过 1000 个时为 true

for await (const group of connection.searchIterator('dc=example,dc=com', {filter: '(objectClass=groupOfNames)', attributes: ['cn', 'member']})) {
    console.log(group.first('cn'), group.get('member').length)
    if (group.first('cn') === 'staff') break
}
await connection.close()
```

- `scope` 可以是 `'base'`、`'one'`、`'sub'`（默认）或 `'children'`。`filter` 可以是过滤器的文本，也可以是 `Filter`（第 6 节）；模板 `filter` 会转义写入其中的值，因此值无法改变过滤器的结构。
- 搜索默认分页，每页 500 个条目（`paged: {pageSize}` 修改每页大小，`paged: false` 关闭分页），因此服务器对单次请求的条数限制不会截断结果。只读取一个条目的搜索（`scope: 'base'`）不分页；`sizeLimit` 不大于每页大小的搜索也不分页。
- `sizeLimit` 限制搜索保留的条目数：超出的条目均会被丢弃，无论服务器在此处停止还是继续发送，此时 `truncated` 为 true。如果搜索未设置 `sizeLimit`，而服务器有自身的条数限制，搜索会抛出 `LDAPSizeLimitExceededException`，已收到的条目位于该异常的 `partial` 中。
- 分页没有进展时（某一页没有任何条目，返回的 cookie 却与上一页相同；或者连续一百页都没有条目），搜索会抛出 `LDAPProtocolErrorException`，而不会无休止地分页。
- `searchIterator()` 逐页读取，逐个返回条目；提前退出循环时，会通知服务器结束分页。
- `sort` 和 `window` 读取排序后条目中的一段（虚拟列表视图）：`{sort: [{attribute: 'cn'}], window: {offset: 1, limit: 20}}`，结果中的 `total` 为整个列表的条目数。这两个控制均作为关键（critical）控制发送，因此不支持排序的服务器会使搜索失败，而不是返回未经排序的全部条目。窗口超出最后一个条目时，不返回任何条目，但仍会给出 `total`。
- 结果中的 `references` 是服务器返回的引用，客户端不会跟随这些引用。

`Entry` 以文本或字节的形式返回值，二者不会混用：

| 方法 | 返回内容 |
|---|---|
| `entry.dn` | DN，保持服务器给出的写法 |
| `get(name)`、`first(name)` | 以文本形式返回的值，或其中的第一个；对值为字节的属性会抛出异常 |
| `getBuffers(name)` | 以字节形式返回的值 |
| `has(name)`、`names()`、`isBinary(name)` | 是否包含某个属性、所有属性名、某个属性的值是否为字节 |
| `toObject()`、`toJSON()` | 以对象形式返回属性（字节为 `Buffer`），以及以 JSON 形式返回属性（字节为 base64） |

值为字节的属性包括：已知存放字节的属性（`jpegPhoto`、`userCertificate`、Active Directory 的 `objectGUID` 和 `objectSid`……）、带 `;binary` 选项的属性、`binaryAttributes` 中列出的属性；连接上设置了服务器的 schema 时（第 7 节），语法为二进制的属性也包括在内。属性名不区分大小写，但须与服务器的写法一致：`cn` 不等于 `commonName`，也不等于 `cn;lang-en`。

## 3. 写入

```typescript
import {connectLDAP, LDAPEntryAlreadyExistsException, TreeDeleteControl} from '@lakutata/ldap-engine'

const connection = await connectLDAP('ldaps://ldap.example.com')
await connection.bind('cn=admin,dc=example,dc=com', process.env.LDAP_ADMIN_PASSWORD!)
try {
    await connection.add('uid=bob,ou=people,dc=example,dc=com', {objectClass: 'inetOrgPerson', uid: 'bob', cn: 'Bob Chen', sn: 'Chen', description: 'Contractor'})
} catch (error) {
    if (!(error instanceof LDAPEntryAlreadyExistsException)) throw error
}
await connection.modify('uid=bob,ou=people,dc=example,dc=com', [
    {operation: 'replace', attribute: 'mail', values: 'bob.chen@example.com'},
    {operation: 'add', attribute: 'telephoneNumber', values: ['+86 10 1234 5678', '+86 10 8765 4321']},
    {operation: 'delete', attribute: 'description'}
])
console.log(await connection.compare('uid=bob,ou=people,dc=example,dc=com', 'sn', 'Chen')) //true
await connection.modifyDN('uid=bob,ou=people,dc=example,dc=com', 'uid=bob.chen', {newSuperior: 'ou=staff,dc=example,dc=com'})
const generated: string | undefined = await connection.passwordModify({userIdentity: 'uid=bob.chen,ou=staff,dc=example,dc=com'})
console.log(generated) //服务器生成的密码
//用树删除控制删除整个子树
await connection.delete('ou=former,dc=example,dc=com', {controls: [TreeDeleteControl.encode(undefined, true)]})
await connection.close()
```

- `add()` 的属性可以是一个对象（每个属性对应一个值或一组值），也可以是 `{type, values}` 的列表。值可以是文本（以 UTF-8 写入）、字节、数字或布尔值（写为 `TRUE` 和 `FALSE`）。
- 修改分为 `add`、`delete`（删除给出的值，未给出值时删除整个属性）、`replace` 和 `increment` 四种。
- `passwordModify()` 通过 RFC 3062 的扩展操作修改密码：默认修改当前绑定用户的密码，`userIdentity` 可以指定其他用户；新密码为 `newPassword`，未给出时由服务器生成并返回。
- `extended(name, value)` 执行其他扩展操作；每个操作都可以携带 `controls`，控制由各自的编解码器生成（`TreeDeleteControl`、`AssertionControl`、`PostReadRequestControl`、`ProxiedAuthorizationControl`……）。
- 结果不是成功时，抛出 `LDAPResultException` 的子类，其类名与结果码对应（`LDAPNoSuchObjectException`、`LDAPInsufficientAccessException`……），并带有 `code`、`matchedDN` 和 `diagnosticMessage`。

## 4. 连接池与用户登录

`createLDAPClient()` 返回一个连接池，池中的连接均以同一个身份绑定，适用于同时执行大量操作的服务。

```typescript
import {createLDAPClient, type LDAPPool} from '@lakutata/ldap-engine'

const client: LDAPPool = createLDAPClient({
    url: ['ldaps://ldap1.example.com', 'ldaps://ldap2.example.com'],
    bindDN: 'cn=portal,ou=services,dc=example,dc=com',
    password: process.env.LDAP_PASSWORD,
    poolSize: 8
})

export async function signIn(username: string, password: string): Promise<string | undefined> {
    const result = await client.authenticate({username: username, password: password, base: 'ou=people,dc=example,dc=com'})
    if (result.ok) {
        if (result.timeBeforeExpiration) console.log(`The password expires in ${result.timeBeforeExpiration} seconds`)
        return result.dn
    }
    console.log(result.reason) //invalidCredentials、accountLocked、passwordExpired、mustChangePassword……
    return undefined
}
```

- 操作需要连接、而现有连接均处于忙碌状态时，连接池才会打开新连接，最多 `poolSize` 个（默认 4 个）；每个操作交由最空闲的连接执行；空闲超过 `idleTimeout`（10 分钟）的连接会被关闭。分页搜索的所有页都在同一个连接上执行。
- 各个服务器按顺序尝试，直到成功连接其中一个；也可以通过 DNS SRV 记录查找服务器（`srv: '_ldap._tcp.example.com'`）。
- 如果某个连接上的服务器未能按时回应，或者回应的内容无法读取，该连接便不再接受新的操作，待该连接上的操作结束后即关闭，之后的操作会打开新的连接。
- 连接池提供单个连接的全部操作；`bind()` 修改连接池的身份，`connect()` 返回一个不属于连接池的连接，`close()` 关闭所有连接。
- `authenticate()` 先查找用户的条目（默认按 `uid` 查找，也可以使用给出的 `attribute` 或 `filter`），再在一个单独的连接上以该用户的身份绑定，因此连接池的身份不会改变。`bindName` 不经过搜索，而是直接以由用户名构造的名称绑定（Active Directory 可以使用 ``(name) => `${name}@example.com` ``）。
- 结果会说明绑定失败的原因：`invalidCredentials`、`accountLocked`、`accountDisabled`、`accountExpired`、`passwordExpired`、`mustChangePassword` 等。这些原因取自 OpenLDAP 的密码策略控制或 Active Directory 的数据代码，比结果码更为具体。`timeBeforeExpiration` 和 `graceAuthNsRemaining` 会在密码过期之前给出提醒。
- `authenticate()` 只通过 TLS（`ldaps` URL 或 `startTLS: true`）或本机的 `ldapi` 套接字发送密码；服务器位于本机时，可以通过该方法的 `requireTLS: false` 允许其他连接方式。

## 5. Active Directory

```typescript
import {changeADPassword, connectLDAP, fileTimeToDate, guidToString, parseUserAccountControl, sidToString} from '@lakutata/ldap-engine'

const connection = await connectLDAP('ldaps://dc1.example.com')
await connection.bind('alice@example.com', 'old secret')
const {entries: [user]} = await connection.search('DC=example,DC=com', {
    filter: '(sAMAccountName=alice)',
    attributes: ['objectGUID', 'objectSid', 'userAccountControl', 'pwdLastSet', 'memberOf']
})
console.log(guidToString(user.getBuffers('objectGUID')[0]), sidToString(user.getBuffers('objectSid')[0]))
console.log(parseUserAccountControl(user.first('userAccountControl')!).accountDisable, fileTimeToDate(user.first('pwdLastSet')!))
console.log(user.get('memberOf').length) //所有的组，不管有多少：分段返回的值会一直读到最后
await changeADPassword(connection, user.dn, 'old secret', 'new secret')
await connection.close()
```

- Active Directory 接受以用户主体名（`alice@example.com`）或 DN 绑定。
- `guidToString()` 和 `sidToString()` 给出 objectGUID（前几段按小端序，与 Active Directory 的显示方式一致）和 objectSid 的文本形式；`stringToGuid()` 和 `stringToSid()` 执行相反的转换，用于按这两个属性过滤。
- `parseUserAccountControl()` 按名称给出 userAccountControl 的各个标志（`accountDisable`、`lockout`、`dontExpirePassword`……）；`fileTimeToDate()` 将 FILETIME（pwdLastSet、lastLogon、accountExpires）转换为日期，值表示“从不”时返回 `undefined`。
- 大型属性（例如大型组的 member）的值分段返回（`member;range=0-1499`）：默认会读取到最后一段，`ranges: false` 则不读取后续的分段。
- `changeADPassword()` 凭旧密码修改用户自身的密码；`resetADPassword()` 以管理员身份设置密码。Active Directory 只在 TLS（LDAPS 或 StartTLS）上接受这两种操作，并且会检查其密码策略。

## 6. 过滤器和 DN

```typescript
import {DN, escapeDNValue, Filter, filter, matchFilter} from '@lakutata/ldap-engine'

const name: string = 'Smith, John (*)'
console.log(Filter.stringify(filter`(cn=${name})`)) //(cn=Smith, John \28\2a\29)
const built: Filter = Filter.and(Filter.equal('objectClass', 'person'), Filter.not(Filter.present('mail')))
console.log(Filter.stringify(built)) //(&(objectClass=person)(!(mail=*)))
const parsed: Filter = Filter.parse('(|(uid=al*)(mail=*@example.com))')
console.log(matchFilter(parsed, {attributes: [{type: 'uid', values: [Buffer.from('alice')]}]})) //true

const dn: DN = DN.parse('CN=Smith\\, John,OU=People,DC=Example,DC=Com')
console.log(dn.rdn()?.get('cn'), dn.parent()?.toString(), dn.isDescendantOf('dc=example,dc=com')) //Smith, John OU=People,DC=Example,DC=Com true
console.log(DN.parse('ou=people,dc=example,dc=com').child(`cn=${escapeDNValue('Smith, John')}`).toString()) //cn=Smith\, John,ou=people,dc=example,dc=com
```

- `Filter` 用于构造过滤器（`and`、`or`、`not`、`equal`、`greaterOrEqual`、`lessOrEqual`、`approx`、`present`、`substrings`、`extensible`），通过 `parse()` 读取过滤器的文本（RFC 4515），通过 `stringify()` 写出文本。模板 `filter` 由过滤器的文本和写入其中的值构造过滤器，每个值都会被转义。
- `matchFilter()` 按 RFC 4511 的三值逻辑在条目上求过滤器的值：`true`、`false`，或者无法判断时的 `undefined`。给出 `Schema` 时，按属性的匹配规则比较值（大小写、空格、子类型）；未给出时，按不区分大小写的文本比较。
- `DN.parse()` 读取 DN（RFC 4514），`toString()` 写出转义后的 DN。`equals()`、`isDescendantOf()` 和 `isChildOf()` 按规范化后的形式比较 DN（有 schema 时，`CN=Alice` 与 `commonName=alice` 是同一个名称）；`rdn()`、`parent()` 和 `child()` 用于在树中移动。`escapeDNValue()` 转义写入 DN 的值。

## 7. Schema

schema 决定一个条目可以包含的内容：条目的对象类、这些对象类必需和允许的属性，以及值的语法和用于比较值的匹配规则。

```typescript
import {connectLDAP, readSchema, type Schema} from '@lakutata/ldap-engine'

const connection = await connectLDAP('ldap://ldap.example.com')
const schema: Schema = await readSchema(connection)
console.log(schema.attributesOf(['inetOrgPerson']).must) //[ 'sn', 'cn', 'objectClass' ]
console.log(schema.isSingleValued('displayName'), schema.isBinary('jpegPhoto'), schema.equality('mail')?.names[0]) //true true caseIgnoreIA5Match
await connection.close()
```

- `readSchema()` 读取服务器公布的 schema（即服务器的子模式条目）。将该 schema 传给 `connectLDAP({schema})` 后，条目即可得知哪些属性的值为字节。
- `new Schema().load()` 加载 schema 文件：OpenLDAP `cn=config` 的 LDIF、子模式条目，或者 `.schema` 格式。名称或 OID 重复定义时，会抛出 `LDAPSchemaException`，并指出两处定义所在的文件；`problems()` 列出定义中引用了但未定义的名称，并给出其所在的文件和行号。
- `@lakutata/ldap-engine/schemas` 以文档形式导出自带的 schema：`SYSTEM`（操作属性和目录自身的对象类）；`CORE`、`COSINE` 和 `INETORGPERSON`，即几乎所有服务器都具备的 `DEFAULTS`；`RFC2307BIS`（POSIX 账号和组）；`OPENSSH_LPK`（SSH 公钥）；`PPOLICY`（密码策略）。`bundledSchema(names)` 返回由这些 schema 组成的 `Schema`。

schema 文件也可以作为数据处理：`parseSchemaFile()`（或 `readSchemaFile(path)`）将 schema 文件转换为文档，文档中的定义都是普通对象，带有各自的注释和行号；`stringifySchemaFile()` 将文档写回文件，未改动的定义保持原有的写法。schema 文件编辑器修改的正是这一文档；加载自身 schema 的程序，也可以在构建时预先转换文件，直接 import 文档。

```typescript
import {readFileSync, writeFileSync} from 'node:fs'
import {parseSchemaFile, Schema, type SchemaDocument, stringifySchemaFile} from '@lakutata/ldap-engine'
import {DEFAULTS, SYSTEM} from '@lakutata/ldap-engine/schemas'

const devices: SchemaDocument = parseSchemaFile(readFileSync('devices.ldif', 'utf8'), 'devices')
const device = devices.objectClasses.find((objectClass) => objectClass.names.includes('device'))!
device.may = [...device.may ?? [], 'description']
writeFileSync('devices.ldif', stringifySchemaFile(devices))

const schema: Schema = new Schema().load(SYSTEM)
for (const document of DEFAULTS) schema.load(document)
schema.load(devices)
for (const problem of schema.problems()) console.log(`${problem.source}:${problem.line} ${problem.message}`)
```

## 8. LDIF

`parseLDIF()` 读取 LDIF（RFC 2849），包括条目和要执行的修改。`stringifyLDIF()` 写出 LDIF，长行会被折行，非纯文本的值写为 base64。

```typescript
import {type LDIFRecord, parseLDIF, stringifyLDIF} from '@lakutata/ldap-engine'

const records: LDIFRecord[] = parseLDIF(`version: 1

# The new people
dn: uid=carol,ou=people,dc=example,dc=com
changetype: add
objectClass: inetOrgPerson
uid: carol
cn: Carol Wang
sn: Wang

dn: uid=bob,ou=people,dc=example,dc=com
changetype: modify
replace: mail
mail: bob@example.com
-
`)
for (const record of records) console.log(record.changeType, record.dn, record.comments) //add uid=carol,… [ ' The new people' ]，然后是 modify uid=bob,… undefined
console.log(stringifyLDIF(records))
```

- 每条记录是一个条目（`content`）或一个修改（`add`、`delete`、`modify`、`modifyDN`），带有记录所在的行号和记录之前的注释，`stringifyLDIF()` 会将这些注释写回。
- `parseLDIF(text, {readURL})` 读取以 URL 给出的值（`jpegPhoto:< file:///photos/carol.jpg`）；未给出 `readURL` 时，读取此类值会抛出异常。
- 目录助手（第 10 节）可以将 LDIF 导入目录，也可以将一个子树导出为 LDIF。

## 9. 服务器

`createLDAPServer()` 对外提供其后端中的条目，每个后端挂载在各自的后缀上。后端只负责存放条目，其余工作均由服务器完成：协议、StartTLS 和 LDAPS、每次写入时的 schema 检查、密码、访问控制、各种限制、根 DSE 和子模式条目，以及后端自身不做的排序、虚拟列表视图和分页。

```typescript
import {readFileSync} from 'node:fs'
import {createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'
import {DEFAULTS, RFC2307BIS} from '@lakutata/ldap-engine/schemas'

const server = createLDAPServer({
    backends: [new MemoryBackend('dc=example,dc=com')],
    schema: [...DEFAULTS, RFC2307BIS],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    tls: {cert: readFileSync('server.crt'), key: readFileSync('server.key')}
})
server.events.on('operation', ({operation, dn, resultCode, duration}) => console.log(operation, dn, resultCode, `${duration} ms`))

console.log(await server.listen({port: 389})) //389；服务器配置了 tls，所以这个端口支持 StartTLS
await server.listen({port: 636, secure: true})
await server.listen({path: '/run/directory/ldapi', mode: 0o666})

process.on('SIGTERM', () => void server.close())
```

- `listen()` 在一个端口（`0` 表示任选一个空闲端口，并返回该端口）和地址（`host`）上监听 LDAP；`secure: true` 时监听 LDAPS；给出 `path` 时监听 Unix 套接字（ldapi）。一个服务器可以多次监听。`attach(server)` 和 `handleConnection(socket)` 用于处理在其他位置创建的 `net.Server` 上的连接。
- Unix 套接字供本机的客户端使用（SSSD 2.9 及以上、nslcd、OpenLDAP 的命令行工具）。这类连接不会离开本机，因此服务器像对待 TLS 一样在套接字上接受密码，并提供 SASL PLAIN。`mode` 决定谁可以连接（`0o666`：本机的所有用户；默认按通常的 umask，只有运行服务器进程的用户）。已停止的服务器留下的套接字会被替换。在 Windows 上，服务器不监听 Unix 套接字。
- schema：始终先加载系统 schema，然后按顺序加载 `schema` 选项列出的 schema，默认为 `DEFAULTS`。自定义的 schema 可以是文档（`readSchemaFile()`；或者通过 `readSchemaDirectory()` 按文件名顺序读取一个目录中的文件），也可以直接给出文件的文本。名称或 OID 重复定义时，服务器在启动时即报错。
- `MemoryBackend` 将条目保存在内存中，适用于测试和小型服务器。自定义后端见第 14 节；`@lakutata/ldap` 的 `DirectoryBackend` 将条目存入应用的数据库。
- 排序遵循 RFC 2891：某个排序键没有值的条目排在其他条目之后，逆序时排在其他条目之前；有多个值时取最小值（逆序时取最大值）。排序键的属性不在 schema 中时，排序响应给出 noSuchAttribute；带排序的分页搜索每一页都带有排序响应。
- 虚拟列表视图遵循 draft-ietf-ldapext-ldapv3-vlv-09：偏移量按服务器的条目数折算；偏移量小于 1 或超出最后一个条目时，搜索以 virtualListViewError 失败，视图的结果为 offsetRangeError；服务器不发送 context ID，因此收到的 context ID 一律拒绝。
- 请求带选项的属性（`description;lang-en`）时，返回带有这些选项的属性；`binary` 是传输选项，不参与比较。按值的范围请求属性时（`member;range=0-1`，从 0 起算，与 Active Directory 的分段读取相同），返回该范围内的值，属性描述带上这一范围；范围包括最后一个值时，结尾写作 `*`；起点超出最后一个值时，不返回该属性。一个属性最多返回一次：同时按名称或通过 `*` 请求同一属性时，返回整个属性，不再带范围。从空 DN 开始的单层或子树搜索以 noSuchObject 回答；根 DSE 通过 scope 为 base 的搜索读取。
- 服务器不解引用别名：服务器读取 `derefAliases`，并按原样返回别名条目。服务器接受 ManageDsaIT：内置的后端不保存引用（referral）条目，因此该控制对内置后端不改变任何行为；自定义的后端如果给出引用，可以在 `context.controls` 中看到该控制。
- `events`：`connection`、`disconnect`、`bind`、`bindFailure`、`operation`（操作、操作的 DN、结果码和以毫秒计的耗时）、`startTLS`、`connectionError`，以及后端或拦截器出现不属于结果码的错误时的 `error`。
- `close()` 停止监听，以 Notice of Disconnection 结束各个会话，并停止插件。

## 10. 程序自己的连接

`server.connect({as})` 返回一个进程内的连接，该连接以给出的 DN 的身份绑定，具备客户端的全部操作。该连接无需 `listen()`，不经过网络，所经过的 schema 检查、密码哈希和访问控制与网络请求完全相同。`createDirectory()` 通过 LDAP 操作管理用户、组和组织单元，可以用于任何连接。

```typescript
import {createDirectory, createLDAPServer, type Directory, MemoryBackend} from '@lakutata/ldap-engine'

const server = createLDAPServer({backends: [new MemoryBackend('dc=example,dc=com')], access: {admins: ['cn=admin,dc=example,dc=com']}})
const directory: Directory = createDirectory(server.connect({as: 'cn=admin,dc=example,dc=com'}))

await directory.add('dc=example,dc=com', {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
const people: string = await directory.createOrganizationalUnit('dc=example,dc=com', {ou: 'people'})
const groups: string = await directory.createOrganizationalUnit('dc=example,dc=com', {ou: 'groups'})
const alice: string = await directory.createUser(people, {uid: 'alice', cn: 'Alice Liu', sn: 'Liu', mail: 'alice@example.com'}, 'secret')
const staff: string = await directory.createGroup(groups, {cn: 'staff'})
await directory.addMember(staff, alice)

console.log(await directory.verifyPassword(alice, 'secret')) //true
console.log(await directory.groupsOf('dc=example,dc=com', alice)) //[ 'cn=staff,ou=groups,dc=example,dc=com' ]
console.log(await directory.exportLDIF(people))
```

- 目录助手提供 `add()`、`createUser()`（连同密码一起创建，密码由服务器哈希）、`createOrganizationalUnit()`、`createGroup()`、`addMember()`、`removeMember()`、`groupsOf()`、`setPassword()`、`verifyPassword()`、`move()`、`rename()`、`delete()`（`{subtree: true}` 删除整个子树）、`find()`、`importLDIF()` 和 `exportLDIF()`。
- 目录助手的默认配置如下：用户为 `inetOrgPerson`，以 `uid` 命名；组为 `groupOfNames`，以 `cn` 命名（组中尚无成员时，以空 DN 占位）；组织单元为 `organizationalUnit`。`createDirectory(connection, {profile})` 可以换用另一套配置，以管理使用自身对象类的目录。
- 用于第 1 节或第 4 节的客户端时，目录助手能以同样的方式管理远程目录（例如 OpenLDAP）。
- `server.connect({internal: true})` 是服务器自身的代码（插件）所用的连接：该连接上的操作会经过 schema 检查，访问控制则直接放行。

## 11. 谁能做什么

| 谁 | 可以做什么 |
|---|---|
| 匿名会话 | 读取根 DSE 和子模式条目（`access.anonymousRead: true` 允许匿名会话读取目录） |
| 已绑定的会话 | 读取目录，但 `userPassword` 除外，任何人都无法读取该属性；修改自身的密码（`access.authenticatedRead: false` 禁止已绑定的会话读取目录） |
| 管理员（`access.admins`） | 写入，以及修改任何人的密码；在 `access.adminPasswords` 中配置了口令时，以该口令绑定，无论是否有条目 |
| 密码管理员（`access.passwordAdmins`） | 修改其他人的密码，但不能修改管理员和其他密码管理员的密码。适用于 Keycloak、Nextcloud 等软件的服务账号 |

```typescript
import {createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'

const WRITES: string[] = ['add', 'modify', 'delete', 'modifyDN']

const server = createLDAPServer({
    backends: [new MemoryBackend('dc=example,dc=com')],
    access: {
        admins: ['cn=admin,dc=example,dc=com'],
        //服务台只能写 people 下的条目，别的都不能写
        check: (request) => request.identity?.equals('cn=helpdesk,dc=example,dc=com') && WRITES.includes(request.operation)
            ? request.dn.isDescendantOf('ou=people,dc=example,dc=com')
            : undefined
    },
    plaintextBind: 'loopback',
    limits: {sizeLimit: 1000}
})
await server.listen({port: 389})
```

- `access.adminPasswords` 按 DN 给出管理员的口令，明文或哈希（`{SCHEME}`）均可，类似 OpenLDAP 的 rootdn 和 rootpw，但更为严格：此类管理员的简单绑定或 SASL PLAIN 绑定只接受该口令，无论目录中是否存在该管理员的条目（OpenLDAP 的 back-mdb 在 rootpw 不匹配时，还会接受条目中的 userPassword）。这样，管理员的凭据便不会存放在其所管辖的数据中。条目中的 userPassword 和插件在绑定时所做的检查（例如密码策略）对此类管理员不起作用，绑定限速则照常生效。不依靠密码确定身份的 SASL 机制（例如使用客户端证书的 SASL EXTERNAL，或者应用自行编写的同类机制）不校验此口令。对此类管理员执行 Password Modify 会被拒绝，并回应 unwillingToPerform；如需更改口令，请修改配置。允许直接写入条目中的 userPassword，但这不会改变配置中的口令。值以 `{…}` 开头、而服务器没有其中所指的格式时，服务器拒绝启动；因此，以 `{…}` 开头的明文口令须先哈希再配置。不带 `{SCHEME}` 前缀的 crypt 或 argon2 哈希（例如 bcrypt 库直接返回的 `$2b$…`），或者 `{SCHEME}` 之前有空白的值，同样会使服务器拒绝启动；请写为 `{CRYPT}$2b$…`。服务器无法校验的值（格式错误的哈希、DES 的 `{CRYPT}`）不会阻止启动，但相应的管理员将永远无法绑定，因此配置之后请实际绑定一次以确认。在 node:crypto 无法运行 argon2 的环境中（Node.js 24.7 之前、Electron），服务器自带格式的 `{ARGON2}` 值会使服务器拒绝启动。同一个 DN 配置了两次（大小写或空格不同）时，服务器同样拒绝启动。
- `access.check` 最先判断：返回 `true` 表示允许，`false` 表示拒绝，`undefined` 表示交由上表的规则决定。该检查收到的信息包括：操作（搜索返回的内容和比较读取的条目为 `read`）、DN、会话的身份，以及已知时的条目或属性。改名时，该检查会被询问三次：先以 `modifyDN` 询问原来的条目；再以 `modifyDN` 询问条目的新 DN（`from` 给出原来的 DN），因此只允许在某个条目之下写入的检查，也会拒绝将条目移出该子树；最后以 `modify` 询问新 RDN 写入值的属性，以及设置了 deleteOldRDN 时旧 RDN 去掉值的属性，正如 OpenLDAP 要求对前者有添加权限、对后者有删除权限。RDN 不变的移动不写入任何属性，也不会被询问第三次。对会话不能读取的条目执行比较时，按条目不存在回答。
- 设置了 `access.check` 时，搜索会按后端存储的内容对每个条目询问 `read`，此时服务器尚未加上其计算出的操作属性，插件也尚未改动条目。会话不能读取的条目在分页、开窗和计数之前即被去掉，因此每一页和虚拟列表视图中只包含会话能读取的条目，总数也只计入这些条目。此时，即使后端能够完成，虚拟列表视图也由服务器自行排序和开窗，并受 `limits.sortCandidates` 限制。自定义拦截器向搜索结果中加入的条目，或者以新对象返回的条目，会在整条链运行完毕后再检查一次，此时条目已带有后续步骤加上的内容。
- 不判断读取的检查（例如只判断写操作的检查）应将 `access.checkReads` 设为 false。设置后，服务器不再以 `read` 询问该检查，会话能读取的内容由上表决定，后端照常排序、开窗和分页，与未设置检查时相同。设置 `checkReads: false` 后，上表不允许读取的会话所发起的搜索会以 insufficientAccessRights 被拒绝，即使检查允许该搜索。
- 只搜索基准本身（scope 为 `base`）而会话不能读取该基准时，服务器按基准不存在回答。任何操作的回答中，matched DN 都只给出会话能读取的条目。搜索基准之下的条目时，仍会返回会话能读取的条目，因此回答会表明基准存在。如需隐藏一个条目是否存在，请拒绝对该条目的 DN 执行 `search`：此类搜索无论条目是否存在，都以 insufficientAccessRights 拒绝。
- 绑定会结束该连接上的分页搜索，被拒绝的绑定也是如此。
- `plaintextBind` 规定在何处可以不经过 TLS 接受密码（简单绑定或 SASL PLAIN 绑定、写入 `userPassword`、Password Modify）：任何地方（`'all'`，默认）、仅限本机回环地址（`'loopback'`），或者任何地方都不接受（`'none'`）。Unix 套接字不受该选项限制，始终接受密码。凭据中带有密码的自定义 SASL 机制需要设置 `takesPassword`；设置后，在 `plaintextBind` 不接受密码的地方，服务器不会提供该机制。
- 带名称、密码为空的绑定会被拒绝（`allowUnauthenticatedBind` 会将此类绑定作为匿名绑定接受）。同一个 DN 或地址的失败绑定，回应会越来越慢，之后在一段时间内被直接拒绝（`bindThrottle`）；这些情况均回应 invalidCredentials，无法从回应中区分账号被锁定还是密码错误。
- `limits`：对于非管理员的会话，每次搜索最多 500 个条目、3600 秒，并限制过滤器的深度和大小；对于所有会话，限制消息的大小、未完成的请求数、连接数和空闲时间。分页搜索的条数限制按所有页的总数计算：达到限制后，如果会话仍有能读取的条目，搜索以 sizeLimitExceeded 结束。对于非管理员的会话，可以通过 `pagedSizeLimit` 为分页搜索单独设置一个限制（未设置时等于 `sizeLimit`，0 表示不限制）。服务器在内存中最多排序 `sortCandidates` 个条目（默认 10000），后端自行完成的排序不受此限制。超过该数量时，只要排序控制或虚拟列表视图控制中有一个是关键控制，搜索就以 unavailableCriticalExtension 被拒绝（引擎自带的客户端使用 `window` 时将两者都作为关键控制发送，只排序时不作为关键控制）；否则返回全部条目，既不排序也不开窗，排序的响应控制中带有 adminLimitExceeded（RFC 2891）。

## 12. 密码和密码策略

服务器收到的每个密码都会被哈希为 `{PBKDF2-SHA512}`（OpenLDAP 的 pw-pbkdf2 模块所用的格式；`passwords: {iterations}` 调整迭代次数）。绑定时也能校验 OpenLDAP 的其他格式（`{SSHA}`、SHA-2 系列、使用 MD5、SHA-256、SHA-512 和 bcrypt 的 `{CRYPT}`，以及 node:crypto 支持 argon2 时的 `{ARGON2}`：Node.js 24.7 及以上，Electron 不支持），还能校验旧目录中的明文密码，校验通过后再以服务器的格式重新哈希（`rehashOnBind`）。管理员可以直接写入带 `{SCHEME}` 前缀的哈希值，用于导入账号。不带前缀、形式完整的常见 crypt 或 argon2 哈希会被拒绝，因为哈希串本身会成为密码。其他形式的裸哈希仍按明文处理，因此导入时务必带上 `{SCHEME}`。开启 `rehashOnBind` 时，格式与服务器不同的值会在首次绑定成功时被替换，因为只有此时才能得到明文密码。只有条目中仍是该值时才会替换；发现该值已被修改或删除时，不写入任何内容。提供了 `transaction()` 和 `lock()` 的后端（例如 @lakutata/ldap 的目录后端）会先锁定条目，再判断和替换；其他后端在写入之前重新读取一次该值。如需保留导入的哈希（例如应用自身也要校验的那一份），请关闭 `rehashOnBind`；应用也可以通过 `PasswordSchemes.register()` 注册自定义的格式（例如原生的 bcrypt），再将这组格式交给服务器。格式的名称只能包含字母、数字、`.` 和 `-`，`register()` 会拒绝其他名称。以服务器已有的名称注册的格式，会替换服务器自带的同名格式。如需由原生库校验 `{CRYPT}` 中的 bcrypt 值，请以 `CRYPT` 为名称注册，并将所注册的格式不处理的值转交给被替换的格式（注册之前通过 `schemeOf('{CRYPT}')` 取得）：`$1$`、`$5$`、`$6$`，以及 npm 上的 `bcrypt` 包不接受的 `$2y$`。其他用户写入的值，即使看起来像哈希，也按明文密码处理。修改操作删除以明文给出的密码时（修改密码时给出的旧密码），只有在会话修改自身的条目时才与存储的密码比对；如需修改他人的密码，请使用 replace。绑定的 DN 位于某个后端的后缀之下、却没有条目，或者条目中没有密码时，服务器仍会以自身格式的一个哈希校验一次，与密码错误时相同。自行实现了 `bind()` 的后端自行决定这一点。

`passwordPolicy` 实现 draft-behera 的密码策略，所用的属性与 OpenLDAP 的 ppolicy 相同：

```typescript
import {createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'

const server = createLDAPServer({
    backends: [new MemoryBackend('dc=example,dc=com')],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    passwordPolicy: {
        //也可以是一个 pwdPolicy 条目的 DN；用户的 pwdPolicySubentry 可以指定另一个
        default: {lockout: true, maxFailure: 5, lockoutDuration: 900, maxAge: 7776000, expireWarning: 1209600, graceAuthNLimit: 3, minLength: 10, checkQuality: 2, inHistory: 5, mustChange: true},
        quality: (password: Buffer) => /\d/.test(password.toString()) || 'A password needs a digit'
    }
})
await server.listen({port: 389})
```

- 失败次数过多时锁定账号，锁定一段时间，或者直到管理员设置新密码为止；长期未使用的账号也会被锁定（`maxIdle`）。
- 密码会过期（`maxAge`），过期前会发出提醒（`expireWarning`），过期后仍允许绑定若干次（`graceAuthNLimit`）。在同一个实例内，同时到达的绑定不会多用宽限次数：每次绑定先写入、再计数，发现超过上限的那一次绑定会被拒绝，并撤回自身的记录。只剩最后一次宽限绑定时，同时到达的几次绑定可能全部被拒绝，此时这一次宽限绑定仍然可用。
- 管理员设置密码后，用户必须先修改密码，才能执行其他操作（`mustChange`），但可以先执行 StartTLS，以便通过 TLS 修改；修改写入之后，该限制才会解除；在同一个连接上重新绑定时，会重新判断。
- 受策略约束的条目只能有一个密码：写入后会留下两个密码的操作会被拒绝。
- 策略的请求控制可以随任何请求发送（draft-behera §6.1），包括对根 DSE 的搜索；策略需要给出信息时，响应中会带上策略的响应控制。
- 新密码的要求：修改时必须给出旧密码（`safeModify`），两次修改之间须间隔一段时间（`minAge`），并且不能与以前用过的密码相同（`inHistory`）；长度（`minLength`、`maxLength`）和 `quality` 检查在 `checkQuality` 为 1（管理员导入的哈希值可以通过）或 2（始终检查）时生效，与 pwdCheckQuality 的规定一致。
- 策略的状态保存在条目的操作属性中（pwdChangedTime、pwdAccountLockedTime、pwdFailureTime……），因此任何后端都能保存该状态。每次绑定失败都会计数，同时发生的多次失败也是如此。共用一个后端的两个实例在同一毫秒内、均尚未写入时各有一次失败，可能得到相同的时间；此时算作一次还是两次，取决于后端如何处理已有的值。发送密码策略控制的客户端会在回应中收到提醒和原因；账号被锁定时，回应与密码错误时相同，除非设置了 `revealLocked`。密码已校验通过、之后绑定又被拦截器或插件拒绝时，该次绑定不算成功：失败记录保留，不写入 pwdLastSuccess，绑定限速的计数不清零，也不发送提醒。有两件事照常发生：已计入的宽限绑定不退回；`rehashOnBind` 应改写的密码仍会改写。只有绑定成功，才会记录最后绑定时间。密码策略自身拒绝已过期、宽限次数也已用完的密码时则不同：按 draft-behera §8.1.2.1，密码校验通过后即先清除失败记录，然后才判断是否过期。
- 密码策略是一个插件：该选项会在其他插件之后加上一个 `PasswordPolicyPlugin`，该插件会自行加载 ppolicy schema。

## 13. 插件和拦截器

插件为服务器增加的功能，相当于 OpenLDAP 的 overlay 为 slapd 增加的功能：在操作前后运行的代码，以及这些代码所需的 schema、控制和扩展操作。

| 插件 | 作用 | 相当于 OpenLDAP 的 |
|---|---|---|
| `MemberOfPlugin` | 维护组成员的 memberOf | memberof |
| `ReferentialIntegrityPlugin` | 条目被删除、改名或移动时，修改其他条目中指向该条目的 DN 值 | refint |
| `UniquePlugin` | 拒绝其他条目已使用的值 | unique |
| `PasswordPolicyPlugin` | 第 12 节的密码策略 | ppolicy |
| `IdAllocationPlugin` | 为新增时没有 uidNumber 和 gidNumber 的 POSIX 条目分配这两个值 | （389 Directory Server 的 DNA） |
| `LastBindPlugin` | 在 authTimestamp 中记录最后一次成功的密码绑定的时间 | lastbind |
| `SambaPasswordPlugin` | 将新密码的 NT 哈希写入 sambaNTPassword（需要加载 Samba 的 schema） | smbk5pwd |
| `AuditPlugin` | 将每个请求及其结果交给自定义的函数记录 | accesslog、auditlog |
| `ConstraintPlugin` | 拒绝违反规则的值：模式、大小、个数，或者自定义的检查 | constraint |
| `GroupPresentationPlugin` | 每个组同时显示为 groupOfNames 和 groupOfUniqueNames，供只识别其中一种的客户端使用 | |

自定义插件继承 `BaseLDAPPlugin`（也可以是任何符合 `LDAPPlugin` 结构的对象）。插件的拦截器在后端的操作前后运行：

```typescript
import {AuditPlugin, BaseLDAPPlugin, createLDAPServer, type InterceptorPlacement, MemberOfPlugin, MemoryBackend, UniquePlugin} from '@lakutata/ldap-engine'

//给新增时没有部门的人员加上部门
class DepartmentPlugin extends BaseLDAPPlugin {
    constructor(protected readonly department: string) {
        super('department')
    }

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

const server = createLDAPServer({
    backends: [new MemoryBackend('dc=example,dc=com')],
    access: {admins: ['cn=admin,dc=example,dc=com']},
    plugins: [
        new MemberOfPlugin(),
        new UniquePlugin({attributes: ['uid', 'mail']}),
        new DepartmentPlugin('R&D'),
        new AuditPlugin({write: (record) => console.log(record.operation, record.dn, record.resultCode)})
    ]
})
await server.listen({port: 389})
```

- 拦截器只在其列出的 `operations` 上运行：`before()` 检查或修改请求，`around()` 包裹链上后续的部分运行，`transformEntry()` 修改搜索返回的条目，`beforeCommit()` 在写操作的事务中运行（后端支持事务时）。抛出 `LDAPResultException` 时，以异常的结果码回应。`bind` 上的拦截器围绕密码校验运行，简单绑定和 SASL PLAIN 绑定都会经过这类拦截器（通过 `authentication.type` 区分）；只有密码校验通过、并且整条链回答成功，绑定才会成功。`around()` 可以不调用 `next()` 而直接拒绝绑定；如需放行，则必须调用 `next()`，再返回其结果或者自行给出的成功结果。它返回（而不是抛出）非成功的结果时，绑定以此结果失败。不返回任何值、返回的值没有结果码，或者结果码是绑定不可能具有的（saslBindInProgress 或负数）时，绑定以 other（80）失败。密码尚未校验通过，`around()` 就回答成功（未调用 `next()`，或者捕获了其拒绝），绑定同样以 other（80）失败。包裹在该拦截器外层的拦截器得到的也是这一结果。插件的 `authenticate()` 不调用 `verify()` 就返回，或者捕获了其拒绝时，绑定也以同样的方式失败；多次调用 `verify()` 时，以最后结束的那一次调用为准，而且返回时不能仍有未结束的调用。插件的 `aroundRequest()` 可以拒绝绑定，但不能将服务器未完成的绑定改为成功或“交换进行中”：此类绑定以服务器自身的拒绝结果失败，服务器未给出结果时以 other（80）失败。拦截器自身作出的拒绝（包括 invalidCredentials）会原样传给客户端，简单绑定和 SASL PLAIN 均是如此。有些事项只在绑定成功、服务器写完自身的状态之后才执行：最后绑定时间，以及插件或拦截器通过 `afterBind()` 加入的记录，按加入的顺序执行（SASL 交换中包括每一步加入的记录）；`bind` 事件最后发出。某条记录抛出错误，或者 `bind` 事件的监听器抛出错误时，服务器发出一条 `error` 事件；绑定仍然成功，其余记录照常执行。`afterBind()` 必须在调用该方法的钩子返回之前调用。钩子调用了 `next()` 或 `verify()` 时，必须等待调用结束后再返回。进程内连接上的绑定必须逐个进行；网络连接会自行将绑定排队。服务器事件的监听器不能抛出错误；只有 `bind` 事件的监听器抛出错误时，服务器才会将错误转为 `error` 事件。不遵守这些规则的代码不在支持范围内：除上文写明会被拒绝的情况外，其余行为不作保证。如需在其他位置校验密码，可以由后端实现 `bind()`，代替服务器对 userPassword 的校验，负责自身后缀下每个 DN 的密码，按 `access.adminPasswords` 绑定的管理员除外。以下绑定不经过 `bind` 上的拦截器：匿名绑定和不带密码的绑定、DN 不属于任何后端的绑定、按 `access.adminPasswords` 绑定的管理员，以及不校验密码的 SASL 机制（例如 EXTERNAL）。
- 拦截器可以放在服务器内置步骤（`access`、`password`、`schema`、`operational`、`paging`）之前或之后，写法为 `{interceptor, before: 'schema'}`；未指定时放在链的末尾，即所有内置步骤之后，此时拦截器向请求中加入的内容不会经过 schema 检查。放在 `password` 之前的拦截器能看到明文密码。会从搜索结果中去掉条目的拦截器（`transformEntry()` 返回 undefined，或者通过 `around()` 替换条目）必须放在 `paging` 之后，链的末尾即位于该步骤之后。此类拦截器放在该步骤之前时，分页和虚拟列表视图仍会将被去掉的条目计算在内。只修改条目的拦截器最好放在 `paging` 之前（`GroupPresentationPlugin` 即如此放置），这样后端仍可自行排序、开窗和分页；此时排序和虚拟列表视图使用的是存储的条目，不包括拦截器所做的修改。
- 在拦截器和插件中，绑定时的 `context.session` 即会话本身；其他操作得到的是会话的一个视图，其中的身份始终是操作开始时的身份，无论期间是否有新的绑定。因此，请将会话的数据放在 `session.state` 中，或者以 `session.id` 为键，不要以会话对象为键。
- 插件还可以在每个请求前后运行（`aroundRequest`，能看到绑定、StartTLS 和服务器自行回答的扩展操作）、在校验密码前后运行（`authenticate`），以及在修改密码、密码仍为明文时运行（`passwordChange`，其中的 `importing` 表示看起来像哈希的值是否为管理员导入的哈希）。插件可以带上 schema 文件、控制、扩展操作、SASL 机制和密码格式，根 DSE 和子模式条目会公布这些内容。两个插件声明同一个 OID 时，服务器在启动时即报错。根 DSE 和子模式条目不经过任何后端的链，因此插件的控制只有在 `aroundRequest` 中应用时才对这两个条目有效；此类控制需要标上 `serverEntries: true`，否则带着该关键控制搜索这些条目会被拒绝。
- 每个插件的选项中都有 `name` 和 `suffixes`，用于同时使用两个同类插件，或者使插件只作用于部分后端。插件维护的关系仅限于一个后端之内，正如 OpenLDAP 的 overlay 只在一个数据库之内维护关系。
- 服务器的 `interceptors` 选项只接受拦截器，用于不需要插件其他部分的场合。

## 14. 自己的后端

将用户保存在自有数据表中的程序，可以通过自定义后端提供这些用户。`createHandlerBackend()` 由逐个操作编写的处理函数构造后端，写法与 ldapjs 的服务器相同：

```typescript
import {createHandlerBackend, createLDAPServer, type LDAPBackend, LDAPNoSuchObjectException} from '@lakutata/ldap-engine'

const devices: Map<string, string> = new Map([['printer1', '10.0.0.5'], ['camera2', '10.0.0.9']])
const SUFFIX: string = 'ou=devices,dc=example,dc=com'

const backend: LDAPBackend = createHandlerBackend({
    suffix: SUFFIX,
    //返回超集就够了：服务器会再按范围和过滤器检查
    search: () => [
        {dn: SUFFIX, attributes: {objectClass: 'organizationalUnit', ou: 'devices'}},
        ...[...devices].map(([name, address]) => ({dn: `cn=${name},${SUFFIX}`, attributes: {objectClass: 'device', cn: name, description: address}}))
    ],
    delete: (context, dn) => {
        const name: string | undefined = dn.rdn()?.get('cn')
        if (!name || !devices.delete(name)) throw new LDAPNoSuchObjectException(`No device ${dn}`)
    }
})

const server = createLDAPServer({backends: [backend], access: {admins: ['cn=admin,dc=example,dc=com']}})
await server.listen({port: 389})
```

- 后端提供 `get()`（按 DN 获取一个条目）、`search()`（搜索的条目，返回超集即可），以及后端支持的写操作（`add()`、`modify()`、`delete()`、`modifyDN()`）；对后端不支持的写操作，服务器回应 unwillingToPerform。如果不读取条目就能更快地判断条目是否存在，可以实现 `exists()`。
- 后端可以自行校验绑定（`bind()`），带上其计算出的属性所需的 schema 文件和自身的拦截器，还可以提供 `transaction()`，使拦截器的 `beforeCommit()` 和写操作在同一个事务中运行。如果还提供了 `lock()`，引擎会在该事务中，在拦截器的 `beforeCommit()` 之后、写入之前，等待后端锁定条目，再重新读取修改或改名的条目，按读到的内容重新算出改动并重新检查：期间他人所做的修改不会被覆盖，increment 按条目当前的值计算，必填属性也按当前的值检查。
- 有 `lock()` 时，`beforeCommit()` 看到的是按事务开始前读到的条目算出的改动。之后，拦截器未触及的改动按请求重新算出，被原地修改的改动按修改后的内容重新算出；拦截器删除的改动不会恢复，拦截器添加的改动（或替换为新对象的改动）按原样写入。
- 自行完成排序、虚拟列表视图或分页的后端，需要在 `capabilities` 中声明；`sortSearchItems()` 能按服务器的方式为后端自身的记录排序。条目可能被逐条去掉时（设置了 `access.check` 且 `checkReads` 不为 false，或者 `paging` 之后有带 `transformEntry()` 或搜索上的 `around()` 的拦截器），虚拟列表视图和分页由服务器自行完成。普通的排序搜索仍由后端排序；虚拟列表视图则连排序也由服务器完成。自行完成某个插件工作的后端（`memberOf`、`referentialIntegrity`、`idAllocation`、`lastBind`）也在此处声明，对应的插件便会退出该后端的链。后端处理的控制写在 `capabilities.controls` 中：请求带有其中某个关键控制，却到达另一个后端，或者不到达任何后端（匿名绑定或不带密码的绑定、SASL 交换中此前尚未校验过密码的步骤，或者扩展操作）时，该请求会被拒绝。Password Modify 按其要修改的条目所在的后端检查。

## 15. 协议

LDAPv3 的消息用于客户端和服务器未覆盖的场合：代理、录制工具、服务器的测试。

```typescript
import {decodeMessage, encodeMessage, filter, type LDAPMessage, MessageReader, PagedResultsControl, type ReadMessage} from '@lakutata/ldap-engine'

const bytes: Buffer = encodeMessage({
    messageId: 2,
    protocolOp: {type: 'searchRequest', baseObject: 'dc=example,dc=com', scope: 'sub', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: filter`(uid=${'alice'})`, attributes: ['cn']},
    controls: [PagedResultsControl.encode({size: 100, cookie: Buffer.alloc(0)})]
})
const message: LDAPMessage = decodeMessage(bytes)
console.log(message.protocolOp.type, PagedResultsControl.decode(message.controls![0]).size) //searchRequest 100

const reader: MessageReader = new MessageReader({maxMessageSize: 4 * 1024 * 1024})
const read: ReadMessage[] = reader.push(Buffer.concat([bytes, bytes.subarray(0, 5)]))
console.log(read.length, reader.bufferedBytes) //1 5
```

- `encodeMessage()` 和 `decodeMessage()` 在 LDAPv3（RFC 4511）的每种消息和字节之间相互转换。解码后的消息中，DN 保持为文本，值保持为字节：除编码本身之外不做任何解析，因此服务器可以对格式错误的 DN 回应相应的结果码。
- `MessageReader` 从数据流的各个数据块中读出完整的消息，并限制消息的大小。消息解码失败但已知其 message ID 时，该消息会作为错误返回，数据流可以继续；其他情况下抛出致命的 `LDAPDecodeException`。`malformed` 用于区分两种情况：编码本身有误时，服务器会结束会话；仅是某个值不被允许时，服务器回应 protocolError（RFC 4511 §4.1.1）。
- 各种控制（分页、排序、虚拟列表视图、树删除、密码策略、读取条目、代理授权、持久搜索、内容同步……）和扩展操作的值（Password Modify、Who Am I、Cancel）都有编解码器；`Ber` 和 `BerReader` 用于写入和读取 BER，供编写自定义的编解码器使用。

## 16. 在应用中使用

在 Lakutata 应用中，`@lakutata/ldap` 将客户端包装为 `LDAPClient` 组件，将服务器包装为 `LDAPServer` 组件；`DirectoryBackend` 将条目存入应用的数据库；插件和后端可以是带选项的 Lakutata 类。服务器的选项即本指南中的选项；组件额外提供的功能见 [LDAP](LDAP.md) 指南。

## 17. 异常

| 异常 | 抛出时机 |
|---|---|
| `LDAPResultException` 及其子类（`LDAPNoSuchObjectException`、`LDAPInvalidCredentialsException`、`LDAPInsufficientAccessException`、`LDAPEntryAlreadyExistsException`、`LDAPSizeLimitExceededException`、`LDAPProtocolErrorException`……） | 结果不是成功，带有 `code`、`matchedDN` 和 `diagnosticMessage`（以及 Active Directory 的 `adDataCode`）；后端或拦截器抛出这些异常，以对应的结果码回应 |
| `LDAPConnectionException` | 连接无法建立，或者在有操作等待时被关闭（`code` 为系统的错误码：`ECONNREFUSED`……） |
| `LDAPTimeoutException` | 操作、建立连接或 TLS 握手超过了规定的时间 |
| `LDAPUsageException` | 在发送任何内容之前即被拒绝的调用：空密码、以文本形式读取值为字节的属性、有操作未完成时执行 StartTLS |
| `LDAPDecodeException` | 无法解码的消息：数据流无法继续时 `fatal` 为 true，否则带有该消息的 `messageId` 和 `operation` |
| `LDAPFilterSyntaxException`、`LDAPDNSyntaxException`、`LDAPLDIFSyntaxException` | 无法读取的过滤器、DN 或 LDIF 文本，带有出错的 `position` 或 `line` |
| `LDAPSchemaException` | 无法加载的 schema：无法解析的定义，或者名称、OID 重复定义 |
| `LDAPException` | 以上所有异常的基类 |

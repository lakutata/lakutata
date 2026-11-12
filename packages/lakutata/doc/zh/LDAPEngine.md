# Lakutata LDAP Engine

`@lakutata/ldap-engine` 包是用 TypeScript 写的 Node.js LDAP 库，包括三部分：访问目录服务（OpenLDAP、Active Directory、389 Directory Server、FreeIPA……）的客户端；一个服务器，它的条目由后端存放，存在哪里由后端决定；以及客户端和服务器共同使用的协议层。它不属于 `lakutata`，也不需要应用。它的特点是：

- **客户端**：搜索自动分页，文本和字节分开读取，空密码在发送之前就被拒绝；用户登录失败时，能告诉你原因（密码错误、账号被锁定、密码过期……）。
- **服务器**：协议、TLS、schema 检查、密码、访问控制和密码策略都由服务器自己完成，后端只负责存放条目。
- **进程内连接**：程序可以不经过网络读写自己的服务器，经过的检查和网络请求完全一样。
- **各部分可以单独使用**：过滤器、DN、schema、LDIF 和 LDAPv3 的消息，可以用在导入账号的脚本、schema 文件编辑器或代理程序里。
- **没有依赖，也没有原生代码**：支持 Node.js `>=18.10.0`、Bun、Electron 和 NW.js。

`@lakutata/ldap-engine` 的 README 列出了所有导出；这篇指南按用途逐一说明这个包能做什么，每种用途都给出一个例子。在 lakutata 应用里，`@lakutata/ldap` 把客户端和服务器包装成了组件（见 [LDAP](LDAP.md)），它们的行为就是这里描述的行为。

```bash
npm install @lakutata/ldap-engine
```

## 1. 连接服务器

`connectLDAP()` 打开一个连接，这个连接有自己独立的会话：它以谁的身份绑定，在下一次绑定之前就一直是谁。

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

- URL 决定连接方式：`ldap://`（普通 TCP）、`ldaps://`（一开始就是 TLS），或者 `ldapi://` 加上转义后的 Unix 套接字路径（`ldapi://%2Frun%2Fdirectory%2Fldapi`）。`startTLS: true` 会在发送任何内容之前把 `ldap://` 连接升级为 TLS；之后再升级可以调用 `connection.startTLS()`。证书校验的名字默认是 URL 里的主机名，可以用 `tls.servername` 指定别的名字。
- 每个操作都可以传 `timeout`（默认用连接的设置，30 秒）和 `signal`。搜索或写操作超时后，会在服务器上放弃（abandon），连接继续可用。绑定或 StartTLS 超时则会关闭连接，因为这时会话处于什么状态已经无法确定。建立连接最多用 `connectTimeout`（5 秒）。
- 带名字、密码为空的 `bind()` 在发送之前就会被拒绝：很多服务器会把它当作匿名绑定，返回成功。`saslBind(mechanism, credentials, {step})` 用 SASL 绑定，由 `step` 回答服务器的每一次质询。
- `close()` 结束会话，仍在等待的操作会被拒绝。空闲的连接不会让进程一直不退出。
- 服务器发来的消息最大为 `maxMessageSize` 字节（64 MiB）：超过的会直接结束连接，而不是一直占用内存。

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

- `scope` 可以是 `'base'`、`'one'`、`'sub'`（默认）或 `'children'`。`filter` 可以是过滤器的文本，也可以是 `Filter`（第 6 节）；模板 `filter` 会转义写进去的值，值改变不了过滤器的结构。
- 搜索默认分页，每页 500 个条目（`paged: {pageSize}` 修改每页大小，`paged: false` 不分页），所以服务器对单次请求的条数限制不会把结果截断。只取一个条目的搜索（`scope: 'base'`）不分页；`sizeLimit` 不大于每页大小的搜索也不分页。
- `sizeLimit` 限制搜索保留的条目数：超出的条目都会被丢掉，不管服务器是在这里停下还是继续发送，这时 `truncated` 为 true。如果搜索没有设 `sizeLimit`，而服务器有自己的条数限制，搜索会抛出 `LDAPSizeLimitExceededException`，已经收到的条目放在它的 `partial` 里。
- 分页没有进展时（一页没有任何条目，返回的 cookie 却和上一页相同；或者连续一百页都没有条目），搜索会抛出 `LDAPProtocolErrorException`，而不是一直分页下去。
- `searchIterator()` 一页一页地读取，逐个给出条目；提前退出循环时，会通知服务器结束分页。
- `sort` 和 `window` 读取排序后条目中的一段（虚拟列表视图）：`{sort: [{attribute: 'cn'}], window: {offset: 1, limit: 20}}`，`total` 是整个列表的条目数。这两个控制都作为关键（critical）控制发送，不支持排序的服务器会让搜索失败，而不是返回没有排序的全部条目。
- 结果里的 `references` 是服务器返回的引用，客户端不会跟着去访问。

`Entry` 把值作为文本或字节给出，二者不会混用：

| 方法 | 给出什么 |
|---|---|
| `entry.dn` | DN，保持服务器写的样子 |
| `get(name)`、`first(name)` | 以文本形式给出的值，或其中第一个；值是字节的属性会抛出异常 |
| `getBuffers(name)` | 以字节形式给出的值 |
| `has(name)`、`names()`、`isBinary(name)` | 是否有某个属性、所有属性名、某个属性的值是不是字节 |
| `toObject()`、`toJSON()` | 以对象形式给出属性（字节为 `Buffer`），以及 JSON 形式（字节为 base64） |

值是字节的属性包括：已知存放字节的属性（`jpegPhoto`、`userCertificate`、Active Directory 的 `objectGUID` 和 `objectSid`……）、带 `;binary` 选项的属性、`binaryAttributes` 里列出的属性；连接上设置了服务器的 schema 时（第 7 节），语法是二进制的属性也算。属性名不区分大小写，但要和服务器写的一致：`cn` 不等于 `commonName`，也不等于 `cn;lang-en`。

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

- `add()` 的属性可以是一个对象（每个属性对应一个值或一组值），也可以是 `{type, values}` 的列表。值可以是文本（以 UTF-8 写入）、字节、数字或布尔值（写成 `TRUE` 和 `FALSE`）。
- 修改有 `add`、`delete`（删除给出的值，不给值时删除整个属性）、`replace` 和 `increment` 四种。
- `passwordModify()` 用 RFC 3062 的扩展操作修改密码：默认修改当前绑定用户的密码，`userIdentity` 可以指定别的用户；新密码是 `newPassword`，不给时由服务器生成并返回。
- `extended(name, value)` 执行其他扩展操作；每个操作都可以带 `controls`，控制由各自的编解码器生成（`TreeDeleteControl`、`AssertionControl`、`PostReadRequestControl`、`ProxiedAuthorizationControl`……）。
- 结果不是成功时，抛出 `LDAPResultException` 的子类，类名对应结果码（`LDAPNoSuchObjectException`、`LDAPInsufficientAccessException`……），带有 `code`、`matchedDN` 和 `diagnosticMessage`。

## 4. 连接池与用户登录

`createLDAPClient()` 返回一个连接池，池里的连接都以同一个身份绑定，适合同时执行大量操作的服务。

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

- 操作需要连接、而现有连接都在忙时，连接池才打开新连接，最多 `poolSize` 个（默认 4 个）；每个操作交给最空闲的连接执行；空闲超过 `idleTimeout`（10 分钟）的连接会被关闭。分页搜索的所有页都在同一个连接上进行。
- 各个服务器按顺序尝试，直到连上其中一个；也可以通过 DNS SRV 记录查找服务器（`srv: '_ldap._tcp.example.com'`）。
- 如果某个连接上的服务器没有按时回应，或者回应的内容无法读取，这个连接就不再接新的操作，等它上面的操作结束后关闭，之后的操作会打开新的连接。
- 连接池拥有单个连接的全部操作；`bind()` 修改连接池的身份，`connect()` 返回一个不属于连接池的连接，`close()` 关闭所有连接。
- `authenticate()` 先找到用户的条目（默认按 `uid` 查找，也可以用给出的 `attribute` 或 `filter`），再在一个单独的连接上以该用户绑定，所以连接池的身份不会改变。`bindName` 不经过搜索，直接用由用户名构造的名字绑定（Active Directory 可以用 ``(name) => `${name}@example.com` ``）。
- 结果会说明绑定失败的原因：`invalidCredentials`、`accountLocked`、`accountDisabled`、`accountExpired`、`passwordExpired`、`mustChangePassword` 等。这些原因取自 OpenLDAP 的密码策略控制或 Active Directory 的数据代码，比结果码说明得更具体。`timeBeforeExpiration` 和 `graceAuthNsRemaining` 会在密码过期之前给出提醒。
- 它只通过 TLS（`ldaps` URL 或 `startTLS: true`）或本机的 `ldapi` 套接字发送密码；服务器就在本机时，可以用 `requireTLS: false` 允许其他方式。

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

- Active Directory 接受用用户主体名（`alice@example.com`）或 DN 绑定。
- `guidToString()` 和 `sidToString()` 给出 objectGUID（前几段按小端序，和 Active Directory 的显示方式一致）和 objectSid 的文本形式；`stringToGuid()` 和 `stringToSid()` 做相反的转换，用于按这两个属性过滤。
- `parseUserAccountControl()` 按名字给出 userAccountControl 的各个标志（`accountDisable`、`lockout`、`dontExpirePassword`……）；`fileTimeToDate()` 把 FILETIME（pwdLastSet、lastLogon、accountExpires）转换成日期，表示“从不”时返回 `undefined`。
- 很大的属性（比如大组的 member）的值是分段返回的（`member;range=0-1499`）：默认会一直读到最后，`ranges: false` 则不读后面的分段。
- `changeADPassword()` 用旧密码修改用户自己的密码；`resetADPassword()` 以管理员身份设置密码。Active Directory 只在 TLS（LDAPS 或 StartTLS）上接受这两种操作，并且会检查它的密码策略。

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

- `Filter` 用来构造过滤器（`and`、`or`、`not`、`equal`、`greaterOrEqual`、`lessOrEqual`、`approx`、`present`、`substrings`、`extensible`），用 `parse()` 读取过滤器的文本（RFC 4515），用 `stringify()` 写出文本。模板 `filter` 由过滤器的文本和写进去的值构造过滤器，每个值都会被转义。
- `matchFilter()` 按 RFC 4511 的三值逻辑在条目上求过滤器的值：`true`、`false`，或者无法判断时的 `undefined`。给出 `Schema` 时，按属性的匹配规则比较值（大小写、空格、子类型）；不给时，按不区分大小写的文本比较。
- `DN.parse()` 读取 DN（RFC 4514），`toString()` 写出转义后的 DN。`equals()`、`isDescendantOf()` 和 `isChildOf()` 按规范化后的形式比较 DN（有 schema 时，`CN=Alice` 和 `commonName=alice` 是同一个名字）；`rdn()`、`parent()` 和 `child()` 用于在树上移动。`escapeDNValue()` 转义写进 DN 的值。

## 7. Schema

schema 决定一个条目可以包含什么：它的对象类、这些对象类必需和允许的属性，以及值的语法和比较值的匹配规则。

```typescript
import {connectLDAP, readSchema, type Schema} from '@lakutata/ldap-engine'

const connection = await connectLDAP('ldap://ldap.example.com')
const schema: Schema = await readSchema(connection)
console.log(schema.attributesOf(['inetOrgPerson']).must) //[ 'sn', 'cn', 'objectClass' ]
console.log(schema.isSingleValued('displayName'), schema.isBinary('jpegPhoto'), schema.equality('mail')?.names[0]) //true true caseIgnoreIA5Match
await connection.close()
```

- `readSchema()` 读取服务器公布的 schema（它的子模式条目）。把它传给 `connectLDAP({schema})`，条目就能知道哪些属性的值是字节。
- `new Schema().load()` 加载 schema 文件：OpenLDAP `cn=config` 的 LDIF、子模式条目，或者 `.schema` 格式。名字或 OID 重复定义时，会抛出 `LDAPSchemaException`，并指出两处定义所在的文件；`problems()` 列出定义里引用了但没有定义的名字，带有所在的文件和行号。
- `@lakutata/ldap-engine/schemas` 以文档形式导出自带的 schema：`SYSTEM`（操作属性和目录自身的对象类）；`CORE`、`COSINE` 和 `INETORGPERSON`，即几乎所有服务器都有的 `DEFAULTS`；`RFC2307BIS`（POSIX 账号和组）；`OPENSSH_LPK`（SSH 公钥）；`PPOLICY`（密码策略）。`bundledSchema(names)` 返回由它们组成的 `Schema`。

schema 文件也可以当作数据处理：`parseSchemaFile()`（或 `readSchemaFile(path)`）把它转成文档，其中的定义都是普通对象，带着各自的注释和行号；`stringifySchemaFile()` 把文档写回文件，没改动的定义保持原来的写法。schema 文件编辑器修改的就是这个文档；加载自己 schema 的程序，也可以在构建时把文件转好，直接 import 文档。

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

`parseLDIF()` 读取 LDIF（RFC 2849），包括条目和要执行的修改。`stringifyLDIF()` 写出 LDIF，长行会被折行，不是纯文本的值写成 base64。

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

- 每条记录是一个条目（`content`）或一个修改（`add`、`delete`、`modify`、`modifyDN`），带有它所在的行号和它前面的注释，`stringifyLDIF()` 会把注释写回去。
- `parseLDIF(text, {readURL})` 读取用 URL 给出的值（`jpegPhoto:< file:///photos/carol.jpg`）；不给 `readURL` 时，这样的值会抛出异常。
- 目录助手（第 10 节）可以把 LDIF 导入目录，也可以把一个子树导出成 LDIF。

## 9. 服务器

`createLDAPServer()` 提供它的后端里的条目，每个后端挂在自己的后缀上。后端只负责存放条目，其余都由服务器完成：协议、StartTLS 和 LDAPS、每次写入的 schema 检查、密码、访问控制、各种限制、根 DSE 和子模式条目，以及后端自己不做的排序、虚拟列表视图和分页。

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

- `listen()` 在一个端口（`0` 表示任选一个空闲端口，并返回它）和地址（`host`）上监听 LDAP；`secure: true` 时监听 LDAPS；给出 `path` 时监听 Unix 套接字（ldapi）。一个服务器可以监听多次。`attach(server)` 和 `handleConnection(socket)` 用来处理别处创建的 `net.Server` 上的连接。
- Unix 套接字供本机的客户端使用（SSSD 2.9 及以上、nslcd、OpenLDAP 的命令行工具）：它的连接不会离开本机，所以服务器像对待 TLS 一样在上面接受密码，并在上面提供 SASL PLAIN。`mode` 决定谁可以连接（`0o666`：本机的所有用户；默认按通常的 umask，只有运行服务器进程的用户）。已停止的服务器留下的套接字会被替换。在 Windows 上，服务器不监听 Unix 套接字。
- schema：总是先加载系统 schema，然后按顺序加载 `schema` 选项列出的 schema，默认是 `DEFAULTS`。自己的 schema 可以是文档（`readSchemaFile()`；或者用 `readSchemaDirectory()` 按文件名顺序读取一个目录里的文件），也可以直接给文件的文本。名字或 OID 重复定义时，服务器在启动时就会报错。
- `MemoryBackend` 把条目放在内存里，适合测试和小型服务器。自己的后端见第 14 节；`@lakutata/ldap` 的 `DirectoryBackend` 把条目存进应用的数据库。
- `events`：`connection`、`disconnect`、`bind`、`bindFailure`、`operation`（操作、它的 DN、结果码和耗时的毫秒数）、`startTLS`、`connectionError`，以及后端或拦截器出现不属于结果码的错误时的 `error`。
- `close()` 停止监听，用 Notice of Disconnection 结束各个会话，并停止插件。

## 10. 程序自己的连接

`server.connect({as})` 返回一个进程内的连接，以给出的 DN 的身份绑定，拥有客户端的全部操作。它不需要 `listen()`，不经过网络，经过的 schema 检查、密码哈希和访问控制与网络请求完全一样。`createDirectory()` 用 LDAP 操作管理用户、组和组织单元，可以用在任何连接上。

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

- 目录助手有 `add()`、`createUser()`（连同密码一起创建，密码由服务器哈希）、`createOrganizationalUnit()`、`createGroup()`、`addMember()`、`removeMember()`、`groupsOf()`、`setPassword()`、`verifyPassword()`、`move()`、`rename()`、`delete()`（`{subtree: true}` 删除整个子树）、`find()`、`importLDIF()` 和 `exportLDIF()`。
- 它的默认配置是：用户为 `inetOrgPerson`，以 `uid` 命名；组为 `groupOfNames`，以 `cn` 命名（组里还没有成员时，用空 DN 占位）；组织单元为 `organizationalUnit`。`createDirectory(connection, {profile})` 可以换一套配置，用来管理有自己对象类的目录。
- 用在第 1 节或第 4 节的客户端上，它可以用同样的方式管理远程目录（比如 OpenLDAP）。
- `server.connect({internal: true})` 是服务器自己的代码（插件）使用的连接：它的操作会经过 schema 检查，访问控制则直接放行。

## 11. 谁能做什么

| 谁 | 可以做什么 |
|---|---|
| 匿名会话 | 读取根 DSE 和子模式条目（`access.anonymousRead: true` 允许它读取目录） |
| 已绑定的会话 | 读取目录，但 `userPassword` 除外，任何人都读不到；修改自己的密码（`access.authenticatedRead: false` 不让它读取目录） |
| 管理员（`access.admins`） | 写入，以及修改任何人的密码 |
| 密码管理员（`access.passwordAdmins`） | 修改其他人的密码，比如 Keycloak 或 Nextcloud 的服务账号 |

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

- `access.check` 最先判断：返回 `true` 表示允许，`false` 表示拒绝，`undefined` 表示交给上表的规则。它收到的信息有：操作（搜索返回的内容为 `read`）、DN、会话的身份，以及已知时的条目或属性。
- `plaintextBind` 规定在哪里可以不经过 TLS 接受密码：任何地方（`'all'`，默认）、只限本机回环地址（`'loopback'`），或者任何地方都不行（`'none'`）。Unix 套接字不受这个选项限制，总是接受密码。
- 带名字、密码为空的绑定会被拒绝（`allowUnauthenticatedBind` 会把它当作匿名绑定接受）。同一个 DN 或地址的失败绑定，回应会越来越慢，之后在一段时间内直接拒绝（`bindThrottle`）；这些情况都回 invalidCredentials，从回应上分不出账号被锁定还是密码错误。
- `limits`：对不是管理员的会话，每次搜索最多 500 个条目、3600 秒，并限制过滤器的深度和大小；对所有会话，限制消息的大小、未完成的请求数、连接数和空闲时间。分页搜索的条数限制按所有页的总数计算：达到限制后还有条目时，搜索就此结束，回应 sizeLimitExceeded。对不是管理员的会话，可以用 `pagedSizeLimit` 给分页搜索单独设一个限制（不设时等于 `sizeLimit`，0 表示不限）。

## 12. 密码和密码策略

服务器收到的每个密码都会被哈希成 `{PBKDF2-SHA512}`（OpenLDAP 的 pw-pbkdf2 模块使用的格式；`passwords: {iterations}` 调整迭代次数）。绑定时也能校验 OpenLDAP 的其他格式（`{SSHA}`、SHA-2 系列、使用 MD5、SHA-256、SHA-512 和 bcrypt 的 `{CRYPT}`，以及 node:crypto 支持 argon2 时的 `{ARGON2}`：Node.js 24.7 及以上，Electron 不支持），还能校验旧目录里的明文密码，校验通过后再用服务器的格式重新哈希（`rehashOnBind`）。管理员可以直接写入已经哈希过的值，用于导入账号。

`passwordPolicy` 实现 draft-behera 的密码策略，使用的属性和 OpenLDAP 的 ppolicy 一样：

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

- 失败次数过多时锁定账号，锁定一段时间，或者直到管理员设置新密码为止；太久没有使用的账号也会被锁定（`maxIdle`）。
- 密码会过期（`maxAge`），过期前会提醒（`expireWarning`），过期后还允许绑定几次（`graceAuthNLimit`）。
- 管理员设置密码后，用户必须先修改密码，才能做别的事（`mustChange`）。
- 新密码的要求：修改时必须给出旧密码（`safeModify`），两次修改之间要隔一段时间（`minAge`），并且不能和以前用过的密码相同（`inHistory`）；长度（`minLength`、`maxLength`）和 `quality` 检查在 `checkQuality` 为 1（直接写入哈希值的密码可以通过）或 2（总是检查）时生效，和 pwdCheckQuality 的规定一致。
- 策略的状态存在条目的操作属性里（pwdChangedTime、pwdAccountLockedTime、pwdFailureTime……），所以任何后端都能保存它。每次绑定失败都会计数，同时发生的几次也一样。共用一个后端的两个实例在同一毫秒内、都还没写入时各有一次失败，可能拿到相同的时间；这时算一次还是两次，取决于后端怎样处理已有的值。发送密码策略控制的客户端会在回应里收到提醒和原因；账号被锁定时，回应和密码错误一样，除非设置了 `revealLocked`。
- 密码策略是一个插件：这个选项会在其他插件之后加上一个 `PasswordPolicyPlugin`，它会自己加载 ppolicy schema。

## 13. 插件和拦截器

插件给服务器增加的功能，相当于 OpenLDAP 的 overlay 给 slapd 增加的功能：在操作前后运行的代码，以及这些代码所需的 schema、控制和扩展操作。

| 插件 | 作用 | 相当于 OpenLDAP 的 |
|---|---|---|
| `MemberOfPlugin` | 维护组成员的 memberOf | memberof |
| `ReferentialIntegrityPlugin` | 条目被删除、改名或移动时，修改其他条目里指向它的 DN 值 | refint |
| `UniquePlugin` | 拒绝其他条目已经用过的值 | unique |
| `PasswordPolicyPlugin` | 第 12 节的密码策略 | ppolicy |
| `IdAllocationPlugin` | 给新增时没有 uidNumber 和 gidNumber 的 POSIX 条目分配这两个值 | （389 Directory Server 的 DNA） |
| `LastBindPlugin` | 在 authTimestamp 里记录最后一次绑定的时间 | lastbind |
| `SambaPasswordPlugin` | 把新密码的 NT 哈希写进 sambaNTPassword（需要加载 Samba 的 schema） | smbk5pwd |
| `AuditPlugin` | 把每个请求和它的结果交给你自己的函数记录 | accesslog、auditlog |
| `ConstraintPlugin` | 拒绝违反规则的值：模式、大小、个数，或者你自己的检查 | constraint |
| `GroupPresentationPlugin` | 每个组同时显示为 groupOfNames 和 groupOfUniqueNames，供只认其中一种的客户端使用 | |

自己的插件继承 `BaseLDAPPlugin`（也可以是任何符合 `LDAPPlugin` 结构的对象）。它的拦截器在后端的操作前后运行：

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

- 拦截器只在它列出的 `operations` 上运行：`before()` 检查或修改请求，`around()` 包住链上后面的部分运行，`transformEntry()` 修改搜索返回的条目，`beforeCommit()` 在写操作的事务里运行（后端支持事务时）。抛出 `LDAPResultException` 时，以它的结果码回应。
- 拦截器可以放在服务器内置步骤（`access`、`password`、`schema`、`operational`、`paging`）的前面或后面，写法是 `{interceptor, before: 'schema'}`；不指定时放在链的末尾，也就是所有内置步骤之后，这时它往请求里加的内容不会经过 schema 检查。放在 `password` 之前的拦截器能看到明文密码。
- 插件还可以在每个请求前后运行（`aroundRequest`，能看到绑定和服务器自己回答的扩展操作）、在校验密码前后运行（`authenticate`），以及在密码修改时、密码还是明文的时候运行（`passwordChange`）。插件可以带上 schema 文件、控制、扩展操作、SASL 机制和密码格式，根 DSE 和子模式条目会公布它们。两个插件声明同一个 OID 时，服务器在启动时就会报错。
- 每个插件的选项里都有 `name` 和 `suffixes`：用来同时使用两个同类插件，或者只作用于部分后端。插件维护的关系只在一个后端之内，就像 OpenLDAP 的 overlay 只在一个数据库之内维护关系一样。
- 服务器的 `interceptors` 选项只接受拦截器，用于不需要插件其他部分的场合。

## 14. 自己的后端

用户存在自己的表里的程序，可以用自己的后端提供这些用户。`createHandlerBackend()` 用逐个操作编写的处理函数构造后端，写法和 ldapjs 的服务器一样：

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

- 后端有 `get()`（按 DN 取一个条目）、`search()`（搜索的条目，返回超集就够了），以及它支持的写操作（`add()`、`modify()`、`delete()`、`modifyDN()`）；后端不支持的写操作，服务器回 unwillingToPerform。如果不读取条目就能更快地判断它是否存在，可以实现 `exists()`。
- 后端可以自己校验绑定（`bind()`），带上它计算出的属性所需的 schema 文件和它自己的拦截器，还可以提供 `transaction()`，让拦截器的 `beforeCommit()` 和写操作在同一个事务里运行。如果还提供了 `lock()`，引擎会在这个事务里，在拦截器的 `beforeCommit()` 之后、写入之前，等后端锁住条目，再重新读取修改或改名的条目，按读到的内容重新算出改动并重新检查：期间别人做的修改不会被覆盖，increment 按条目当前的值计算，必填属性也按当前的值检查。
- 有 `lock()` 时，`beforeCommit()` 看到的是按事务开始前读到的条目算出的改动。之后，没有拦截器动过的改动按请求重新算出，被原地修改的改动按修改后的内容重新算出；拦截器删掉的改动不会恢复，它添加的改动（或换成新对象的改动）按原样写入。
- 自己做排序、虚拟列表视图或分页的后端，要在 `capabilities` 里声明；`sortSearchItems()` 能按服务器的方式给它自己的记录排序。自己完成某个插件工作的后端（`memberOf`、`referentialIntegrity`、`idAllocation`、`lastBind`），也在这里声明，对应的插件就会退出它的链。

## 15. 协议

LDAPv3 的消息用于客户端和服务器没有覆盖的场合：代理、录制工具、服务器的测试。

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

- `encodeMessage()` 和 `decodeMessage()` 在 LDAPv3（RFC 4511）的每种消息和字节之间相互转换。解码后的消息里，DN 保持为文本，值保持为字节：除了编码本身，不做任何解析，所以服务器可以对格式错误的 DN 回应相应的结果码。
- `MessageReader` 从数据流的一个个数据块里读出完整的消息，并限制消息的大小。消息解码失败但已经知道它的 message ID 时，会作为错误返回，数据流可以继续；其他情况抛出致命的 `LDAPDecodeException`。`malformed` 用来区分两种情况：编码本身有错时，服务器会结束会话；只是某个值不允许时，服务器回 protocolError（RFC 4511 §4.1.1）。
- 各种控制（分页、排序、虚拟列表视图、树删除、密码策略、读取条目、代理授权、持久搜索、内容同步……）和扩展操作的值（Password Modify、Who Am I、Cancel）都有编解码器；`Ber` 和 `BerReader` 用来写和读 BER，供你编写自己的编解码器。

## 16. 在应用中使用

在 lakutata 应用里，`@lakutata/ldap` 把客户端包装成 `LDAPClient` 组件，把服务器包装成 `LDAPServer` 组件；`DirectoryBackend` 把条目存进应用的数据库；插件和后端可以是带选项的 lakutata 类。服务器的选项就是这篇指南里的选项；组件额外提供的功能见 [LDAP](LDAP.md) 指南。

## 17. 异常

| 异常 | 何时抛出 |
|---|---|
| `LDAPResultException` 及其子类（`LDAPNoSuchObjectException`、`LDAPInvalidCredentialsException`、`LDAPInsufficientAccessException`、`LDAPEntryAlreadyExistsException`、`LDAPSizeLimitExceededException`、`LDAPProtocolErrorException`……） | 结果不是成功，带有 `code`、`matchedDN` 和 `diagnosticMessage`（以及 Active Directory 的 `adDataCode`）；后端或拦截器抛出它们，以对应的结果码回应 |
| `LDAPConnectionException` | 连接无法建立，或者在有操作等待时关闭了（`code` 是系统的错误码：`ECONNREFUSED`……） |
| `LDAPTimeoutException` | 操作、建立连接或 TLS 握手超过了规定的时间 |
| `LDAPUsageException` | 在发送任何内容之前就被拒绝的调用：空密码、用文本读取值是字节的属性、有操作未完成时执行 StartTLS |
| `LDAPDecodeException` | 无法解码的消息：数据流无法继续时 `fatal` 为 true，否则带有它的 `messageId` 和 `operation` |
| `LDAPFilterSyntaxException`、`LDAPDNSyntaxException`、`LDAPLDIFSyntaxException` | 无法读取的过滤器、DN 或 LDIF 文本，带有出错的 `position` 或 `line` |
| `LDAPSchemaException` | 无法加载的 schema：无法解析的定义，或者名字、OID 重复定义 |
| `LDAPException` | 以上所有异常的基类 |

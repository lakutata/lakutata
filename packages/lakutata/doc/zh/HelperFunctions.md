# Lakutata 辅助函数

`lakutata/utils`（`@lakutata/utils` 包）导出框架及其应用共用的辅助工具：字符串、对象、数组和集合、哈希和编码、UUID、IP 地址、glob、统计，以及 `Time`（见 [Time](Time.md)）。它们是没有依赖的普通函数和类：在需要的地方直接导入即可，无论是否在应用中，都不需要注册。更多细节以及各函数抛出的错误见 `@lakutata/utils` 的 README 和各函数的类型声明。

```typescript
import {Application, Component, Time} from 'lakutata'
import {ObjectHash, RandomString, Templating, UUID} from 'lakutata/utils'

class Invitations extends Component {
    public invite(email: string): { id: string, code: string, key: string, message: string } {
        const expires: Time = new Time().timezone('Europe/Paris').add(7, 'days').endOf('day')
        return {
            id: UUID.v4(),
            code: RandomString(6, 'numeric'),
            //同一个邀请总是得到同一个键
            key: ObjectHash({email: email}),
            message: Templating('Your invitation to {app} expires on {date}', {app: 'Lakutata', date: expires.format('LL')})
        }
    }
}

Application
    .run(() => ({
        id: 'utils.app',
        name: 'Utils',
        components: {
            invitations: {class: Invitations}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const invitations: Invitations = await app.getObject<Invitations>('invitations')
        console.log(invitations.invite('ada@example.com'))
    })
```

## 1. 字符串

| 函数 | 作用 |
|---|---|
| `CamelCase(text)` | 把任意命名风格的字符串转为 camelCase |
| `NoCase(text, options?)` | 把任意命名风格的字符串转为以空格分隔的小写单词 |
| `Templating(template, data, options?)` | 填充 `{key}` 占位符，`{{key}}` 占位符会做 HTML 转义；缺少值时抛出 `MissingValueError`，除非设置 `ignoreMissing` |
| `RandomString(length?, charset?)` | 随机字符串，字符集可以是具名字符集（`'alphanumeric'`、`'alphabetic'`、`'numeric'`、`'hex'`、`'binary'`、`'octal'`）或自定义字符集 |
| `NonceString()` | 由 32 个字母和数字组成的随机字符串 |

## 2. 对象、数组和集合

| 函数 | 作用 |
|---|---|
| `ObjectPath.get()`、`.set()`、`.has()` | 按路径（`'a.b[0].c'`）读取、设置和检查嵌套属性 |
| `CloneDeep(value)` | 深拷贝，保留类、集合和循环引用 |
| `ObjectHash(value, options?)` | 按内容计算值的哈希，与键的顺序无关 |
| `SortArray(array, ...options)` | 原地排序数组，按元素本身或其属性排序（`by`、`order`、`customOrders`、`computed`） |
| `SortKeys(object, options?)` | 返回按比较函数排序键的普通对象副本（`deep`、`compare`） |
| `SortObject(object, options?)` | 返回按字母顺序排序键的普通对象副本（`deep`、`order: 'asc' \| 'desc'`） |
| `UniqueArray(array)` | 去除重复元素后的数组 |
| `MergeArray`、`MergeSet`、`MergeMap` | 把两个数组、集合或 Map 合并为新的一个 |
| `ArrayToSet`、`SetToArray`、`ObjectToMap` | 集合类型之间的转换 |
| `GetObjectPropertyPaths`、`GetObjectNestingDepth`、`IsEmptyObject` | 对象叶子值的路径、嵌套深度、是否没有自有属性 |
| `ObjectConstructor`、`ObjectPrototype`、`ObjectParentConstructor(s)`、`IsSubclassOf` | 类及其祖先 |
| `Statistics` | 数值的均值、分位数、偏差、回归、分布和随机抽样 |

```typescript
import {CamelCase, NoCase, ObjectPath, SortArray, SortObject, Templating, UniqueArray} from 'lakutata/utils'

console.log(CamelCase('user_id'), '|', NoCase('XMLHttpRequest'))
//userId | xml http request

const config: Record<string, any> = {db: {hosts: [{name: 'primary', port: 5432}]}}
console.log(ObjectPath.get<number>(config, 'db.hosts[0].port'))
//5432

//{{name}} 会转义 HTML，{name} 不会
console.log(Templating('<p>Hello {{name}}</p>', {name: '<b>Ada</b>'}))
//<p>Hello &lt;b&gt;Ada&lt;/b&gt;</p>

type Person = { name: string, age: number }
const people: Person[] = [{name: 'Bob', age: 30}, {name: 'Ada', age: 30}, {name: 'Cy', age: 20}]
//原地排序：年龄大的在前，年龄相同时按名字排序
SortArray(people, {by: ['age', 'name'], order: ['desc', 'asc']})
console.log(people.map((person: Person): string => person.name))
//['Ada', 'Bob', 'Cy']

console.log(UniqueArray([3, 1, 3, 2]), Object.keys(SortObject({b: 1, a: 2})))
//[3, 1, 2] ['a', 'b']
```

## 3. 哈希、编码和标识符

| 函数 | 作用 |
|---|---|
| `MD5(text)`、`SHA1(text)`、`SHA256(text)` | 字符串的摘要，返回 `Buffer`（用于校验和；密码和秘密请见 [Security](Security.md)） |
| `MessagePack` | 在值与 MessagePack 字节或字符串之间序列化和反序列化 |
| `UUID` | 生成（`v1`、`v3`、`v4`、`v5`、`v6`）、校验、解析和格式化 UUID |
| `URLBuilder` | 把任意协议的 URL 解析为各个属性，或由属性构建 URL |
| `HexToUnsigned`、`UnsignedToHex(value, bits = 32)` | 十六进制与无符号整数（8 到 128 位）互转 |
| `HexToSigned`、`SignedToHex(value, bits = 32)` | 十六进制与有符号整数（补码）互转 |
| `HexToIEEE754`、`IEEE754ToHex` | 十六进制与 IEEE 754 浮点数互转 |
| `IP`、`IPv4`、`IPv6` | 校验、转换和比较 IP 地址和 CIDR 网段 |

```typescript
import {HexToSigned, MD5, ObjectHash, SHA256, SignedToHex, UUID} from 'lakutata/utils'

console.log(SHA256('hello').toString('hex').slice(0, 16), MD5('hello').length)
//2cf24dba5fb0a30e 16
//深度相等的值得到相同的哈希，与键的顺序无关
console.log(ObjectHash({a: 1, b: 2}) === ObjectHash({b: 2, a: 1}))
//true
console.log(SignedToHex(-2, 16), HexToSigned('FFFE'))
//FFFE -2
console.log(UUID.validate(UUID.v4()))
//true
```

## 4. 异步、进程和文件

| 函数 | 作用 |
|---|---|
| `Delay(ms)` | 等待指定的毫秒数 |
| `GracefulExit` | 执行完清理函数后退出进程 |
| `PathExists(path)`、`IsPath(text)` | 文件或目录是否存在；字符串是否是路径的写法 |
| `Glob(patterns, options?)`、`GlobSync`、`IsGlobString` | 匹配 glob 模式的文件；字符串是否是 glob 模式 |
| `IsPromise`、`IsPromiseLike`、`IsAbortError` | 值是否是 Promise 或 thenable；错误是否是 Node.js 的中止错误 |
| `IsSymbol`、`IsNativeFunction`、`IsHTML`、`IsXML` | 类型判断 |
| `As<T>(value)`、`DevNull(...args)` | 仅供类型检查的类型转换；忽略所有参数的函数 |

```typescript
import {Delay, Glob, PathExists, Statistics} from 'lakutata/utils'

if (await PathExists('./src')) {
    const sources: string[] = await Glob('src/**/*.ts')
    console.log(`${sources.length} TypeScript files`)
}
await Delay(100)
const latencies: number[] = [12, 15, 11, 90, 14, 13]
console.log(Statistics.median(latencies), Statistics.quantile(latencies, 0.9))
//13.5 90
```

类型判断函数（`Is*`）不会抛出异常，而是返回 `false`；其他函数抛出标准的 JavaScript 错误（`RangeError`、`TypeError`），`Templating()` 还会抛出 `MissingValueError`。

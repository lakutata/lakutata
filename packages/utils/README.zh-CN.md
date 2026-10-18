# @lakutata/utils

[English](README.md) | 中文

lakutata 框架的工具集。`Time` 是带 IANA 时区的日期时间，提供类似 moment 的 API（格式化、跨越夏令时切换的日历运算、比较）。辅助函数由框架及其应用共用，涵盖字符串、对象、数组和集合、哈希和编码、UUID、IP 地址、glob 和统计。它们是普通的函数和类，可以在任何地方使用，不管是不是在应用中。`lakutata` 包通过 `lakutata/utils` 重新导出它们，`lakutata` 本身也导出 `Time`。

## 安装

```shell
npm install lakutata
```

它没有可选依赖：一切都基于 Node.js（`^22.13.0 || >=24.11.0`）及其 `Intl` 时区数据实现。

## 用法

### 在应用中使用辅助函数

在需要的地方直接导入辅助函数即可，不需要注册。

```typescript
import {Application, Component, Time} from 'lakutata'
import {objectHash, randomString, templating, UUID} from 'lakutata/utils'

class Invitations extends Component {
    public invite(email: string): {id: string, code: string, key: string, message: string, expires: string} {
        const expires: Time = new Time().timezone('Europe/Paris').add(7, 'days').endOf('day')
        return {
            id: UUID.v4(),
            code: randomString(6, 'numeric'),
            //同一个邀请总是得到同一个键
            key: objectHash({email: email}),
            message: templating('Your invitation to {app} expires on {date}', {app: 'Lakutata', date: expires.format('LL')}),
            expires: expires.format()
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
        const invitations: Invitations = await app.getObject('invitations')
        console.log(invitations.invite('ada@example.com'))
    })
```

### 字符串、对象和集合

```typescript
import {camelCase, mergeMap, noCase, ObjectPath, sortArray, sortObject, templating, uniqueArray} from 'lakutata/utils'

console.log(camelCase('user_id'), '|', noCase('XMLHttpRequest'))
//userId | xml http request

const config: Record<string, any> = {db: {hosts: [{name: 'primary', port: 5432}]}}
console.log(ObjectPath.get<number>(config, 'db.hosts[0].port'))
//5432
//{{name}} 会转义 HTML，{name} 不会
console.log(templating('<p>Hello {{name}}</p>', {name: '<b>Ada</b>'}))
//<p>Hello &lt;b&gt;Ada&lt;/b&gt;</p>

type Person = {name: string, age: number}
const people: Person[] = [{name: 'Bob', age: 30}, {name: 'Ada', age: 30}, {name: 'Cy', age: 20}]
//原地排序：年龄大的在前，年龄相同时按名字排序
sortArray(people, {by: ['age', 'name'], order: ['desc', 'asc']})
console.log(people.map((person: Person): string => person.name))
//['Ada', 'Bob', 'Cy']
console.log(uniqueArray([3, 1, 3, 2]), Object.keys(sortObject({b: 1, a: 2})))
//[3, 1, 2] ['a', 'b']
console.log([...mergeMap(new Map([['a', 1]]), new Map([['a', 2], ['b', 3]]))])
//[['a', 2], ['b', 3]]
```

### 哈希、编码和标识符

```typescript
import {md5, MessagePack, objectHash, sha256, signedToHex, hexToSigned, UUID} from 'lakutata/utils'

console.log(sha256('hello').toString('hex').slice(0, 16), md5('hello').length)
//2cf24dba5fb0a30e 16
//深度相等的值得到相同的哈希，与键的顺序无关
console.log(objectHash({a: 1, b: 2}) === objectHash({b: 2, a: 1}))
//true
const packed: string = MessagePack.stringify({id: 1, at: new Date(0)})
console.log(MessagePack.parse(packed))
//{id: 1, at: 1970-01-01T00:00:00.000Z}
console.log(signedToHex(-2, 16), hexToSigned('FFFE'))
//FFFE -2
const DNS: string = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
console.log(UUID.validate(UUID.v4()), UUID.v5('example.com', DNS))
//true cfbff0d1-9375-5685-968c-48ce8b15ae17
```

### 文件、异步和统计

```typescript
import {delay, Glob, pathExists, Statistics} from 'lakutata/utils'

if (await pathExists('./src')) {
    const sources: string[] = await Glob('src/**/*.ts')
    console.log(`${sources.length} TypeScript files`)
}
await delay(100)
const latencies: number[] = [12, 15, 11, 90, 14, 13]
console.log(Statistics.median(latencies), Statistics.quantile(latencies, 0.9))
//13.5 90
```

### 时间（Time）

`Time` 是某个时区中的一个时刻：`new Time()` 是默认时区（`TZ` 环境变量，否则为系统时区）的当前时间，`timezone(name)` 返回同一时刻在另一个时区的时间。`Time` 的方法从不修改实例本身：设置方法和运算都返回新的 `Time`。

#### 时区

```typescript
import {Time} from 'lakutata'

//带偏移（或 Z）的 ISO 8601 字符串表示确切的时刻；不带偏移时，按默认时区读取
const meeting: Time = new Time('2024-03-09T15:00:00Z')
console.log(meeting.timezone('Asia/Shanghai').format(), meeting.timezone('America/New_York').format())
//2024-03-09T23:00:00+08:00 2024-03-09T10:00:00-05:00
const paris: Time = meeting.timezone('Europe/Paris')
console.log(paris.timezone(), paris.utcOffset(), paris.hours())
//Europe/Paris 60 16
//按该时区的本地时间设置各字段
console.log(paris.hours(9).minutes(30).format())
//2024-03-09T09:30:00+01:00
console.log(Time.timezones().includes('Asia/Kolkata'))
//true
```

不带偏移的字符串和本地时间字段数组，构造函数按默认时区读取，比较方法和 `diff()` 则按实例的时区读取（`paris.isSame('2024-03-09', 'day')` 比较的是巴黎的这一天）。运行时不认识的时区，`timezone()` 会抛出 `RangeError`；`timezone('')` 返回默认时区的时间。从 `Date` 继承的方法（`getHours()`、`setHours()`……）使用进程的时区，而且其中的设置方法会修改实例本身：请改用 `Time` 的方法。

#### 格式

`format()` 使用 moment 的格式符（英文）；方括号中的文字原样输出。

```typescript
import {Time} from 'lakutata'

const time: Time = new Time('2024-03-09T15:04:05.123Z').timezone('America/New_York')
console.log(time.format())
//2024-03-09T10:04:05-05:00
console.log(time.format('YYYY-MM-DD HH:mm:ss.SSS Z'))
//2024-03-09 10:04:05.123 -05:00
console.log(time.format('dddd, MMMM Do YYYY [at] h:mm A z'))
//Saturday, March 9th 2024 at 10:04 AM EST
console.log(time.format('LLLL'), '|', time.format('X'))
//Saturday, March 9, 2024 10:04 AM | 1709996645
console.log(time.toObject())
//{years: 2024, months: 2, date: 9, hours: 10, minutes: 4, seconds: 5, milliseconds: 123}
```

#### 运算和比较

```typescript
import {Time} from 'lakutata'

const start: Time = new Time('2024-03-09T12:00:00Z').timezone('America/New_York')
//跨越夏令时切换时，按天加减保持本地时间不变，按小时加减则移动时刻
console.log(start.add(1, 'day').format(), start.add(24, 'hours').format())
//2024-03-10T07:00:00-04:00 2024-03-10T08:00:00-04:00
//目标月份没有这一天时，取该月的最后一天
console.log(new Time('2024-01-31T12:00:00Z').timezone('UTC').add(1, 'month').format('YYYY-MM-DD'))
//2024-02-29
console.log(start.startOf('week').format(), start.endOf('month').format('YYYY-MM-DD HH:mm:ss.SSS'))
//2024-03-03T00:00:00-05:00 2024-03-31 23:59:59.999
console.log(start.add(1, 'day').diff(start, 'days'), start.add(1, 'day').diff(start, 'hours'))
//1 23
console.log(start.isSame('2024-03-09T23:00:00-05:00', 'day'), start.isBefore('2024-03-10T00:00:00-05:00'))
//true true
console.log(start.isBetween('2024-03-01', '2024-03-31', null, '[]'), Time.max(start, start.add(1, 'h')).format())
//true 2024-03-09T08:00:00-05:00
```

- `add()` 和 `subtract()` 对年、季度、月、周、日按本地时间移动（小数会四舍五入：`1.5` 天就是 2 天），对时、分、秒、毫秒按时刻移动。
- 夏令时切换时跳过的本地时间（时钟从 02:00 跳到 03:00 时的 02:30），会向后顺延跳过的时长（变成 03:30），无论它是从哪个时间算出来的。出现两次的时间（时钟往回拨时），尽量保持计算起点的偏移，否则取较早的那一个。
- `diff()` 计算 `this - other`，结果向零截断，第三个参数为 `true` 时不截断；月按日历月计算，天按本地时间的天数计算。
- 无效的时间（数组中的字段超出范围）不会抛出异常：它的 `format()` 返回 `'Invalid date'`，`Time.max()` 和 `Time.min()` 会忽略它。

## API

以下全部由 `lakutata/utils` 和 `@lakutata/utils` 导出，`Time` 也由 `lakutata` 导出。类型声明中的每一项都附有说明和示例。

### 时间（Time）

| 导出 | 说明 |
|---|---|
| `Time` | 某个时区中的日期时间：`timezone`，各字段的读取和设置方法（`year`、`month`、`date`、`hours`、`weekday`、`isoWeeks`……），`get`/`set`、`add`/`subtract`、`startOf`/`endOf`、`format`、`diff`、`isBefore`/`isSame`/`isAfter`/`isBetween`、`toObject`、`clone`；静态方法 `timezones`、`max`、`min` |
| `TimeInput` | `new Time()` 和比较方法接受的值：`Time`、`Date`、毫秒数、日期字符串、本地时间字段 |
| `TimeObject` | `toObject()` 返回的本地时间字段 |
| `UnitOfTime` | `Time` 各方法使用的单位（`'day'`、`'days'`、`'d'`……） |

### 字符串

| 导出 | 说明 |
|---|---|
| `camelCase` | 把任意命名风格的字符串转为 camelCase |
| `noCase`、`NoCaseOptions`、`SplitOptions` | 把任意命名风格的字符串转为以空格分隔的小写单词 |
| `templating`、`TemplatingOptions`、`MissingValueError` | 填充模板中的 `{key}` 和 `{{key}}`（会做 HTML 转义）占位符 |
| `randomString` | 指定长度的随机字符串，字符取自预设或自定义的字符集 |
| `nonceString` | 由 32 个字母和数字组成的随机字符串 |

### 对象和类

| 导出 | 说明 |
|---|---|
| `As` | 把值转换为某个类型，仅供类型检查 |
| `cloneDeep` | 深拷贝一个值，保留类、集合和循环引用 |
| `ObjectPath` | 按路径（`'a.b[0].c'`）读取、设置和检查嵌套属性；拒绝经过原型的路径 |
| `getObjectPropertyPaths` | 列出对象中叶子值的路径 |
| `getObjectNestingDepth` | 计算对象的嵌套深度 |
| `isEmptyObject` | 值是否为空：`null`、`undefined`、空的 `Map` 或 `Set`、没有自有属性的对象 |
| `objectHash`、`ObjectHashOptions` | 按内容计算值的哈希，与键的顺序无关 |
| `sortKeys`、`SortKeysOptions` | 复制一个普通对象，并按比较函数给键排序 |
| `sortObject`、`SortObjectOptions` | 复制一个普通对象，并按字母顺序排列键 |
| `objectToMap` | 把对象转为由它的属性组成的 Map |
| `objectConstructor` | 对象的类 |
| `objectPrototype` | 类的原型 |
| `objectParentConstructor`、`objectParentConstructors` | 类的父类，以及它的所有祖先 |
| `isSubclassOf` | 一个类是否继承自另一个类 |

### 数组和集合

| 导出 | 说明 |
|---|---|
| `sortArray`、`SortArrayOptions` | 原地排序数组，按元素本身或其属性排序 |
| `uniqueArray` | 去除数组中的重复元素 |
| `mergeArray`、`mergeSet`、`mergeMap` | 把两个数组、集合或 Map 合并为新的一个 |
| `arrayToSet`、`setToArray` | 数组和集合之间的转换 |
| `convertArrayLikeToIterable`、`convertArrayLikeToStream` | 以迭代或流的方式读取字符串、Buffer 或类型化数组中的元素 |
| `Statistics`、`LinearRegression` | 数值的均值、分位数、偏差、回归、分布和随机抽样 |

### 异步、进程和文件

| 导出 | 说明 |
|---|---|
| `delay` | 等待指定的毫秒数 |
| `gracefulExit` | 执行完清理函数后退出进程 |
| `DevNull` | 接受任意参数并忽略它们 |
| `isPromise`、`isPromiseLike` | 值是否是真正的 Promise，或者任意 thenable |
| `isAbortError` | 错误是否是中止错误：名为 `AbortError`（`AbortController.abort()`、`fetch`），或者错误码为 `ABORT_ERR`（Node.js） |
| `pathExists` | 文件或目录是否存在 |
| `isPath` | 字符串是否具有文件系统路径的形式 |
| `Glob`、`GlobSync`、`GlobOptions` | 列出匹配 glob 模式的文件 |
| `isGlobString` | 字符串是否是 glob 模式 |

### 编码、哈希和标识符

| 导出 | 说明 |
|---|---|
| `md5`、`sha1`、`sha256` | 字符串的摘要，返回 `Buffer` |
| `MessagePack` | 在值与 MessagePack 字节或字符串之间序列化和反序列化（`Map` 解码为对象，`Set` 解码为数组） |
| `UUID`、`UUIDTypes`、`UUIDVersion1Options`、`UUIDVersion4Options`、`UUIDVersion6Options` | 生成（v1、v3、v4、v5、v6）、校验、解析和格式化 UUID |
| `URLBuilder`、`URLAttributes` | 把任意协议的 URL 解析为各个属性，或由属性构建 URL |
| `hexToUnsigned`、`unsignedToHex` | 十六进制与无符号整数互转 |
| `hexToSigned`、`signedToHex` | 十六进制与有符号整数（补码）互转 |
| `hexToIEEE754`、`ieee754ToHex` | 十六进制与 IEEE 754 浮点数互转 |
| `IP`、`IPv4`、`IPv6`、`IPBinHex`、`IPv4Subnet`、`IPv6Subnet`、`IPv6Result` | 校验、转换和比较 IP 地址和 CIDR 网段 |

### 类型判断

| 导出 | 说明 |
|---|---|
| `isSymbol` | 值是否是 symbol |
| `isNativeFunction` | 函数是否是原生实现的 |
| `isHTML` | 字符串看起来是否像 HTML |
| `isXML` | 字符串是否是格式良好的 XML 文档 |

## 错误

这些工具抛出标准的 JavaScript 错误，另外还有一个自己的错误类；类型判断函数（`is*`）返回 `false`，而不是抛出异常。

| 错误 | 什么时候抛出 |
|---|---|
| `RangeError` | `new Time()`（以及 `Time` 的比较方法）收到的字符串不是日期；`Time` 实例的 `timezone()` 收到未知时区；`randomString()` 的长度为负数或小数，或者字符集为空；`signedToHex()`/`unsignedToHex()` 收到的数不是整数，或者超出位宽；`hexToSigned()`/`hexToUnsigned()` 的值超过 `Number.MAX_SAFE_INTEGER`；`hexToIEEE754()` 收到的十六进制位数不是 8 或 16；`UUID.v1()`/`UUID.v3()`/`UUID.v4()`/`UUID.v5()`/`UUID.v6()` 收到的缓冲区太小（这时不会写入任何内容）；`MessagePack.encode()` 收到超出 64 位范围的 `bigint`；`MessagePack.decode()` 收到空的或被截断的字节 |
| `SyntaxError` | `hexToSigned()`、`hexToUnsigned()`、`hexToIEEE754()` 收到不是十六进制数字的字符，或者一个数字都没有 |
| `TypeError` | `UUID.parse()`、`UUID.version()`、`UUID.v3()`/`UUID.v5()` 收到无效的 UUID；`sortKeys()`/`sortObject()` 收到的值既不是普通对象也不是数组；`sortArray()` 按属性排序时，有元素为 `null` 或 `undefined`；`ObjectPath.set()` 的路径经过 `null` 值，或者经过 `__proto__`、`constructor` 或 `prototype`；`templating()` 的模板不是字符串 |
| `MissingValueError` | `templating()` 的某个占位符没有值，并且没有设置 `ignoreMissing` |
| `Error` | `objectHash()` 收到 `undefined`、未知的算法或编码，或者在没有设置 `ignoreUnknown` 时收到不支持的类型（`Promise`）；`MessagePack.encode()` 收到函数、symbol、既不是字符串也不是数字的 `Map` 键，或者嵌套超过 100 层；`Statistics` 的方法收到空数组或太短的数组 |

每个辅助函数的类型声明都列出了它会抛出的错误。

## 另见

- 网站上的指南：[时间（Time）](https://lakutata.com/zh/guide/Time)、[辅助函数](https://lakutata.com/zh/guide/HelperFunctions)。
- `lakutata` 包中的 `doc/zh/HelperFunctions.md` 和 `doc/zh/Time.md`：辅助函数和 `Time` 的指南。
- `@lakutata/core`（`lakutata`）：`Application`、组件和依赖注入；它重新导出了 `Time`。
- `@lakutata/security`（`lakutata/security`）：密码、签名和加密；要把哈希当作秘密使用时，请用它。

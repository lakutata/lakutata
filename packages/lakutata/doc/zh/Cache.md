# Lakutata 缓存

**Cacher 组件**（`lakutata/com/cacher`，`@lakutata/cache` 包）是一个条目会过期的键值缓存。条目可以保存在进程的内存中、一个文件中，或者应用各实例共用的服务器上：Redis、Memcache、MongoDB、SQLite、PostgreSQL 或 MySQL。多个存储可以组成分层，最快的存储位于最前面。该组件的 `wrap()` 方法返回缓存的值；值不存在时，先计算并缓存该值，再将其返回。

该组件不同于数据库的查询缓存（`Database` 的 `cache` 选项，见[数据库](Database.md)）。

## 1. 第一个缓存

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildCacherOptions, type Cacher} from 'lakutata/com/cacher'

type Product = { id: number, name: string }

class Catalog extends Component {
    @Inject('cache')
    protected readonly cache: Cacher

    //只加载一次，之后从缓存读取，直到条目过期
    public async product(id: number): Promise<Product> {
        return await this.cache.wrap(`product:${id}`, (): Promise<Product> => this.load(id))
    }

    public async rename(id: number, name: string): Promise<void> {
        //先在这里更新数据库，再删除缓存中的副本
        await this.cache.del(`product:${id}`)
    }

    protected async load(id: number): Promise<Product> {
        return {id: id, name: `Product ${id}`}
    }
}

Application
    .run(() => ({
        id: 'catalog.app',
        name: 'Catalog',
        components: {
            //保存在内存中；条目 5 分钟后过期
            cache: buildCacherOptions({ttl: 300000}),
            catalog: {class: Catalog}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const catalog: Catalog = await app.getObject<Catalog>('catalog')
        console.log(await catalog.product(1))
        const cache: Cacher = await app.getObject<Cacher>('cache')
        //这个条目 30 秒后过期
        await cache.set('greeting', 'Hello', 30000)
        console.log(await cache.get<string>('greeting'))
    })
```

- `buildCacherOptions` 以选定的名称声明组件；其他对象按该名称注入组件（`@Inject('cache')`），或者通过 `getObject('cache')` 获取。整个应用共用一个实例。
- 未设置 `stores` 时，缓存将条目保存在进程的内存中。
- 所有时长都是以毫秒为单位的数字。
- 队列可以将消息的结果保存在缓存中（见[消息队列](Queue.md)第 1 节）。

## 2. 选项

| 选项 | 默认值 | 含义 |
|---|---|---|
| `stores` | 一个内存存储 | 一个存储或存储列表，最快的存储位于最前面（第 5 节和第 6 节） |
| `ttl` | 无：条目永不过期 | 写入未指定 TTL 时条目的保留时长，单位毫秒（正整数） |
| `refreshThreshold` | 无 | `wrap()` 后台刷新的默认阈值，单位毫秒（第 4 节） |
| `refreshAllStores` | `false` | 后台刷新是否将新值写入所有存储（第 5 节） |
| `nonBlocking` | `false` | 写入和删除是否不等待存储完成即返回（第 5 节） |

可以设置 `cacheId` 选项，但该选项不会被使用。

- 选项无效时，应用启动失败，抛出 `InvalidObjectOptionsException`。
- 存储在组件创建时连接。若组件列在 `bootstrap` 中，则在应用启动过程中创建，某个存储无法连接会导致启动失败；否则组件在首次使用时才创建，存储的错误会导致该次 `getObject()` 或注入失败。
- 应用停止时，缓存先等待尚未完成的后台刷新结束，再断开存储（文件存储会先保存最后的修改）。

## 3. 读取与写入

| 方法 | 作用 | 返回 |
|---|---|---|
| `set(key, value, ttl?)` | 将值写入所有存储，替换原有的值 | 写入的值 |
| `get(key)` | 读取一个值 | 值；键不存在或已过期时为 `undefined` |
| `multipleSet([{key, value, ttl?}])` | 写入多个值 | 写入的条目 |
| `multipleGet(keys)` | 读取多个值 | 各个值，顺序与键相同 |
| `getTTL(key)` | 读取条目的过期时间 | 以毫秒计的时间戳，或者 `-1` |
| `wrap(key, fn, options?)` | 读取一个值，或者计算并缓存该值（第 4 节） | 值 |
| `del(key)` | 从所有存储中删除一个键 | `true` |
| `multipleDel(keys)` | 删除多个键 | `true` |
| `clear()` | 删除每个存储的所有条目，或者其命名空间中的条目（第 6 节） | `true` |

- **TTL。** 写入时给出的 TTL 会替代 `ttl` 选项，`0` 表示条目永不过期。`ttl` 选项本身不能为 `0`，如需让条目永不过期，请不设置该选项。TTL 只能是数字，不能写成 `'1h'` 这样的文本。
- **`get()` 不会失败。** 存储读取失败视为未命中，其错误作为 `'error'` 事件发出（第 8 节）。缓存的值为 `undefined` 时，无法与未命中区分。
- **`getTTL()` 返回的是一个时间点**，而不是剩余时间，剩余时间为 `expires - Date.now()`。键不存在、已过期或条目永不过期时，该方法返回 `-1`。
- **`multipleSet()` 和 `multipleDel()` 不发出 `'set'` 和 `'del'` 事件**，这一点与 `set()`、`wrap()` 和 `del()` 不同。
- 即使键不存在，`del()` 和 `multipleDel()` 也返回 `true`。
- 存储写入或删除失败时，调用也会失败，除非设置了 `nonBlocking`（第 5 节）。

## 4. `wrap()`

`wrap(key, fn, options)` 返回键的缓存值。键不存在或已过期时，该方法调用 `fn`，缓存其结果后再返回。缓存查询结果或对其他服务的调用结果时，通常采用这种方式：

```typescript
import type {Cacher} from 'lakutata/com/cacher'

declare const cache: Cacher
declare function loadRates(): Promise<Record<string, number>>

//每小时最多加载一次；在最后 5 分钟内，先返回缓存的值，同时在后台重新加载
const rates: Record<string, number> = await cache.wrap('rates', loadRates, {ttl: 3600000, refreshThreshold: 300000})

type User = { id: number, guest: boolean }
//TTL 取决于值
const user: User = await cache.wrap('user:1', async (): Promise<User> => ({id: 1, guest: true}), {
    ttl: (value: User): number => value.guest ? 60000 : 3600000
})
```

- 第三个参数是一个 TTL（`wrap(key, fn, 60000)`），或者 `{ttl, refreshThreshold}`；两者既可以是数字，也可以是以值为参数的函数，默认分别取 `ttl` 和 `refreshThreshold` 选项。
- 某个键的一次 `wrap()` 尚未完成时，对该键的其他调用共用这次调用及其结果。这一点仅在单个组件内成立，应用的两个实例仍可能都计算该值。如果该值只能计算一次，则需要加锁（见[互斥锁](Mutex.md)）。
- `fn` 失败时，`wrap()` 以同一个错误失败，不缓存任何内容。结果为 `undefined` 时，也会与其他值一样被缓存。
- **后台刷新。** 缓存值的剩余时间少于刷新阈值时，`wrap()` 立即返回该值，同时在后台调用 `fn`，每个键同一时间只有一次刷新。新值替换旧值，并由 `'refresh'` 事件报告；`fn` 失败时，该事件报告错误，旧值保留。永不过期的条目从不刷新；阈值大于 TTL 时，每次调用都会触发刷新。
- 有多个存储时，在较低层存储中找到的值会被复制到其上层的存储，并保留其剩余时间（第 5 节）。

## 5. 多个存储

```typescript
import {Application} from 'lakutata'
import {buildCacherOptions} from 'lakutata/com/cacher'

Application.run(() => ({
    id: 'tiers.app',
    name: 'Tiers',
    components: {
        cache: buildCacherOptions({
            //每个实例在内存中保留副本，放在所有实例共用的 Redis 前面
            stores: [
                {type: 'memory'},
                {type: 'redis', host: '127.0.0.1', namespace: 'tiers'}
            ],
            ttl: 60000
        })
    }
}))
```

- 读取按顺序查询各个存储，返回找到的第一个条目。`multipleGet()` 只向下一个存储查询仍未找到的键。
- 写入和删除同时发往所有存储。
- 只有 `wrap()` 会将在较低层存储中找到的条目复制到其上层的存储；`get()` 不会。
- 后台刷新将新值写入原先保存旧值的存储及其上层的存储；设置 `refreshAllStores: true` 时，写入所有存储。
- 一个实例内存中的副本会保留到条目过期为止，即使另一个实例修改或删除了该键。如果各实例需要尽快看到修改，请将 TTL 设得短一些。
- **`nonBlocking: true`。** 写入和删除不等待存储，立即返回，并且从不失败，失败会作为事件发出（第 8 节）。有多个存储时，读取同时查询所有存储，返回最先找到的条目，该条目不一定来自第一个存储。
- 所有存储在缓存创建时连接。其中一个存储连接失败时，其他存储会断开连接，缓存的创建以该错误失败。

## 6. 存储

| `type` | 条目的保存位置 | 需要安装 |
|---|---|---|
| `'memory'` | 进程的内存中（未设置 `stores` 时缓存使用的存储） | 无 |
| `'file'` | 内存中，并保存到一个 JSON 文件 | 无 |
| `'redis'` | Redis 或 Valkey | `redis`（4 或 5） |
| `'memcache'` | memcached | `memjs` |
| `'mongo'` | MongoDB 的一个集合 | `mongodb` |
| `'sqlite'` | SQLite 文件中的一张表 | `better-sqlite3`（12）；Bun 上无需安装 |
| `'postgres'` | PostgreSQL 的一张表 | `pg` |
| `'mysql'` | MySQL 或 MariaDB 的一张表 | `mysql2` |

- 未安装存储所需的包时，缓存创建失败并抛出 `CacheDriverNotFoundException`，错误信息会注明需要安装的包。
- 除了内存存储，其他存储都以 JSON 保存值（第 7 节）。
- 除了内存存储，其他存储都接受 `namespace`，用于区分共用同一台服务器或同一张表的应用，此时 `clear()` 只删除该命名空间中的条目。未设置命名空间时，`clear()` 删除存储中的所有条目（Redis 和 Memcache 见下文）。
- 在 SQLite、PostgreSQL 和 MySQL 存储中，没有任何机制在后台删除过期的行。过期的行会保留在表中，直到被读取（此时会被删除）、被覆盖或被清空。

### 内存

| 选项 | 默认值 | 含义 |
|---|---|---|
| `sweepInterval` | `60000` | 清除过期条目的间隔，单位毫秒（过期的条目本身即视为未命中） |

值按原样保存，不复制（第 7 节）。每个进程拥有独立的条目，进程结束时条目丢失。

### 文件

| 选项 | 默认值 | 含义 |
|---|---|---|
| `filename` | 必填 | JSON 文件，相对于工作目录；文件连同目录一起自动创建 |
| `writeDelay` | `100` | 修改后保存文件的延迟，单位毫秒；这段时间内的修改会一起保存 |
| `expiredCheckDelay` | `3600000` | 两次从文件中清除过期条目之间的最短间隔，单位毫秒 |
| `namespace` | 无 | |

- 条目保存在内存中。文件在缓存创建时读取，每次保存都重写整个文件（通过一个临时文件），因此该存储适合小型缓存。应用停止时会保存最后的修改。
- 一个文件只属于一个进程，因为其他进程只在自身的缓存创建时读取文件，而每次保存都会替换其他进程保存的条目。
- 文件内容不是 JSON 时，缓存创建失败。保存失败会作为 `'error'` 事件发出。

### Redis

| 选项 | 默认值 | 含义 |
|---|---|---|
| `host` | 必填 | |
| `port` | `6379` | |
| `database` | `0` | 数据库的编号 |
| `username`、`password` | 无 | |
| `tls` | `false` | 是否使用 TLS 连接 |
| `namespace` | 无 | |
| `keyPrefixSeparator` | `'::'` | 键中位于命名空间之后的分隔符 |
| `connectTimeout` | `5000` | 首次连接的最长时间，单位毫秒 |
| `throwOnConnectError` | `true` | 首次连接失败时，是否让缓存创建失败 |
| `reconnect` | `true` | 连接断开后是否重连（每次尝试的等待时间增加 100 毫秒，最多 3 秒） |
| `keepAlive` | 驱动的默认值 | 发送第一个 TCP keep-alive 探测之前连接的空闲时间，单位毫秒 |
| `useUnlink` | `true` | 是否用 `UNLINK` 而不是 `DEL` 删除 |
| `clearBatchSize` | `1000` | `clear()` 每次扫描和删除的键数 |
| `noNamespaceAffectsAll` | `false` | 未设置命名空间时，`clear()` 是否清空整个数据库（`FLUSHDB`） |

- 键的格式为 `{namespace}::{namespace}:{key}`（Lakutata 2.x 的格式）；未设置命名空间时即为键本身。过期的条目由 Redis 自行删除。
- 未设置命名空间时，`clear()` 删除数据库中命名空间之外的字符串键（不含 `::` 的键），命名空间中的键以及其他类型的键（哈希、列表……）都会保留。设置 `noNamespaceAffectsAll: true` 时，该方法清空整个数据库。
- `clear()` 按类型扫描键，这需要 Redis 6 或更高版本。
- 连接断开期间，命令会立即失败而不是等待，读取视为未命中，写入失败。设置 `throwOnConnectError: false` 时，即使 Redis 未运行，缓存也能创建，并会继续尝试连接。
- 存储使用 `redis` 包；未安装 `redis` 时，使用 `@redis/client`。

### Memcache

| 选项 | 默认值 | 含义 |
|---|---|---|
| `host` | 必填 | |
| `port` | `11211` | |
| `username`、`password` | 无 | 用于需要 SASL 认证的服务器 |
| `namespace` | 无 | |

- 客户端在执行第一条命令时才连接，因此无法连接服务器不会导致缓存创建失败，但读取会未命中，写入会失败。
- memcached 以秒为单位计算 TTL，因此条目在服务器上最多可能多保留两秒，但 TTL 到期后即视为未命中。
- 无论是否设置命名空间，`clear()` 都会清空整个服务器，其他应用的条目也会被删除。

### MongoDB

| 选项 | 默认值 | 含义 |
|---|---|---|
| `host`、`database`、`collection` | 必填 | 集合不存在时会自动创建 |
| `port` | `27017` | |
| `username`、`password` | 无 | 用户在 `admin` 数据库上认证 |
| `namespace` | 无 | |

- 每个条目是一个文档。缓存创建时，会在键上创建唯一索引，并创建一个 TTL 索引，MongoDB 借助该索引删除过期的文档，大约每分钟一次；在此之前，过期的文档视为未命中。
- 连接失败会导致缓存创建失败。

### SQLite

| 选项 | 默认值 | 含义 |
|---|---|---|
| `database` | 必填 | 数据库文件，相对于工作目录，所在目录必须已经存在；或者 `':memory:'` |
| `table` | 必填 | 表，不存在时会自动创建 |
| `busyTimeout` | `10000` | 数据库被其他连接锁定时，语句的最长等待时间，单位毫秒 |
| `namespace` | 无 | |

- `table` 中字母、数字和 `_` 以外的字符会被去除。
- 语句同步执行，因此等待被锁定的数据库时，语句会阻塞事件循环，最长可达 `busyTimeout`。
- `better-sqlite3` 是原生插件，针对特定的运行时构建。Electron 应用需要使用针对其 Electron 版本构建的 `better-sqlite3`；NW.js 应用会用 NW.js 的头文件重新构建该插件（需要 0.111.3 及以后的版本，更早的版本无法加载该插件）。在 Bun 上，存储改用 `bun:sqlite`。

### PostgreSQL

| 选项 | 默认值 | 含义 |
|---|---|---|
| `host`、`database`、`table` | 必填 | |
| `port` | `5432` | |
| `schema` | `'public'` | 表所在的模式 |
| `username`、`password` | 驱动的默认值 | 未设置 `username` 时，取环境变量 `PGUSER`，否则取进程的用户 |
| `maxPoolSize` | `10` | 最大连接数 |
| `namespace` | 无 | |

- 缓存创建时，会创建尚不存在的模式和表：`(key VARCHAR(255) PRIMARY KEY, value TEXT)`。PostgreSQL 会将普通名称转换为小写，例如 `table: 'Entries'` 创建的是 `entries`。连接或创建失败会导致缓存创建失败。
- 键长度超过 255 个字符（包括命名空间）时，写入失败。

### MySQL

| 选项 | 默认值 | 含义 |
|---|---|---|
| `host`、`database`、`table` | 必填 | |
| `port` | `3306` | |
| `username`、`password` | 驱动的默认值 | |
| `namespace` | 无 | |

- 缓存创建时，如果表不存在，则会创建该表：`(id VARCHAR(255) PRIMARY KEY, value MEDIUMTEXT)`，键区分大小写。连接或创建失败会导致缓存创建失败。
- 键长度超过 255 个字符（包括命名空间）时，写入失败；单个值的 JSON 最大为 16 MB。

## 7. 存储保存的值

内存存储保存值本身，因此对象在缓存后被修改时，缓存中的对象也会随之改变；读取返回的正是所缓存的对象。必要时请复制对象。

其他存储以 JSON 保存值，因此部分值读回时会有所不同：

| 缓存的值 | 读回的值 |
|---|---|
| `Date` | 其 ISO 字符串（`'2026-01-02T03:04:05.000Z'`） |
| 类的实例 | 带有其字段的普通对象，没有方法 |
| `Map` 或 `Set` | `{}` |
| `NaN`、`Infinity` | `null` |
| `Buffer` | `Buffer` |
| `bigint` | 写入失败，抛出 `TypeError` |

内存存储位于其他存储之前时，同一个键读回的可能是值本身，也可能是其 JSON 副本，具体取决于条目所在的存储。因此请缓存 JSON 能够原样保存的值：普通对象、数组、字符串、数字和布尔值。

## 8. 事件与错误

| 事件 | 触发时机 | 参数 |
|---|---|---|
| `'set'` | `set()` 或 `wrap()` 写入了一个值，或者写入失败 | `{key, value, error?}` |
| `'del'` | `del()` 删除了一个键，或者删除失败 | `{key, error?}` |
| `'clear'` | `clear()` 完成 | 无参数，或者错误 |
| `'refresh'` | `wrap()` 的一次后台刷新完成 | `{key, value, error?}`：新值，或者旧值和错误 |
| `'error'` | 存储出错，且没有其他事件报告该错误（见下文） | 错误 |

```typescript
import type {Cacher, OnRefreshEventData} from 'lakutata/com/cacher'

declare const cache: Cacher

cache.on('refresh', (data: OnRefreshEventData): void => {
    if (data.error) console.warn(`Refreshing ${data.key} failed, the cached value is kept`)
})
//读取失败、连接断开、文件保存失败……
cache.on('error', (error: Error): void => console.error('Cache store error', error))
```

- `'error'` 事件报告以下情况：读取失败（视为未命中）、`multipleSet()` 和 `multipleDel()` 失败、`wrap()` 复制到上层存储失败、连接断开，以及文件存储保存失败。没有监听器时，这些错误会被丢弃，因此如需了解存储何时出现问题，请监听该事件。
- 监听器在事件发出之后异步调用。
- 未设置 `nonBlocking` 时，存储写入或删除失败会导致调用失败，并抛出驱动的错误。设置 `nonBlocking` 时，`'set'` 和 `'del'` 在写入存储之前即发出，失败时会再发出一次带有错误的事件。

| 错误 | 抛出时机 |
|---|---|
| `InvalidObjectOptionsException` | 应用启动时，选项无效 |
| `CacheDriverNotFoundException`（`E_CACHE_DRIVER_NOT_FOUND`） | 缓存创建时，存储所需的包未安装 |
| 驱动的错误 | 缓存创建时无法连接存储，或者存储写入、删除失败 |

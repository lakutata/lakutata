# @lakutata/cache

[English](README.md) | 中文

lakutata 框架的缓存组件：一个键值缓存，其中的条目会过期（TTL 以毫秒为单位）。它提供 cache-aside 方式的 `wrap()` 方法（可以在后台刷新值），还会发出事件。条目保存在一个或多个存储中：内存、JSON 文件、Redis、Memcache、MongoDB、SQLite、PostgreSQL 或 MySQL。多个存储组成分层，最快的在最前面。`lakutata` 包把它重新导出为 `lakutata/com/cacher`。

## 安装

```shell
npm install lakutata
```

内存存储和文件存储不需要再安装其他包。其他存储所需的包都是可选的 peer 依赖：用到哪个存储，就安装哪个存储的包。缺少存储的包时，创建缓存会失败，抛出 `CacheDriverNotFoundException`。

| 存储 | `type` | 需要安装 |
|---|---|---|
| 内存（没有设置 `stores` 时的默认存储） | `'memory'` | 无 |
| JSON 文件 | `'file'` | 无 |
| Redis 或 Valkey（`clear()` 需要 Redis 6+） | `'redis'` | `redis`（4 或 5） |
| Memcache | `'memcache'` | `memjs` |
| MongoDB | `'mongo'` | `mongodb` |
| SQLite | `'sqlite'` | `better-sqlite3`（12）；Bun 上无需安装（`bun:sqlite`） |
| PostgreSQL | `'postgres'` | `pg` |
| MySQL / MariaDB | `'mysql'` | `mysql2` |

## 用法

### 在应用中使用缓存

用 `buildCacherOptions` 注册 `Cacher` 组件，然后用 `getObject()` 或 `@Inject` 获取它。没有 `stores` 时，缓存保存在内存中。

```typescript
import {Application} from 'lakutata'
import {buildCacherOptions, type Cacher} from 'lakutata/com/cacher'

Application
    .run(() => ({
        id: 'cache.app',
        name: 'Cache',
        components: {
            //条目 10 分钟后过期，除非写入时给出了其他 TTL
            cache: buildCacherOptions({ttl: 600000})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const cache: Cacher = await app.getObject('cache')
        await cache.set('user:1', {id: 1, name: 'Ada'})
        //这个条目自己的 TTL（30 秒）；0 表示永不过期
        await cache.set('session:abc', 'token', 30000)
        console.log(await cache.get<{id: number, name: string}>('user:1'))
        //undefined：键不存在或已过期
        console.log(await cache.get('user:2'))
        await cache.multipleSet([{key: 'a', value: 1}, {key: 'b', value: 2, ttl: 5000}])
        console.log(await cache.multipleGet(['a', 'b', 'c'])) //[1, 2, undefined]
        await cache.del('session:abc')
        await cache.clear()
    })
```

### 用 `wrap()` 实现 cache-aside

`wrap()` 返回缓存的值；没有缓存的值时，先计算出值并缓存起来，再返回。对同一个键的并发调用共用一次计算。设置了刷新阈值时，快要过期的值会立即返回，同时在后台重新计算。

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import type {Cacher} from 'lakutata/com/cacher'

type Weather = {city: string, celsius: number}

class WeatherService extends Component {
    @Inject('cache')
    protected readonly cache: Cacher

    public async weather(city: string): Promise<Weather> {
        //每 10 分钟最多获取一次；在最后 2 分钟内，先返回缓存的值，同时在后台重新获取
        return this.cache.wrap(`weather:${city}`, (): Promise<Weather> => this.fetch(city), {
            ttl: 600000,
            refreshThreshold: 120000
        })
    }

    protected async fetch(city: string): Promise<Weather> {
        return {city: city, celsius: 21}
    }
}
```

### 存储与分层

```typescript
import {Application} from 'lakutata'
import {buildCacherOptions} from 'lakutata/com/cacher'

Application.run(() => ({
    id: 'tiers.app',
    name: 'Tiers',
    components: {
        cache: buildCacherOptions({
            //读取时取第一个有这个键的存储；写入和删除同时作用于两个存储
            stores: [
                {type: 'file', filename: './cache/local.json'},
                {type: 'redis', host: '127.0.0.1', namespace: 'tiers'}
            ],
            ttl: 300000
        })
    }
}))
```

- 读取时，从第一个有这个条目的存储中返回它。只有 `wrap()` 会把在较低层存储中找到的条目复制到上面各层的存储。
- 读取失败算作未命中，错误作为 `'error'` 事件发出。写入或删除失败时，调用也会失败，除非设置了 `nonBlocking: true`（此时调用不等待存储就返回）。
- 某个存储连不上时，创建缓存会失败（设置了 `throwOnConnectError: false` 的 Redis 存储则会在后台继续尝试连接）。只有缓存在应用启动过程中创建时，应用才会启动失败：缓存列在 `bootstrap` 中，或者被注入到列在其中的对象里。否则，失败的是创建它的那次 `getObject()` 调用或注入。
- 内存存储保存值的引用。其他存储以 JSON 保存值：`Buffer` 读回来仍是 `Buffer`，但 `Date` 读回来是它的 ISO 字符串，类的实例读回来是普通对象。
- `namespace` 用来区分共用同一个后端的应用：此时 `clear()` 只删除这个命名空间中的条目（Memcache 例外，它的 `clear()` 会清空整个服务器）。

### 事件

```typescript
import type {Cacher, OnRefreshEventData, OnSetEventData} from 'lakutata/com/cacher'

declare const cache: Cacher

cache.on('set', (data: OnSetEventData): void => {
    if (data.error) console.error(`Writing ${data.key} failed`, data.error)
})
cache.on('refresh', (data: OnRefreshEventData): void => {
    if (data.error) console.warn(`Refreshing ${data.key} failed, the cached value is kept`)
})
//调用不会报告的错误：读取失败（算作未命中）、连接断开、文件保存失败
cache.on('error', (error: Error): void => console.error('Cache store error', error))
```

## API

| 导出 | 说明 |
|---|---|
| `Cacher` | 组件：`set`、`get`、`multipleSet`、`multipleGet`、`getTTL`、`wrap`、`del`、`multipleDel`、`clear`；事件 `set`、`del`、`clear`、`refresh`、`error` |
| `buildCacherOptions` | 生成 `Cacher` 的组件选项 |
| `CacherOptions` | 选项：`stores`、`ttl`、`refreshThreshold`、`refreshAllStores`、`nonBlocking` |
| `CacheStoreOptions` | 单个存储的选项，以 `type` 区分 |
| `MemoryCacheOptions`、`FileCacheOptions`、`RedisCacheOptions`、`MemcacheCacheOptions`、`MongoCacheOptions`、`SqliteCacheOptions`、`PostgresCacheOptions`、`MysqlCacheOptions` | 各个存储的选项 |
| `WrapOptions` | 一次 `wrap()` 调用的 TTL 和刷新阈值 |
| `MultipleSetInput` | 传给 `multipleSet()` 的一个条目 |
| `OnSetEventData`、`OnDeleteEventData`、`OnRefreshEventData` | `set`、`del` 和 `refresh` 事件的数据 |
| `CacheDriverNotFoundException` | 存储的驱动包没有安装 |

以上全部由 `lakutata/com/cacher` 和 `@lakutata/cache` 导出。类型声明中的每一项都附有说明和示例。

## 错误

| 异常 | 什么时候抛出 |
|---|---|
| `CacheDriverNotFoundException`（`E_CACHE_DRIVER_NOT_FOUND`） | 创建缓存时，某个存储的驱动包（`redis`、`memjs`、`mongodb`、`better-sqlite3`、`pg`、`mysql2`）没有安装 |
| `InvalidObjectOptionsException`（来自 `lakutata`） | 缓存的某个选项的值不合法；应用启动失败 |

存储出错（连接被拒绝、查询失败）时，报告的是各自驱动的错误。连接失败会让缓存创建失败，写入或删除失败会让调用失败（除非设置了 `nonBlocking`），读取失败则作为 `'error'` 事件发出。

## 另见

- `lakutata` 包中的 `doc/zh/Cache.md`：缓存指南。
- `@lakutata/core`（`lakutata`）：组件、`Application` 和依赖注入（见 `lakutata` 包中的 `doc/zh/Objects.md` 和 `doc/zh/Injection.md`）。
- `@lakutata/mutex`（`lakutata/com/mutex`）：锁，用来让缓存的值同一时间只在一个实例中计算。

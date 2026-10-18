# @lakutata/cache

English | [中文](README.zh-CN.md)

The cache component of the lakutata framework: a key-value cache whose entries expire (TTLs are in milliseconds),
with a cache-aside `wrap()` method that can refresh values in the background, and events. It is backed by one or more
stores: memory, a JSON file, Redis, Memcache, MongoDB, SQLite, PostgreSQL or MySQL. Several stores form tiers, with the
fastest first. The umbrella package `lakutata` re-exports it as `lakutata/com/cacher`.

## Installation

```shell
npm install lakutata
```

The memory and file stores need nothing else. The other stores rely on optional peer dependencies: install the
package of each store you use. When a store's package is missing, creating the cache fails with
`CacheDriverNotFoundException`.

| Store | `type` | Install |
|---|---|---|
| Memory (the default when `stores` is not set) | `'memory'` | none |
| JSON file | `'file'` | none |
| Redis or Valkey (`clear()` needs Redis 6+) | `'redis'` | `redis` (4 or 5) |
| Memcache | `'memcache'` | `memjs` |
| MongoDB | `'mongo'` | `mongodb` |
| SQLite | `'sqlite'` | `better-sqlite3` (12); none on Bun (`bun:sqlite`) |
| PostgreSQL | `'postgres'` | `pg` |
| MySQL / MariaDB | `'mysql'` | `mysql2` |

## Usage

### A cache in an application

Register the `Cacher` component with `buildCacherOptions`, then get it with `getObject()` or `@Inject`. Without
`stores`, it caches in memory.

```typescript
import {Application} from 'lakutata'
import {buildCacherOptions, type Cacher} from 'lakutata/com/cacher'

Application
    .run(() => ({
        id: 'cache.app',
        name: 'Cache',
        components: {
            //Entries expire after 10 minutes unless a write gives another TTL
            cache: buildCacherOptions({ttl: 600000})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const cache: Cacher = await app.getObject('cache')
        await cache.set('user:1', {id: 1, name: 'Ada'})
        //A TTL of its own (30 seconds); 0 never expires
        await cache.set('session:abc', 'token', 30000)
        console.log(await cache.get<{id: number, name: string}>('user:1'))
        //undefined: a missing or expired key
        console.log(await cache.get('user:2'))
        await cache.multipleSet([{key: 'a', value: 1}, {key: 'b', value: 2, ttl: 5000}])
        console.log(await cache.multipleGet(['a', 'b', 'c'])) //[1, 2, undefined]
        await cache.del('session:abc')
        await cache.clear()
    })
```

### Cache-aside with `wrap()`

`wrap()` returns the cached value; when there is none, it computes the value, caches it and returns it. Concurrent
calls for the same key share one computation. With a refresh threshold, a value that is about to expire is returned at
once and recomputed in the background.

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import type {Cacher} from 'lakutata/com/cacher'

type Weather = {city: string, celsius: number}

class WeatherService extends Component {
    @Inject('cache')
    protected readonly cache: Cacher

    public async weather(city: string): Promise<Weather> {
        //Fetched at most every 10 minutes; in the last 2 minutes, served while fetched again in the background
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

### Stores and tiers

```typescript
import {Application} from 'lakutata'
import {buildCacherOptions} from 'lakutata/com/cacher'

Application.run(() => ({
    id: 'tiers.app',
    name: 'Tiers',
    components: {
        cache: buildCacherOptions({
            //Read from the first store holding the key; written to and deleted from both
            stores: [
                {type: 'file', filename: './cache/local.json'},
                {type: 'redis', host: '127.0.0.1', namespace: 'tiers'}
            ],
            ttl: 300000
        })
    }
}))
```

- A read returns the entry from the first store that holds it. Only `wrap()` copies an entry found in a lower store
  to the stores above it.
- A failed read counts as a miss, and its error is emitted as an `'error'` event. A failed write or deletion rejects
  the call, unless `nonBlocking: true` is set (calls then return without waiting for the stores).
- When a store cannot connect, creating the cache fails (a Redis store with `throwOnConnectError: false` keeps trying
  in the background instead). The application fails to start only when the cache is created during the start: when it
  is listed in `bootstrap`, or injected into an object that is. Otherwise the `getObject()` call or the injection that
  creates it fails.
- The memory store keeps values by reference. The other stores keep them as JSON: a `Buffer` comes back as a
  `Buffer`, but a `Date` comes back as its ISO string and a class instance as a plain object.
- `namespace` keeps apart applications that share a backend: `clear()` then deletes only the entries in the namespace
  (except with Memcache, where `clear()` flushes the whole server).

### Events

```typescript
import type {Cacher, OnRefreshEventData, OnSetEventData} from 'lakutata/com/cacher'

declare const cache: Cacher

cache.on('set', (data: OnSetEventData): void => {
    if (data.error) console.error(`Writing ${data.key} failed`, data.error)
})
cache.on('refresh', (data: OnRefreshEventData): void => {
    if (data.error) console.warn(`Refreshing ${data.key} failed, the cached value is kept`)
})
//The errors no call reports: failed reads (misses), lost connections, failed file saves
cache.on('error', (error: Error): void => console.error('Cache store error', error))
```

## API

| Export | What it is |
|---|---|
| `Cacher` | The component: `set`, `get`, `multipleSet`, `multipleGet`, `getTTL`, `wrap`, `del`, `multipleDel`, `clear`; the events `set`, `del`, `clear`, `refresh`, `error` |
| `buildCacherOptions` | Builds the component options for a `Cacher` |
| `CacherOptions` | The options: `stores`, `ttl`, `refreshThreshold`, `refreshAllStores`, `nonBlocking` |
| `CacheStoreOptions` | The options of a single store, distinguished by `type` |
| `MemoryCacheOptions`, `FileCacheOptions`, `RedisCacheOptions`, `MemcacheCacheOptions`, `MongoCacheOptions`, `SqliteCacheOptions`, `PostgresCacheOptions`, `MysqlCacheOptions` | The options of each store |
| `WrapOptions` | The TTL and refresh threshold of a `wrap()` call |
| `MultipleSetInput` | An entry passed to `multipleSet()` |
| `OnSetEventData`, `OnDeleteEventData`, `OnRefreshEventData` | The data of the `set`, `del` and `refresh` events |
| `CacheDriverNotFoundException` | A store's driver package is not installed |

All of them are exported by `lakutata/com/cacher` and `@lakutata/cache`. The typings document every declaration, with
examples.

## Errors

| Exception | Thrown when |
|---|---|
| `CacheDriverNotFoundException` (`E_CACHE_DRIVER_NOT_FOUND`) | The cache is created with a store whose driver package (`redis`, `memjs`, `mongodb`, `better-sqlite3`, `pg`, `mysql2`) is not installed |
| `InvalidObjectOptionsException` (from `lakutata`) | An option of the cache has an invalid value; the application fails to start |

Store failures (a refused connection, a failed query) are reported with the errors of their drivers. A failure to
connect makes the cache's creation fail, a failed write or deletion rejects the call (unless `nonBlocking` is set), and
a failed read is emitted as an `'error'` event.

## See also

- The guide on the website: [Cache](https://lakutata.com/guide/Cache).
- `doc/en/Cache.md` in the `lakutata` package (Chinese version in `doc/zh`): the guide to the cache.
- `@lakutata/core` (`lakutata`): components, `Application` and dependency injection (see `doc/en/Objects.md` and
  `doc/en/Injection.md` in the `lakutata` package, and their Chinese versions in `doc/zh`).
- `@lakutata/mutex` (`lakutata/com/mutex`): locks, to compute a cached value in only one instance at a time.

# @lakutata/cache

The cache component of the lakutata framework: a key-value cache with expiration (TTLs in milliseconds), the
cache-aside `wrap()` with its background refresh, and events, backed by one or more stores: memory, a JSON file,
Redis, Memcache, MongoDB, SQLite, PostgreSQL or MySQL. Several stores make tiers, the fastest first. The umbrella
package `lakutata` re-exports it as `lakutata/com/cacher`.

## Installation

```shell
npm install lakutata
```

The memory and file stores need nothing more; the other stores use optional peer dependencies, installed when used.
A store whose package is missing fails the cache's creation with `CacheDriverNotFoundException`.

| Store | `type` | Install |
|---|---|---|
| Memory (also the store of a cache without `stores`) | `'memory'` | none |
| JSON file | `'file'` | none |
| Redis 4+ (or Valkey) | `'redis'` | `redis` (4 or 5) |
| Memcache | `'memcache'` | `memjs` |
| MongoDB | `'mongo'` | `mongodb` |
| SQLite | `'sqlite'` | `sqlite3` |
| PostgreSQL | `'postgres'` | `pg` |
| MySQL / MariaDB | `'mysql'` | `mysql2` |

## Usage

### A cache in an application

Register the `Cacher` component with `BuildCacherOptions`, then get it with `getObject()` or `@Inject`. Without
`stores`, it caches in memory.

```typescript
import {Application} from 'lakutata'
import {BuildCacherOptions, type Cacher} from 'lakutata/com/cacher'

Application
    .run(() => ({
        id: 'cache.app',
        name: 'Cache',
        components: {
            //Entries expire after 10 minutes unless a write gives another TTL
            cache: BuildCacherOptions({ttl: 600000})
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

`wrap()` returns the cached value, or computes it, caches it and returns it. The concurrent calls on one key share one
computation. With a refresh threshold, a value close to its expiration is returned at once and recomputed in the
background.

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
import {BuildCacherOptions} from 'lakutata/com/cacher'

Application.run(() => ({
    id: 'tiers.app',
    name: 'Tiers',
    components: {
        cache: BuildCacherOptions({
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

- A read returns the entry of the first store holding it; only `wrap()` copies an entry found in a lower store to
  the stores above it.
- A store failing to read is a miss; its error is emitted as an `'error'` event. A store failing to write or delete
  rejects the call, unless `nonBlocking: true` (the calls then return without waiting for the stores).
- A store which cannot connect when the cache starts fails its creation, and so the application's start (a Redis
  store with `throwOnConnectError: false` keeps trying in the background instead).
- The memory store keeps the values by reference. The other stores keep them as JSON: a `Buffer` is kept, a `Date`
  comes back as its ISO string, a class instance as a plain object.
- `namespace` separates the applications sharing a backend: `clear()` then deletes the namespace's entries only
  (except Memcache, whose `clear()` flushes the whole server).

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
| `Cacher` | The component: `set`, `get`, `multipleSet`, `multipleGet`, `getTTL`, `wrap`, `del`, `multipleDel`, `clear`, the events `set`, `del`, `clear`, `refresh`, `error` |
| `BuildCacherOptions` | Builds the component options of a `Cacher` |
| `CacherOptions` | The options: `stores`, `ttl`, `refreshThreshold`, `refreshAllStores`, `nonBlocking` |
| `CacheStoreOptions` | The options of one store, told apart by `type` |
| `MemoryCacheOptions`, `FileCacheOptions`, `RedisCacheOptions`, `MemcacheCacheOptions`, `MongoCacheOptions`, `SqliteCacheOptions`, `PostgresCacheOptions`, `MysqlCacheOptions` | The options of each store |
| `WrapOptions` | The TTL and refresh threshold of a `wrap()` call |
| `MultipleSetInput` | An entry of `multipleSet()` |
| `OnSetEventData`, `OnDeleteEventData`, `OnRefreshEventData` | The data of the `set`, `del` and `refresh` events |
| `CacheDriverNotFoundException` | A store's driver package is not installed |

All are exported by `lakutata/com/cacher` and `@lakutata/cache`. The typings document each declaration with examples.

## Errors

| Exception | Thrown when |
|---|---|
| `CacheDriverNotFoundException` (`E_CACHE_DRIVER_NOT_FOUND`) | The cache starts with a store whose driver package (`redis`, `memjs`, `mongodb`, `sqlite3`, `pg`, `mysql2`) is not installed |
| `InvalidValueException` (from `lakutata`) | The cache options are invalid, when the component is created |

The failures of the stores (a refused connection, a failed query) are their drivers' errors: they fail the cache's
creation when it connects, reject the writes and deletions (without `nonBlocking`), and are emitted as `'error'`
events for the reads.

## See also

- `@lakutata/core` (`lakutata`): the components, `Application` and the dependency injection (`doc/en/Core.md` of the
  package `lakutata`, Chinese in `doc/zh`).
- `@lakutata/mutex` (`lakutata/com/mutex`): the locks, to compute a cached value in one instance at a time.

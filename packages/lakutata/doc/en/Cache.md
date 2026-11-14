# Lakutata Cache

The **Cacher component** (`lakutata/com/cacher`, package `@lakutata/cache`) is a key-value cache whose entries expire.
It keeps them in process memory, in a file, or on a server that the application's instances share: Redis, Memcache,
MongoDB, SQLite, PostgreSQL or MySQL. Several stores form tiers, the fastest first. Its `wrap()` method returns a cached
value, or computes and caches it when it is missing.

It is not the database query cache (the `cache` option of a `Database`, see [Databases](Database.md)).

## 1. A first cache

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildCacherOptions, type Cacher} from 'lakutata/com/cacher'

type Product = { id: number, name: string }

class Catalog extends Component {
    @Inject('cache')
    protected readonly cache: Cacher

    //Loaded once, then read from the cache until the entry expires
    public async product(id: number): Promise<Product> {
        return await this.cache.wrap(`product:${id}`, (): Promise<Product> => this.load(id))
    }

    public async rename(id: number, name: string): Promise<void> {
        //Update the database here, then delete the cached copy
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
            //In memory; the entries expire after 5 minutes
            cache: buildCacherOptions({ttl: 300000}),
            catalog: {class: Catalog}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const catalog: Catalog = await app.getObject<Catalog>('catalog')
        console.log(await catalog.product(1))
        const cache: Cacher = await app.getObject<Cacher>('cache')
        //This entry expires after 30 seconds
        await cache.set('greeting', 'Hello', 30000)
        console.log(await cache.get<string>('greeting'))
    })
```

- `buildCacherOptions` declares the component under a name of your choice; other objects inject it by that name
  (`@Inject('cache')`) or obtain it with `getObject('cache')`. The whole application shares one instance.
- Without `stores`, the cache keeps its entries in process memory.
- Durations are numbers of milliseconds.
- Queues can keep message results in a cache (see [Queues](Queue.md), section 1).

## 2. Options

| Option | Default | Meaning |
|---|---|---|
| `stores` | one memory store | The store, or a list of stores, fastest first (sections 5 and 6) |
| `ttl` | none: entries never expire | How long an entry is kept when a write specifies no TTL, in milliseconds (a positive integer) |
| `refreshThreshold` | none | The default background refresh threshold for `wrap()`, in milliseconds (section 4) |
| `refreshAllStores` | `false` | Whether a background refresh writes the new value to all stores (section 5) |
| `nonBlocking` | `false` | Whether writes and deletions return without waiting for the stores (section 5) |

The `cacheId` option is accepted but not used.

- With invalid options, the launch fails with `InvalidObjectOptionsException`.
- The stores connect when the component is created. When it is listed in `bootstrap`, it is created while the
  application launches, and the launch fails if a store cannot connect. Otherwise, it is created the first time it is
  used, and that `getObject()` call or injection fails with the store's error.
- When the application stops, the cache waits for its background refreshes, then disconnects its stores (the file
  store saves its last changes first).

## 3. Reading and writing

| Method | What it does | Returns |
|---|---|---|
| `set(key, value, ttl?)` | Caches a value in all stores, replacing the previous one | The value |
| `get(key)` | Reads a value | The value; `undefined` when the key is missing or expired |
| `multipleSet([{key, value, ttl?}])` | Caches several values | The entries written |
| `multipleGet(keys)` | Reads several values | The values, in the same order as the keys |
| `getTTL(key)` | Reads when the entry expires | A time in milliseconds since the epoch, or `-1` |
| `wrap(key, fn, options?)` | Reads a value, or computes it and caches it (section 4) | The value |
| `del(key)` | Deletes a key from all stores | `true` |
| `multipleDel(keys)` | Deletes several keys | `true` |
| `clear()` | Deletes all entries in each store, or those in its namespace (section 6) | `true` |

- **TTL.** A write's TTL replaces the `ttl` option, and `0` makes the entry never expire. The `ttl` option itself cannot
  be `0`: leave it out when entries should never expire. A TTL is a number, never a string such as `'1h'`.
- **`get()` never fails.** A store that fails to read counts as a miss, and its error is emitted as an `'error'`
  event (section 8). A cached `undefined` cannot be distinguished from a miss.
- **`getTTL()` returns a point in time**, not the time left: the time left is `expires - Date.now()`. It returns `-1`
  when the key is missing or expired, and when the entry never expires.
- **`multipleSet()` and `multipleDel()` emit no `'set'` or `'del'` event**, unlike `set()`, `wrap()` and `del()`.
- `del()` and `multipleDel()` return `true` even when the key did not exist.
- When a store fails to write or delete, the call fails, unless `nonBlocking` is set (section 5).

## 4. `wrap()`

`wrap(key, fn, options)` returns the key's cached value. When the key is missing or expired, it calls `fn`, caches its
result and returns it. It is the usual way to cache the result of a query or a call to another service:

```typescript
import type {Cacher} from 'lakutata/com/cacher'

declare const cache: Cacher
declare function loadRates(): Promise<Record<string, number>>

//Loaded at most once per hour; in its last 5 minutes, returned while it is loaded again in the background
const rates: Record<string, number> = await cache.wrap('rates', loadRates, {ttl: 3600000, refreshThreshold: 300000})

type User = { id: number, guest: boolean }
//A TTL that depends on the value
const user: User = await cache.wrap('user:1', async (): Promise<User> => ({id: 1, guest: true}), {
    ttl: (value: User): number => value.guest ? 60000 : 3600000
})
```

- The third argument is a TTL (`wrap(key, fn, 60000)`) or `{ttl, refreshThreshold}`, each of which is a number or a
  function of the value. They default to the `ttl` and `refreshThreshold` options.
- While a `wrap()` call for a key is in progress, other calls for that key share it and its result. This holds within
  one component: two application instances may both compute the value. Use a lock (see [Mutex](Mutex.md)) when it must
  be computed only once.
- When `fn` fails, `wrap()` fails with its error, and nothing is cached. An `undefined` result is cached like any other
  value.
- **Background refresh.** When the cached value has less time left than the refresh threshold, `wrap()` returns it
  immediately and calls `fn` in the background, one refresh per key at a time. The new value replaces the old one, and
  a `'refresh'` event reports it; when `fn` fails, the event reports the error and the old value is kept. An entry that
  never expires is never refreshed, and a threshold higher than the TTL refreshes the value on every call.
- With several stores, a value found in a lower store is copied to the stores above it, with the time it has left
  (section 5).

## 5. Several stores

```typescript
import {Application} from 'lakutata'
import {buildCacherOptions} from 'lakutata/com/cacher'

Application.run(() => ({
    id: 'tiers.app',
    name: 'Tiers',
    components: {
        cache: buildCacherOptions({
            //Each instance keeps its copies in memory, in front of the Redis that all the instances share
            stores: [
                {type: 'memory'},
                {type: 'redis', host: '127.0.0.1', namespace: 'tiers'}
            ],
            ttl: 60000
        })
    }
}))
```

- A read queries the stores in order and returns the first entry found. `multipleGet()` queries the next store only for
  keys that are still missing.
- A write or a deletion goes to all stores at the same time.
- Only `wrap()` copies an entry found in a lower store to the stores above it; `get()` does not.
- A background refresh writes the new value to the store that held the old one and to the stores above it, or to all
  stores with `refreshAllStores: true`.
- An instance's memory keeps its copy until the entry expires, even when another instance changes or deletes the key.
  Keep the TTL short when every instance must see changes quickly.
- **`nonBlocking: true`.** Writes and deletions return immediately, without waiting for the stores, and never fail:
  their failures are emitted as events (section 8). With several stores, a read queries all of them at the same time
  and returns the first entry found, which may not be the first store's.
- All stores connect when the cache is created. When one of them fails, the others disconnect, and creating the cache
  fails with that store's error.

## 6. The stores

| `type` | Where the entries are | Install |
|---|---|---|
| `'memory'` | In process memory (the store of a cache without `stores`) | Nothing |
| `'file'` | In memory, saved to a JSON file | Nothing |
| `'redis'` | On Redis or Valkey | `redis` (4 or 5) |
| `'memcache'` | On memcached | `memjs` |
| `'mongo'` | In a MongoDB collection | `mongodb` |
| `'sqlite'` | In a table in a SQLite file | `better-sqlite3` (12); nothing on Bun |
| `'postgres'` | In a PostgreSQL table | `pg` |
| `'mysql'` | In a MySQL or MariaDB table | `mysql2` |

- When a store's package is not installed, creating the cache fails with `CacheDriverNotFoundException`; its message
  names the package to install.
- Every store except the memory store keeps values as JSON (section 7).
- Every store except the memory store accepts a `namespace`, which separates applications that share a server or a
  table: `clear()` then deletes only the entries in the namespace. Without a namespace, `clear()` deletes all the
  entries in the store (for Redis and Memcache, see below).
- In the SQLite, PostgreSQL and MySQL stores, nothing deletes expired rows in the background: an expired row stays in
  the table until it is read (it is then deleted), overwritten or cleared.

### Memory

| Option | Default | Meaning |
|---|---|---|
| `sweepInterval` | `60000` | How often expired entries are removed, in milliseconds (an expired entry is a miss anyway) |

The values themselves are kept, not copied (section 7). Each process has its own entries, which are lost when it ends.

### File

| Option | Default | Meaning |
|---|---|---|
| `filename` | required | The JSON file, relative to the working directory; it is created with its directories |
| `writeDelay` | `100` | How long after a change the file is saved, in milliseconds; changes made in the meantime are saved together |
| `expiredCheckDelay` | `3600000` | The minimum time between two removals of expired entries from the file, in milliseconds |
| `namespace` | none | |

- Entries are kept in memory. The file is read when the cache is created, and each save rewrites the whole file (through
  a temporary file), so the store suits small caches. The latest changes are saved when the application stops.
- A file belongs to one process: another process reads it only when its own cache is created, and each save replaces
  the entries that the other processes saved.
- If the file is not JSON, creating the cache fails. A failed save is emitted as an `'error'` event.

### Redis

| Option | Default | Meaning |
|---|---|---|
| `host` | required | |
| `port` | `6379` | |
| `database` | `0` | The database index |
| `username`, `password` | none | |
| `tls` | `false` | Whether to connect with TLS |
| `namespace` | none | |
| `keyPrefixSeparator` | `'::'` | The separator that follows the namespace in keys |
| `connectTimeout` | `5000` | How long the first connection may take, in milliseconds |
| `throwOnConnectError` | `true` | Whether creating the cache fails when the first connection fails |
| `reconnect` | `true` | Whether to reconnect after the connection is lost (after 100 ms per attempt, 3 seconds at most) |
| `keepAlive` | the driver's | How long the connection stays idle before the first TCP keep-alive probe, in milliseconds |
| `useUnlink` | `true` | Whether to delete with `UNLINK` rather than `DEL` |
| `clearBatchSize` | `1000` | How many keys `clear()` scans and deletes at a time |
| `noNamespaceAffectsAll` | `false` | Whether `clear()` without a namespace empties the whole database (`FLUSHDB`) |

- Keys are `{namespace}::{namespace}:{key}` (the Lakutata 2.x format), or the key itself without a namespace. Redis
  deletes expired entries itself.
- Without a namespace, `clear()` deletes the string keys in the database that are outside namespaces (keys without
  `::`): namespaced keys and keys of other types (hashes, lists…) are kept. With `noNamespaceAffectsAll: true`, it
  empties the database.
- `clear()` scans the keys by type, which requires Redis 6 or later.
- While the connection is down, commands fail immediately instead of waiting: reads are misses, and writes fail. With
  `throwOnConnectError: false`, the cache is created even when Redis is down, and keeps trying to connect.
- The store uses the `redis` package, or `@redis/client` when `redis` is not installed.

### Memcache

| Option | Default | Meaning |
|---|---|---|
| `host` | required | |
| `port` | `11211` | |
| `username`, `password` | none | For a server that requires SASL authentication |
| `namespace` | none | |

- The client connects on its first command: when the server cannot be reached, creating the cache still succeeds, but
  reads are misses and writes fail.
- memcached counts TTLs in seconds: an entry may stay up to two seconds longer on the server, but it is a miss once its
  TTL has passed.
- `clear()` empties the whole server, whatever the namespace: other applications' entries are deleted too.

### MongoDB

| Option | Default | Meaning |
|---|---|---|
| `host`, `database`, `collection` | required | The collection is created when it is missing |
| `port` | `27017` | |
| `username`, `password` | none | The user is authenticated against the `admin` database |
| `namespace` | none | |

- One document per entry. When the cache is created, it creates a unique index on the keys, and a TTL index with which
  MongoDB deletes expired documents, about once a minute; an expired document is a miss before that.
- Creating the cache fails if the connection fails.

### SQLite

| Option | Default | Meaning |
|---|---|---|
| `database` | required | The database file, relative to the working directory, in a directory that exists; or `':memory:'` |
| `table` | required | The table, created when it is missing |
| `busyTimeout` | `10000` | How long a statement waits for a database locked by another connection, in milliseconds |
| `namespace` | none | |

- Characters in `table` other than letters, digits and `_` are removed.
- Statements run synchronously: a statement that waits for a locked database blocks the event loop, up to
  `busyTimeout`.
- `better-sqlite3` is a native addon built for one runtime: an Electron application needs a build for its Electron
  version; an NW.js application has it rebuilt with the NW.js headers (0.111.3 or later, because earlier releases
  cannot load it). On Bun, the store uses `bun:sqlite` instead.

### PostgreSQL

| Option | Default | Meaning |
|---|---|---|
| `host`, `database`, `table` | required | |
| `port` | `5432` | |
| `schema` | `'public'` | The table's schema |
| `username`, `password` | the driver's | Without `username`, the `PGUSER` environment variable, otherwise the user of the process |
| `maxPoolSize` | `10` | The maximum number of connections |
| `namespace` | none | |

- When the cache is created, it creates the schema and the table if they are missing:
  `(key VARCHAR(255) PRIMARY KEY, value TEXT)`. PostgreSQL folds a plain name to lower case: `table: 'Entries'`
  creates `entries`. Creating the cache fails if the connection fails or the schema or the table cannot be created.
- Writing a key longer than 255 characters, including its namespace, fails.

### MySQL

| Option | Default | Meaning |
|---|---|---|
| `host`, `database`, `table` | required | |
| `port` | `3306` | |
| `username`, `password` | the driver's | |
| `namespace` | none | |

- When the cache is created, it creates the table if it is missing:
  `(id VARCHAR(255) PRIMARY KEY, value MEDIUMTEXT)`, with case-sensitive keys. Creating the cache fails if the
  connection fails or the table cannot be created.
- Writing a key longer than 255 characters, including its namespace, fails, and a value is limited to 16 MB of JSON.

## 7. What the stores keep

The memory store keeps the values themselves: an object changed after it is cached is changed in the cache too, and a
read returns the cached object. Copy objects when this matters.

The other stores keep values as JSON, so some values are read back in a different form:

| Cached | Read back |
|---|---|
| A `Date` | Its ISO string (`'2026-01-02T03:04:05.000Z'`) |
| A class instance | A plain object with its fields, without its methods |
| A `Map` or a `Set` | `{}` |
| `NaN`, `Infinity` | `null` |
| A `Buffer` | A `Buffer` |
| A `bigint` | The write fails with a `TypeError` |

With a memory store in front of another store, the same key can return the value itself or its JSON copy, depending on
which store holds it. Cache values that JSON preserves unchanged: plain objects, arrays, strings, numbers and booleans.

## 8. Events and errors

| Event | When | The listener receives |
|---|---|---|
| `'set'` | `set()` or `wrap()` wrote a value, or failed to | `{key, value, error?}` |
| `'del'` | `del()` deleted a key, or failed to | `{key, error?}` |
| `'clear'` | `clear()` finished | Nothing, or the error |
| `'refresh'` | A `wrap()` background refresh finished | `{key, value, error?}`: the new value, or the old one and the error |
| `'error'` | A store failed and no other event reports it (see below) | The error |

```typescript
import type {Cacher, OnRefreshEventData} from 'lakutata/com/cacher'

declare const cache: Cacher

cache.on('refresh', (data: OnRefreshEventData): void => {
    if (data.error) console.warn(`Refreshing ${data.key} failed, the cached value is kept`)
})
//The failed reads, the lost connections, the failed saves of the file…
cache.on('error', (error: Error): void => console.error('Cache store error', error))
```

- The `'error'` event reports failed reads (counted as misses), failures in `multipleSet()`, `multipleDel()` and the
  copies made by `wrap()`, lost connections, and the file store's failed saves. Without a listener, these errors are
  dropped: listen to it to know when a store is failing.
- Listeners are called asynchronously, after the event is emitted.
- Without `nonBlocking`, when a store fails to write or delete, the call fails with its driver's error. With
  `nonBlocking`, `'set'` and `'del'` are emitted before the stores are written, and a failure emits a second event that
  carries the error.

| Error | When |
|---|---|
| `InvalidObjectOptionsException` | The options are invalid, when the application launches |
| `CacheDriverNotFoundException` (`E_CACHE_DRIVER_NOT_FOUND`) | A store's package is not installed, when the cache is created |
| Driver errors | A store cannot connect when the cache is created, or a write or a deletion fails |

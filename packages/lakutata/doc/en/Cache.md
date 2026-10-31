# Lakutata Cache

The **Cacher component** (`lakutata/com/cacher`, package `@lakutata/cache`) is a key-value cache whose entries expire.
It keeps them in the memory of the process, in a file, or on a server that the instances of the application share:
Redis, Memcache, MongoDB, SQLite, PostgreSQL or MySQL. Several stores make tiers, the fastest first. Its `wrap()` method
returns a cached value, or computes it and caches it when it is missing.

It is not the query cache of the databases (the `cache` option of a `Database`, see [Database](Database.md)).

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

- `buildCacherOptions` declares the component under the name of your choice; the other objects inject it by that name
  (`@Inject('cache')`) or get it with `getObject('cache')`. The whole application shares one instance.
- Without `stores`, the cache keeps its entries in the memory of the process.
- The durations are numbers of milliseconds.
- The queues can keep the results of their messages in a cache (see [Queue](Queue.md), section 1).

## 2. Options

| Option | Default | Meaning |
|---|---|---|
| `stores` | one memory store | The store, or the list of stores with the fastest first (sections 5 and 6) |
| `ttl` | none: the entries never expire | How long an entry is kept when a write gives no TTL, in milliseconds (a positive integer) |
| `refreshThreshold` | none | The default threshold of the background refresh of `wrap()`, in milliseconds (section 4) |
| `refreshAllStores` | `false` | Whether a background refresh writes the new value to all the stores (section 5) |
| `nonBlocking` | `false` | Whether the writes and the deletions return without waiting for the stores (section 5) |

The option `cacheId` is accepted and not used.

- Invalid options fail the application's start with `InvalidObjectOptionsException`.
- The stores connect when the component is created. When it is listed in `bootstrap`, it is created while the
  application starts, and a store that cannot connect fails the start. Otherwise it is created the first time it is
  used, and that `getObject()` or that injection fails with the store's error.
- When the application stops, the cache waits for its background refreshes, then disconnects its stores (the file
  store saves its last changes first).

## 3. Reading and writing

| Method | What it does | Returns |
|---|---|---|
| `set(key, value, ttl?)` | Caches a value in all the stores, replacing the previous one | The value |
| `get(key)` | Reads a value | The value; `undefined` when the key is missing or expired |
| `multipleSet([{key, value, ttl?}])` | Caches several values | The entries written |
| `multipleGet(keys)` | Reads several values | The values, in the order of the keys |
| `getTTL(key)` | Reads when the entry expires | A time in milliseconds since the epoch, or `-1` |
| `wrap(key, fn, options?)` | Reads a value, or computes it and caches it (section 4) | The value |
| `del(key)` | Deletes a key from all the stores | `true` |
| `multipleDel(keys)` | Deletes several keys | `true` |
| `clear()` | Deletes all the entries of each store, or those of its namespace (section 6) | `true` |

- **TTL.** The TTL of a write replaces the `ttl` option, and `0` makes the entry never expire. The `ttl` option itself
  cannot be `0`: leave it out when the entries should never expire. A TTL is a number, never a text such as `'1h'`.
- **`get()` never fails.** A store that fails to read counts as a miss, and its error is emitted as an `'error'`
  event (section 8). A cached `undefined` cannot be told apart from a miss.
- **`getTTL()` returns a point in time**, not the time left: the time left is `expires - Date.now()`. It returns `-1`
  when the key is missing or expired, and when the entry never expires.
- **`multipleSet()` and `multipleDel()` emit no `'set'` or `'del'` event**, unlike `set()`, `wrap()` and `del()`.
- `del()` and `multipleDel()` return `true` even when the key did not exist.
- A store that fails to write or delete fails the call, unless `nonBlocking` is set (section 5).

## 4. `wrap()`

`wrap(key, fn, options)` returns the cached value of the key. When the key is missing or expired, it calls `fn`, caches
its result and returns it. It is the usual way to cache the result of a query or of a call to another service:

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

- The third argument is a TTL (`wrap(key, fn, 60000)`) or `{ttl, refreshThreshold}`, each of them a number or a
  function of the value. They default to the `ttl` and `refreshThreshold` options.
- While a `wrap()` of a key is in progress, the other calls on that key share it and its result. This holds within one
  component: two instances of the application may both compute the value. Use a lock (see [Mutex](Mutex.md)) when it
  must be computed only once.
- When `fn` fails, `wrap()` fails with its error, and nothing is cached. A result of `undefined` is cached like any
  other value.
- **Background refresh.** When the cached value has less time left than the refresh threshold, `wrap()` returns it at
  once and calls `fn` in the background, one refresh per key at a time. The new value replaces the old one, and a
  `'refresh'` event reports it; when `fn` fails, the event reports the error and the old value stays. An entry that
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

- A read asks the stores in order and returns the first entry found. `multipleGet()` asks the next store only for the
  keys that are still missing.
- A write or a deletion goes to all the stores at once.
- Only `wrap()` copies an entry found in a lower store to the stores above it; `get()` does not.
- A background refresh writes the new value to the store that held the old one and to the stores above it, or to all
  the stores with `refreshAllStores: true`.
- The memory of an instance keeps its copy until the entry expires, even when another instance changes or deletes the
  key. Keep the TTL short when every instance must see the changes quickly.
- **`nonBlocking: true`.** The writes and the deletions return at once, without waiting for the stores, and never fail:
  their failures are emitted as events (section 8). With several stores, a read asks all of them at once and returns
  the first entry found, which may not be the first store's.
- All the stores connect when the cache is created. When one of them fails, the others disconnect, and the creation
  fails with its error.

## 6. The stores

| `type` | Where the entries are | Install |
|---|---|---|
| `'memory'` | In the memory of the process (the store of a cache without `stores`) | Nothing |
| `'file'` | In memory, saved to a JSON file | Nothing |
| `'redis'` | On Redis or Valkey | `redis` (4 or 5) |
| `'memcache'` | On memcached | `memjs` |
| `'mongo'` | In a MongoDB collection | `mongodb` |
| `'sqlite'` | In a table of a SQLite file | `better-sqlite3` (12); nothing on Bun |
| `'postgres'` | In a PostgreSQL table | `pg` |
| `'mysql'` | In a MySQL or MariaDB table | `mysql2` |

- A store whose package is not installed fails the cache's creation with `CacheDriverNotFoundException`; its message
  names the package to install.
- Every store but the memory one keeps the values as JSON (section 7).
- Every store but the memory one takes a `namespace`, which keeps apart the applications that share a server or a
  table: `clear()` then deletes only the entries of the namespace. Without a namespace, `clear()` deletes all the
  entries of the store (for Redis and Memcache, see below).
- In the SQLite, PostgreSQL and MySQL stores, nothing deletes the expired rows in the background: an expired row stays
  in the table until it is read (it is then deleted), overwritten or cleared.

### Memory

| Option | Default | Meaning |
|---|---|---|
| `sweepInterval` | `60000` | How often the expired entries are removed, in milliseconds (an expired entry is a miss anyway) |

The values are kept as they are, not copied (section 7). Each process has its own entries, lost when it ends.

### File

| Option | Default | Meaning |
|---|---|---|
| `filename` | required | The JSON file, relative to the working directory; it is created with its directories |
| `writeDelay` | `100` | How long after a change the file is saved, in milliseconds; the changes made meanwhile are saved together |
| `expiredCheckDelay` | `3600000` | The minimum time between two removals of the expired entries from the file, in milliseconds |
| `namespace` | none | |

- The entries are in memory. The file is read when the cache is created, and each save rewrites all of it (through a
  temporary file), so the store suits small caches. The last changes are saved when the application stops.
- A file belongs to one process: another process reads it only when its own cache is created, and each save replaces
  the entries that the other processes saved.
- A file that is not JSON fails the cache's creation. A failed save is emitted as an `'error'` event.

### Redis

| Option | Default | Meaning |
|---|---|---|
| `host` | required | |
| `port` | `6379` | |
| `database` | `0` | The index of the database |
| `username`, `password` | none | |
| `tls` | `false` | Whether to connect with TLS |
| `namespace` | none | |
| `keyPrefixSeparator` | `'::'` | The separator that follows the namespace in the keys |
| `connectTimeout` | `5000` | How long the first connection may take, in milliseconds |
| `throwOnConnectError` | `true` | Whether a failed first connection fails the cache's creation |
| `reconnect` | `true` | Whether to reconnect after the connection is lost (after 100 ms per attempt, 3 seconds at most) |
| `keepAlive` | the driver's | How long the connection stays idle before the first TCP keep-alive probe, in milliseconds |
| `useUnlink` | `true` | Whether to delete with `UNLINK` rather than `DEL` |
| `clearBatchSize` | `1000` | How many keys `clear()` scans and deletes at a time |
| `noNamespaceAffectsAll` | `false` | Whether `clear()` without a namespace empties the whole database (`FLUSHDB`) |

- The keys are `{namespace}::{namespace}:{key}` (the format of lakutata 2.x), or the key itself without a namespace.
  Redis deletes the expired entries itself.
- Without a namespace, `clear()` deletes the string keys of the database that are outside the namespaces (the keys
  without `::`): the namespaced keys and the keys of the other types (hashes, lists…) stay. With
  `noNamespaceAffectsAll: true`, it empties the database.
- `clear()` scans the keys by type, which needs Redis 6 or later.
- While the connection is down, the commands fail at once instead of waiting: the reads are misses, the writes fail.
  With `throwOnConnectError: false`, the cache is created even when Redis is down, and keeps trying to connect.
- The store uses the package `redis`, or `@redis/client` when `redis` is not installed.

### Memcache

| Option | Default | Meaning |
|---|---|---|
| `host` | required | |
| `port` | `11211` | |
| `username`, `password` | none | For a server that requires SASL authentication |
| `namespace` | none | |

- The client connects at its first command: a server that cannot be reached does not fail the cache's creation, but
  its reads are misses and its writes fail.
- memcached counts the TTLs in seconds: an entry may stay up to two seconds longer on the server, but it is a miss
  once its TTL has passed.
- `clear()` empties the whole server, whatever the namespace: the entries of the other applications are deleted too.

### MongoDB

| Option | Default | Meaning |
|---|---|---|
| `host`, `database`, `collection` | required | The collection is created when it is missing |
| `port` | `27017` | |
| `username`, `password` | none | The user is authenticated against the `admin` database |
| `namespace` | none | |

- One document per entry. When the cache is created, it creates a unique index on the keys, and a TTL index by which
  MongoDB deletes the expired documents, about once a minute; an expired document is a miss before that.
- A failed connection fails the cache's creation.

### SQLite

| Option | Default | Meaning |
|---|---|---|
| `database` | required | The database file, relative to the working directory, in a directory that exists; or `':memory:'` |
| `table` | required | The table, created when it is missing |
| `busyTimeout` | `10000` | How long a statement waits for a database locked by another connection, in milliseconds |
| `namespace` | none | |

- The characters of `table` other than letters, digits and `_` are removed.
- The statements run synchronously: a statement that waits for a locked database blocks the event loop, up to
  `busyTimeout`.
- `better-sqlite3` is a native addon built for one runtime: an Electron application needs its build for its version of
  Electron; an NW.js application has it built again with the headers of NW.js (0.111.3 or later: the earlier releases
  cannot load it). On Bun, the store uses `bun:sqlite` instead.

### PostgreSQL

| Option | Default | Meaning |
|---|---|---|
| `host`, `database`, `table` | required | |
| `port` | `5432` | |
| `schema` | `'public'` | The schema of the table |
| `username`, `password` | the driver's | Without `username`, the `PGUSER` environment variable, else the user of the process |
| `maxPoolSize` | `10` | The maximum number of connections |
| `namespace` | none | |

- When the cache is created, it creates the schema and the table when they are missing:
  `(key VARCHAR(255) PRIMARY KEY, value TEXT)`. PostgreSQL folds a plain name to lower case: `table: 'Entries'`
  creates `entries`. A failed connection or creation fails the cache's creation.
- A key longer than 255 characters, its namespace included, fails its write.

### MySQL

| Option | Default | Meaning |
|---|---|---|
| `host`, `database`, `table` | required | |
| `port` | `3306` | |
| `username`, `password` | the driver's | |
| `namespace` | none | |

- When the cache is created, it creates the table when it is missing:
  `(id VARCHAR(255) PRIMARY KEY, value MEDIUMTEXT)`, its keys case sensitive. A failed connection or creation fails
  the cache's creation.
- A key longer than 255 characters, its namespace included, fails its write, and a value is limited to 16 MB of JSON.

## 7. What the stores keep

The memory store keeps the values themselves: an object changed after it is cached is changed in the cache too, and a
read returns the cached object. Copy the objects when this matters.

The other stores keep the values as JSON, so some values come back different:

| Cached | Read back |
|---|---|
| A `Date` | Its ISO string (`'2026-01-02T03:04:05.000Z'`) |
| An instance of a class | A plain object with its fields, without its methods |
| A `Map` or a `Set` | `{}` |
| `NaN`, `Infinity` | `null` |
| A `Buffer` | A `Buffer` |
| A `bigint` | The write fails with a `TypeError` |

With a memory store in front of another store, the same key can return the value itself or its JSON copy, depending on
the store that holds it. Cache the values that JSON keeps as they are: plain objects, arrays, strings, numbers and
booleans.

## 8. Events and errors

| Event | When | The listener receives |
|---|---|---|
| `'set'` | `set()` or `wrap()` wrote a value, or failed to | `{key, value, error?}` |
| `'del'` | `del()` deleted a key, or failed to | `{key, error?}` |
| `'clear'` | `clear()` finished | Nothing, or the error |
| `'refresh'` | A background refresh of `wrap()` finished | `{key, value, error?}`: the new value, or the old one and the error |
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

- The `'error'` event reports the failed reads (counted as misses), the failures of `multipleSet()` and
  `multipleDel()` and of the copies made by `wrap()`, the lost connections and the failed saves of the file store.
  Without a listener, these errors are dropped: listen to it to know when a store is failing.
- The listeners are called asynchronously, after the event is emitted.
- Without `nonBlocking`, a store that fails to write or delete fails the call with the error of its driver. With
  `nonBlocking`, `'set'` and `'del'` are emitted before the stores are written, and a failure emits a second event that
  carries the error.

| Error | When |
|---|---|
| `InvalidObjectOptionsException` | The options are invalid, when the application starts |
| `CacheDriverNotFoundException` (`E_CACHE_DRIVER_NOT_FOUND`) | The package of a store is not installed, when the cache is created |
| The errors of the drivers | A store cannot connect when the cache is created, or fails a write or a deletion |

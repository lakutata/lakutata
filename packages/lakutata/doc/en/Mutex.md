# Lakutata Mutex

The **Mutex component** (`lakutata/com/mutex`, package `@lakutata/mutex`) gives the locks of an application: a work runs
in one instance (or one process) at a time, as its driver shares the locks between them.

## 1. Configuration

```typescript
import {Mutex} from 'lakutata/com/mutex'

components: {
    mutex: {
        class: Mutex,
        driver: {type: 'redis', url: 'redis://cache:6379'},
        ttl: 30000,      //ms a lock is held without renewal (renewed automatically while it is held)
        timeout: 10000,  //ms a lock is waited for
        prefix: 'lakutata:mutex:'
    }
}
```

| Driver | Shared by | Notes |
|---|---|---|
| `{type: 'memory'}` (default) | the components of a process | development, tests, a single instance |
| `{type: 'file', directory}` | the processes of a host | lock files created exclusively; a lock of a process gone is taken over |
| `{type: 'redis', url}` | every instance | `SET NX PX`, fencing tokens; use `noeviction` (an evicted key is a lost lock) |
| `{type: 'postgres', host, database, username, password, mode}` | every instance | `mode: 'advisory'` (default): `pg_try_advisory_lock` on a connection of its own, released when it closes, not through PgBouncer (transactions); `mode: 'table'`: rows of a table created at the first use, fencing tokens |
| `{type: 'mysql', host, database, username, password, mode}` | every instance | `mode: 'advisory'` (default): `GET_LOCK` on a connection of its own, not replicated by the clusters; `mode: 'table'`: rows of a table, fencing tokens |

The clients (`redis`, `pg`, `mysql2`) are optional dependencies, installed as the driver needs them.

## 2. Usage

```typescript
const mutex = await app.getObject<Mutex>('mutex')

//Acquired before the function, released after it (its errors too)
await mutex.synchronized('report:daily', async (lock) => {
    //lock.signal is aborted when the lock is lost (expired before its renewal, its connection closed)
})

//Waited for up to its timeout (MutexTimeoutException), or tried once
const lock = await mutex.acquire('order:42', {timeout: 3000})
try { ... } finally { await lock.release() }
const maybe = await mutex.tryAcquire('cleanup')   //undefined when another holder has it

//Released at the end of its scope
await using scoped = await mutex.acquire('order:42')
```

- **Holders**: a lock is acquired with a token; only its holder releases and renews it.
- **Expiration**: a lock is held for its `ttl`, renewed while it is held: a holder gone (its process crashed) does not
  keep it. The advisory locks of PostgreSQL and MySQL end with their connection instead.
- **Fencing tokens**: `lock.fence` increases with each acquisition (Redis, the mode table, memory): the stores written
  under a lock may refuse the writes of an older one.
- **Not reentrant**: acquiring a lock held waits for its release, in the same process too.
- **Lifecycle**: the locks of a component are released when it is destroyed (the application stopping).

## 3. Exceptions

`MutexTimeoutException` (not acquired before the timeout), `MutexLostException` (the reason of `lock.signal`),
`MutexDriverException` (the store failed), `MutexDriverNotFoundException` (the client of the driver is not installed).

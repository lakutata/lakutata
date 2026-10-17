# @lakutata/mutex

English | [中文](README.zh-CN.md)

The lock component of the lakutata framework: named locks that let one holder at a time do a piece of work. Depending
on the driver (memory, lock files, Redis, PostgreSQL or MySQL), a lock is shared by the components of a process, by the
processes of a host, or by every instance of an application. A lock is held with a token and renewed while it is held;
when its holder can no longer keep it, the lock is lost and its `AbortSignal` is aborted. The package also provides
`@Synchronized` for controller actions, and the locks of `exclusive` schedules. The umbrella package `lakutata`
re-exports it as `lakutata/com/mutex`.

## Installation

```shell
npm install lakutata
```

The memory and file drivers need nothing else. The other drivers rely on optional peer dependencies: install the
package of the driver you use. When a driver's package is missing, the first acquisition fails with
`MutexDriverNotFoundException`.

| Driver | `type` | Shared by | Install | Expires / renewed | Fencing token |
|---|---|---|---|---|---|
| Memory (the default) | `'memory'` | the components of one process | none | yes | yes (per process) |
| Lock files | `'file'` | the processes of one host | none | yes; the lock of a process that died is taken over at once | no |
| Redis 4+ (or Valkey) | `'redis'` | every instance connected to the server or cluster | `redis` (4.6 or 5) | yes | yes |
| PostgreSQL, `mode: 'advisory'` (default) | `'postgres'` | every instance connected to the database | `pg` (8) | no: released when the connection closes | no |
| PostgreSQL, `mode: 'table'` | `'postgres'` | every instance connected to the database, also through connection poolers | `pg` (8) | yes | yes |
| MySQL / MariaDB, `mode: 'advisory'` (default) | `'mysql'` | every instance connected to the server (not across a cluster) | `mysql2` (3) | no: released when the connection closes | no |
| MySQL / MariaDB, `mode: 'table'` | `'mysql'` | every instance connected to the database, clusters included | `mysql2` (3) | yes | yes |

## Usage

### The component in an application

Register `Mutex` in the application's `components` under the name `mutex` (the name that `@Synchronized` and
`exclusive` schedules use by default), then get it with `getObject()` or `@Inject`. Without `driver`, the locks are kept
in memory.

```typescript
import {Application} from 'lakutata'
import {Mutex, type MutexLock} from 'lakutata/com/mutex'

Application
    .run(() => ({
        id: 'mutex.app',
        name: 'Mutex',
        components: {
            mutex: {
                class: Mutex,
                driver: {type: 'redis', url: 'redis://127.0.0.1:6379'},
                //Held 30 s without a renewal, renewed every 10 s while held
                ttl: 30000,
                //Waited for 10 s at most
                timeout: 10000,
                prefix: 'lakutata:mutex:'
            }
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const mutex: Mutex = await app.getObject('mutex')

        //Acquired before the function, released after it, even when it throws
        await mutex.synchronized('report:daily', async (lock: MutexLock): Promise<void> => {
            //Aborted with a MutexLostException when the lock is lost
            lock.signal.throwIfAborted()
        })

        //Waited for up to 3 s, then MutexTimeoutException
        const lock: MutexLock = await mutex.acquire('order:42', {timeout: 3000})
        try {
            console.log(lock.fence)
        } finally {
            await lock.release()
        }

        //Tried once: undefined when another holder has it
        const cleanup: MutexLock | undefined = await mutex.tryAcquire('cleanup')
        await cleanup?.release()

        //Released at the end of the block
        {
            await using scoped: MutexLock = await mutex.acquire('order:43')
            console.log(scoped.held)
        }
    })
```

- **Holders**: a lock is acquired with a random token, and only its holder can release or renew it. A lock is released
  only once: later `release()` calls return `false`.
- **Expiration**: drivers whose locks expire hold a lock for its `ttl` (in milliseconds), and the component renews it
  every third of that time, so a holder that crashed keeps the lock for one `ttl` at most. The advisory locks of
  PostgreSQL and MySQL do not expire: the database releases them when the component's connection closes.
- **Lost locks**: a lock is lost when a renewal finds it expired or taken by another holder, when renewals keep failing
  (the store is unreachable) until it expires, or when the connection holding an advisory lock closes. `lock.held` then
  becomes `false` and `lock.signal` is aborted with a `MutexLostException`. The protected work is not interrupted, so it
  should watch the signal.
- **Fencing tokens**: `lock.fence` increases with each acquisition (memory, Redis and the `table` modes). Store it with
  the data the lock protects, so that your data store can reject writes from an older holder.
- **Not reentrant**: acquiring a lock that the component already holds waits for its release, like any other holder.
- **Connections**: the driver connects at the first acquisition, not when the component is created. When the lock store
  fails, calls reject with `MutexDriverException`. When the Redis server is unreachable, calls fail: the first
  connection attempt gives up after 5 seconds, and calls made while the client reconnects fail at once.
- **Lifecycle**: when the component is destroyed (as the application stops), it releases the locks it holds and closes
  its driver.

### Synchronized controller actions

`@Synchronized` runs a controller action under a lock. The lock is acquired after the input is validated and access
control has passed, and released when the action ends. Requests that need the same lock run one at a time across every
instance, whatever their transport; other requests run in parallel. A request stops waiting when it is aborted (its
client has gone), and a request that does not get the lock in time fails with `MutexTimeoutException` (HTTP 409).

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {HTTPAction, ServiceAction} from 'lakutata/decorator/ctrl'
import {Synchronized} from 'lakutata/com/mutex'

class OrderController extends Controller {
    //A lock per order: {id} is a field of the validated input
    @HTTPAction('/orders/:id/pay', 'POST')
    @ServiceAction({cmd: 'order.pay'})
    @Synchronized('order:{id}')
    public async pay(input: {id: number}): Promise<void> {
    }

    //Fails at once (HTTP 409) while another request runs it
    @ServiceAction({cmd: 'search.reindex'})
    @Synchronized('search:reindex', {wait: false})
    public async reindex(): Promise<void> {
    }

    //A name computed from the input, a lock component registered as "locks", a wait of 5 s
    @ServiceAction({cmd: 'user.export'})
    @Synchronized((input: {userId: string}): string => `export:${input.userId}`, {timeout: 5000, mutex: 'locks'})
    public async export(input: {userId: string}): Promise<void> {
    }
}
```

### Exclusive schedules

A scheduled action declared `exclusive` (with `@Schedule` from `lakutata/decorator/ctrl`) runs in only one instance of
the application at a time. Each run tries to acquire the lock `schedule:<key>` (the key defaults to the action name)
from the `mutex` component (or from the component and key given by `exclusive: {mutex, key}`), and the instances that
do not get it skip the run. Interval schedules are aligned on multiples of their interval (every 5 minutes means :00,
:05, :10…), so that every instance plans the same times. After a run, the lock is held until half the period has passed
since the planned time (30 s at most), so that instances whose clocks are slightly behind skip the run too. When its
lock component cannot be found, the action does not run, and the error is logged.

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller, scheduleEntrypoint} from 'lakutata/com/entrypoint'
import {Schedule} from 'lakutata/decorator/ctrl'
import {Mutex} from 'lakutata/com/mutex'

class ReportController extends Controller {
    //Every 5 minutes, by one instance
    @Schedule({every: '5m', exclusive: true})
    public async build(): Promise<void> {
    }

    //At 03:00 every day, the lock named schedule:purge in the component "locks"
    @Schedule({cron: '0 3 * * *', exclusive: {mutex: 'locks', key: 'purge'}})
    public async purge(): Promise<void> {
    }
}

Application.run(() => ({
    id: 'reports.app',
    name: 'Reports',
    components: {
        mutex: {class: Mutex, driver: {type: 'redis', url: 'redis://127.0.0.1:6379'}},
        locks: {class: Mutex, driver: {type: 'postgres', host: 'db', database: 'app', username: 'app', password: ''}},
        entrypoint: buildEntrypoints({
            controllers: [ReportController],
            schedule: scheduleEntrypoint()
        })
    },
    bootstrap: ['entrypoint']
}))
```

## API

| Export | What it is |
|---|---|
| `Mutex` | The component: `tryAcquire`, `acquire`, `synchronized`, `heldLocks`; the options `driver`, `prefix`, `ttl`, `timeout`, `retryDelay` |
| `MutexLock` | A held lock: `name`, `token`, `fence`, `acquiredAt`, `held`, `signal`, `release()`, `extend()`, `await using` |
| `MutexAcquireOptions` | The `ttl`, `timeout` and abort `signal` of an acquisition |
| `MutexDriverOptions` | The `driver` option: one of the driver options below, distinguished by `type` |
| `MemoryMutexOptions`, `FileMutexOptions`, `RedisMutexOptions`, `PostgresMutexOptions`, `MysqlMutexOptions` | The options of each driver |
| `Synchronized` | Method decorator that runs a controller action under a lock |
| `SynchronizedOptions` | The lock component, `timeout`, `wait` and `ttl` of `@Synchronized` |
| `lockNameOf` | Builds a lock name from a template (`'order:{id}'`) and an input |
| `MutexDriver`, `DriverLock` | The base class of the drivers, and a lock granted by a driver |
| `MemoryMutexDriver`, `FileMutexDriver`, `RedisMutexDriver`, `PostgresMutexDriver`, `MysqlMutexDriver` | The drivers, which can be used directly without the component (no waiting, no renewal) |
| `RedisMutexConnection`, `PostgresMutexConnection`, `MysqlMutexConnection` | The connections passed to the drivers' constructors |
| `MutexTimeoutException`, `MutexLostException`, `MutexDriverException`, `MutexDriverNotFoundException` | The exceptions |

All of them are exported by `lakutata/com/mutex` and `@lakutata/mutex`. The typings document every declaration, with
examples.

## Errors

| Exception | When |
|---|---|
| `MutexTimeoutException` (`E_MUTEX_TIMEOUT`, HTTP 409) | `acquire()` or `synchronized()` did not get the lock before the timeout; a `@Synchronized` action whose lock is held by another request |
| `MutexLostException` (`E_MUTEX_LOST`) | Not thrown: the abort reason of `lock.signal` when the lock is lost |
| `MutexDriverException` (`E_MUTEX_DRIVER`) | The lock store failed (unreachable, a failed query, a file error) during a call |
| `MutexDriverNotFoundException` (`E_MUTEX_DRIVER_NOT_FOUND`) | The first acquisition, when the driver's package (`redis`, `pg`, `mysql2`) is not installed |
| `InvalidObjectOptionsException` (from `lakutata`) | An option of the component has an invalid value; the application fails to start |
| `TypeError` | An empty lock name; a `@Synchronized` template whose field is missing from the input |

## See also

- `doc/en/Mutex.md` in the `lakutata` package (Chinese version in `doc/zh`): the guide to locks.
- `@lakutata/entrypoint` (`lakutata/com/entrypoint`): controllers, `@Schedule` and the schedule adapter.
- `@lakutata/core` (`lakutata`): components, `Application` and dependency injection.
- `npm run test:stores` (in this package) tests the drivers against Redis, PostgreSQL and MySQL in Docker.

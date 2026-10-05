# @lakutata/mutex

The lock component of the lakutata framework: named locks that give a work to one holder at a time, between the
components of a process, the processes of a host, or every instance of an application, as its driver shares them
(memory, lock files, Redis, PostgreSQL or MySQL). The locks are held by a token, renewed while they are held, and lost
(an `AbortSignal` aborted) when their holder can no longer keep them. It also provides `@Synchronized` for controller
actions and the locks of the `exclusive` schedules. The umbrella package `lakutata` re-exports it as
`lakutata/com/mutex`.

## Installation

```shell
npm install lakutata
```

The memory and file drivers need nothing more; the other drivers use optional peer dependencies, installed when used.
A driver whose package is missing fails the first acquisition with `MutexDriverNotFoundException`.

| Driver | `type` | Shared by | Install | Expires / renewed | Fencing token |
|---|---|---|---|---|---|
| Memory (the default) | `'memory'` | the components of one process | none | yes | yes (per process) |
| Lock files | `'file'` | the processes of one host | none | yes; a lock of a dead process is taken over at once | no |
| Redis 4+ (or Valkey) | `'redis'` | every instance on the server or cluster | `redis` (4.6 or 5) | yes | yes |
| PostgreSQL, `mode: 'advisory'` (default) | `'postgres'` | every instance on the database | `pg` (8) | no: released when the connection closes | no |
| PostgreSQL, `mode: 'table'` | `'postgres'` | every instance on the database, through the poolers | `pg` (8) | yes | yes |
| MySQL / MariaDB, `mode: 'advisory'` (default) | `'mysql'` | every instance on the server (not the clusters) | `mysql2` (3) | no: released when the connection closes | no |
| MySQL / MariaDB, `mode: 'table'` | `'mysql'` | every instance on the database, the clusters included | `mysql2` (3) | yes | yes |

## Usage

### The component in an application

Register `Mutex` in the `components` of the application, named `mutex` (the name `@Synchronized` and the `exclusive`
schedules use by default), then get it with `getObject()` or `@Inject`. Without `driver`, the locks are in memory.

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

- **Holders**: a lock is acquired with a random token; only its holder releases or renews it. A lock is released once:
  the next `release()` calls return `false`.
- **Expiration**: the expiring drivers hold a lock for its `ttl` (milliseconds), and the component renews it every
  third of that time, so a crashed holder keeps it at most one `ttl`. The advisory locks of PostgreSQL and MySQL do not
  expire: the database releases them when the component's connection closes.
- **Lost locks**: when a renewal finds the lock expired or taken, when the renewals keep failing (the store unreachable)
  until the lock expires, or when the connection holding an advisory lock closes, the lock is lost: `lock.held` becomes `false` and `lock.signal` is aborted with a
  `MutexLostException`. The work it protects is not interrupted: it should watch the signal.
- **Fencing tokens**: `lock.fence` increases with each acquisition (memory, Redis, the `table` modes). Write it along
  with the data the lock protects, so that the store refuses the writes of an older holder.
- **Not reentrant**: acquiring a lock the component already holds waits for its release, like any other holder.
- **Connections**: the driver connects at the first acquisition, not when the component is created. A store failing
  rejects the calls with `MutexDriverException`; an unreachable Redis server fails the calls (its first connection
  given up after 5 seconds, the calls during a reconnection failing at once).
- **Lifecycle**: the component releases the locks it holds and closes its driver when it is destroyed (the application
  stopping).

### Synchronized controller actions

`@Synchronized` runs a controller action holding a lock, acquired once its input is validated and its access control
passed, released after it. The requests needing the same lock run one at a time in every instance, whatever their
transport; the others run in parallel. The wait stops when the request is aborted (its client gone); a request not
getting the lock in time fails with `MutexTimeoutException` (HTTP 409).

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

A scheduled action declared `exclusive` (`@Schedule` of `lakutata/decorator/ctrl`) runs in one instance of the
application at a time: each run tries to acquire the lock `schedule:<key>` (the action name by default) from the
component `mutex` (or `exclusive: {mutex, key}`), and the instances not getting it skip the run. Its intervals are
aligned on their multiples so that every instance plans the same times, and its lock is kept until half of its period
(30 s at most) after a short run, so that the instances whose clocks are late skip it too. Without its lock component,
the action does not run (the error is logged).

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
| `MutexLock` | A lock held: `name`, `token`, `fence`, `acquiredAt`, `held`, `signal`, `release()`, `extend()`, `await using` |
| `MutexAcquireOptions` | The `ttl`, `timeout` and abort `signal` of an acquisition |
| `MutexDriverOptions` | The `driver` option: one of the driver options below, told apart by `type` |
| `MemoryMutexOptions`, `FileMutexOptions`, `RedisMutexOptions`, `PostgresMutexOptions`, `MysqlMutexOptions` | The options of each driver |
| `Synchronized` | Method decorator running a controller action holding a lock |
| `SynchronizedOptions` | The lock component, `timeout`, `wait` and `ttl` of `@Synchronized` |
| `lockNameOf` | Builds a lock name from a template (`'order:{id}'`) and an input |
| `MutexDriver`, `DriverLock` | The base class of the drivers, and a lock granted by a driver |
| `MemoryMutexDriver`, `FileMutexDriver`, `RedisMutexDriver`, `PostgresMutexDriver`, `MysqlMutexDriver` | The drivers, usable directly without the component (no waiting, no renewal) |
| `RedisMutexConnection`, `PostgresMutexConnection`, `MysqlMutexConnection` | The connections given to the drivers' constructors |
| `MutexTimeoutException`, `MutexLostException`, `MutexDriverException`, `MutexDriverNotFoundException` | The exceptions |

All are exported by `lakutata/com/mutex` and `@lakutata/mutex`. The typings document each declaration with examples.

## Errors

| Exception | When |
|---|---|
| `MutexTimeoutException` (`E_MUTEX_TIMEOUT`, HTTP 409) | `acquire()` or `synchronized()` did not get the lock before the timeout; a `@Synchronized` action whose lock another request holds |
| `MutexLostException` (`E_MUTEX_LOST`) | Not thrown: the abort reason of `lock.signal` when the lock is lost |
| `MutexDriverException` (`E_MUTEX_DRIVER`) | The lock store failed (unreachable, a failed query, a file error) during a call |
| `MutexDriverNotFoundException` (`E_MUTEX_DRIVER_NOT_FOUND`) | The first acquisition, when the driver's package (`redis`, `pg`, `mysql2`) is not installed |
| `InvalidValueException` (from `lakutata`) | The component's options are invalid, when it is created |
| `TypeError` | An empty lock name; a `@Synchronized` template whose field is missing from the input |

## See also

- `doc/en/Mutex.md` of the package `lakutata` (Chinese in `doc/zh`): the guide of the locks.
- `@lakutata/entrypoint` (`lakutata/com/entrypoint`): the controllers, `@Schedule` and the schedule adapter.
- `@lakutata/core` (`lakutata`): the components, `Application` and the dependency injection.
- `npm run test:stores` (in this package) tests the drivers against Redis, PostgreSQL and MySQL in Docker.

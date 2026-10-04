# Lakutata Mutex

The **Mutex component** (`lakutata/com/mutex`, package `@lakutata/mutex`) gives the named locks of an application: a
work runs in one holder at a time, between the components of a process, the processes of a host, or every instance of
the application, as its driver shares the locks. It also provides `@Synchronized` for the controller actions and the
locks of the `exclusive` schedules. The README of `@lakutata/mutex` gives the details.

## 1. Configuration

Declare `Mutex` in the `components` of the application, named `mutex` (the name `@Synchronized` and the `exclusive`
schedules use by default). Without `driver`, the locks are in memory.

```typescript
import {Application} from 'lakutata'
import {Mutex} from 'lakutata/com/mutex'

Application.run(() => ({
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
```

| Driver | Shared by | Notes |
|---|---|---|
| `{type: 'memory'}` (default) | the components of a process | development, tests, a single instance |
| `{type: 'file', directory}` | the processes of a host | lock files created exclusively; a lock of a dead process is taken over at once |
| `{type: 'redis', url}` | every instance | Redis 4+ or Valkey, package `redis`; fencing tokens; use `noeviction` (an evicted key is a lost lock) |
| `{type: 'postgres', host, database, username, password, mode}` | every instance | package `pg`; `mode: 'advisory'` (default): advisory locks on a connection of its own, released when it closes, not through PgBouncer in transaction mode; `mode: 'table'`: rows of a table, expiring, fencing tokens |
| `{type: 'mysql', host, database, username, password, mode}` | every instance | package `mysql2`; `mode: 'advisory'` (default): `GET_LOCK` on a connection of its own, not shared by the clusters; `mode: 'table'`: rows of a table, expiring, fencing tokens |

The clients (`redis`, `pg`, `mysql2`) are optional peer dependencies: a driver whose package is missing fails its first
acquisition with `MutexDriverNotFoundException`. The driver connects at the first acquisition.

## 2. Usage

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {type Mutex, type MutexLock} from 'lakutata/com/mutex'

class Orders extends Component {
    @Inject('mutex')
    protected readonly mutex: Mutex

    public async work(): Promise<void> {
        //Acquired before the function, released after it, even when it throws
        await this.mutex.synchronized('report:daily', async (lock: MutexLock): Promise<void> => {
            //Aborted with a MutexLostException when the lock is lost
            lock.signal.throwIfAborted()
        })

        //Waited for up to 3 s, then MutexTimeoutException
        const lock: MutexLock = await this.mutex.acquire('order:42', {timeout: 3000})
        try {
            console.log(lock.fence)
        } finally {
            await lock.release()
        }

        //Tried once: undefined when another holder has it
        const cleanup: MutexLock | undefined = await this.mutex.tryAcquire('cleanup')
        await cleanup?.release()

        //Released at the end of the block
        {
            await using scoped: MutexLock = await this.mutex.acquire('order:43')
            console.log(scoped.held)
        }
    }
}
```

- **Holders**: a lock is acquired with a random token; only its holder releases or renews it.
- **Expiration**: the expiring drivers hold a lock for its `ttl` and the component renews it every third of that time,
  so a crashed holder keeps it at most one `ttl`. The advisory locks of PostgreSQL and MySQL do not expire: they end
  with their connection.
- **Lost locks**: when a renewal fails until the lock expires, or the connection holding an advisory lock closes,
  `lock.held` becomes `false` and `lock.signal` is aborted with a `MutexLostException`. The work is not interrupted: it
  should watch the signal.
- **Fencing tokens**: `lock.fence` increases with each acquisition (memory, Redis, the `table` modes): the stores
  written under a lock may refuse the writes of an older holder.
- **Not reentrant**: acquiring a lock the component already holds waits for its release, like any other holder.
- **Lifecycle**: the component releases its locks and closes its driver when it is destroyed (the application
  stopping).

## 3. Synchronized actions

`@Synchronized(name, options?)` runs a controller action holding a lock, acquired once its input is validated and its
access control passed, released after it: the requests of a same lock run one at a time in every instance (whatever
their transport), the others in parallel. The name is a template whose `{field}` are fields of the validated input, or
a function `(input, context) => string`. The options are `mutex` (the component name, `'mutex'` by default), `timeout`,
`wait` and `ttl`. A request not getting the lock in time fails with `MutexTimeoutException` (HTTP 409); the wait stops
when the request is aborted.

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {HTTPAction, ServiceAction} from 'lakutata/decorator/ctrl'
import {Synchronized} from 'lakutata/com/mutex'

class OrderController extends Controller {
    //A lock per order: {id} is a field of the validated input
    @HTTPAction('/orders/:id/pay', 'POST')
    @ServiceAction({cmd: 'order.pay'})
    @Synchronized('order:{id}')
    public async pay(input: { id: number }): Promise<void> {
    }

    //Fails at once (HTTP 409) while another request runs it
    @ServiceAction({cmd: 'search.reindex'})
    @Synchronized('search:reindex', {wait: false})
    public async reindex(): Promise<void> {
    }

    //A name computed from the input, a lock component registered as "locks", a wait of 5 s
    @ServiceAction({cmd: 'user.export'})
    @Synchronized((input: { userId: string }): string => `export:${input.userId}`, {timeout: 5000, mutex: 'locks'})
    public async export(input: { userId: string }): Promise<void> {
    }
}
```

## 4. Exclusive schedules

A scheduled action declared `exclusive` runs in one instance of the application at a time: each run tries to acquire
the lock `schedule:<key>` (the action name by default) from the component `mutex` (or `exclusive: {mutex, key}`), and
the instances not getting it skip the run. Its intervals are aligned on their multiples so that every instance plans the
same times, and its lock is kept until half of its period (30 s at most) after a short run, so that the instances whose
clocks are late skip it too. Without its lock component, the action does not run (the error is logged).

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {Schedule} from 'lakutata/decorator/ctrl'

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
```

The entrypoint needs a schedule adapter: `BuildEntrypoints({controllers: [ReportController], schedule:
ScheduleEntrypoint()})` (see [ActionPattern](ActionPattern.md)).

## 5. Exceptions

| Exception | When |
|---|---|
| `MutexTimeoutException` (HTTP 409) | The lock is not acquired before the timeout; a `@Synchronized` action whose lock another request holds |
| `MutexLostException` | Not thrown: the abort reason of `lock.signal` when the lock is lost |
| `MutexDriverException` | The lock store failed during a call |
| `MutexDriverNotFoundException` | The package of the driver (`redis`, `pg`, `mysql2`) is not installed |

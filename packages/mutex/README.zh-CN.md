# @lakutata/mutex

[English](README.md) | 中文

lakutata 框架的锁组件：具名的锁，同一时间只让一个持有者执行某项工作。按所用的驱动（内存、锁文件、Redis、PostgreSQL 或 MySQL），锁可以由一个进程内的各组件共享，由一台机器上的各进程共享，或者由应用的所有实例共享。持有锁要凭一个令牌，持有期间锁会不断续期；持有者无法再保住锁时，锁就丢失了，锁的 `AbortSignal` 会被中止。这个包还为控制器动作提供 `@Synchronized`，并为 `exclusive` 定时任务提供锁。`lakutata` 包把它重新导出为 `lakutata/com/mutex`。

## 安装

```shell
npm install lakutata
```

内存驱动和文件驱动不需要再安装其他包。其他驱动所需的包都是可选的 peer 依赖：用哪个驱动，就安装哪个驱动的包。缺少驱动的包时，第一次获取锁会失败，抛出 `MutexDriverNotFoundException`。

| 驱动 | `type` | 共享范围 | 需要安装 | 过期 / 续期 | 防护令牌 |
|---|---|---|---|---|---|
| 内存（默认） | `'memory'` | 一个进程内的各组件 | 无 | 是 | 是（每个进程单独计数） |
| 锁文件 | `'file'` | 一台机器上的各进程 | 无 | 是；已退出的进程持有的锁会被立即接管 | 否 |
| Redis 4+（或 Valkey） | `'redis'` | 连接到同一服务器或集群的所有实例 | `redis`（4.6 或 5） | 是 | 是 |
| PostgreSQL，`mode: 'advisory'`（默认） | `'postgres'` | 连接到同一数据库的所有实例 | `pg`（8） | 否：连接关闭时释放 | 否 |
| PostgreSQL，`mode: 'table'` | `'postgres'` | 连接到同一数据库的所有实例，通过连接池代理连接的也可以 | `pg`（8） | 是 | 是 |
| MySQL / MariaDB，`mode: 'advisory'`（默认） | `'mysql'` | 连接到同一服务器的所有实例（集群的各节点之间不共享） | `mysql2`（3） | 否：连接关闭时释放 | 否 |
| MySQL / MariaDB，`mode: 'table'` | `'mysql'` | 连接到同一数据库的所有实例，包括集群 | `mysql2`（3） | 是 | 是 |

## 用法

### 在应用中使用组件

在应用的 `components` 中以 `mutex` 为名注册 `Mutex`（`@Synchronized` 和 `exclusive` 定时任务默认使用这个名称），然后用 `getObject()` 或 `@Inject` 获取它。不指定 `driver` 时，锁保存在内存中。

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
                //不续期时持有 30 秒，持有期间每 10 秒续期一次
                ttl: 30000,
                //最多等待 10 秒
                timeout: 10000,
                prefix: 'lakutata:mutex:'
            }
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const mutex: Mutex = await app.getObject('mutex')

        //执行函数前获取，执行后释放，函数抛出异常时也会释放
        await mutex.synchronized('report:daily', async (lock: MutexLock): Promise<void> => {
            //锁丢失时以 MutexLostException 中止
            lock.signal.throwIfAborted()
        })

        //最多等待 3 秒，超时抛出 MutexTimeoutException
        const lock: MutexLock = await mutex.acquire('order:42', {timeout: 3000})
        try {
            console.log(lock.fence)
        } finally {
            await lock.release()
        }

        //只尝试一次：被其他持有者占用时返回 undefined
        const cleanup: MutexLock | undefined = await mutex.tryAcquire('cleanup')
        await cleanup?.release()

        //在代码块结束时释放
        {
            await using scoped: MutexLock = await mutex.acquire('order:43')
            console.log(scoped.held)
        }
    })
```

- **持有者**：获取锁时使用一个随机令牌，只有持有者能释放或续期它。一把锁只会释放一次：之后再调用 `release()` 会返回 `false`。
- **过期**：锁会过期的驱动按 `ttl`（毫秒）持有锁，组件每过三分之一的时间续期一次，所以崩溃的持有者最多再占用一个 `ttl`。PostgreSQL 和 MySQL 的咨询锁不会过期：组件的连接关闭时，数据库会释放它们。
- **锁丢失**：以下情况锁会丢失：续期时发现锁已过期或已被其他持有者拿走；续期一直失败（存储连不上），直到锁过期；持有咨询锁的连接关闭。此时 `lock.held` 变为 `false`，`lock.signal` 以 `MutexLostException` 中止。受保护的工作不会被打断，所以它应当关注这个信号。
- **防护令牌**：`lock.fence` 随每次获取递增（内存、Redis 和 `table` 模式）。把它和锁保护的数据存在一起，数据存储就能拒绝旧持有者的写入。
- **不可重入**：获取组件已持有的锁时，和其他持有者一样要等待它被释放。
- **连接**：驱动在第一次获取锁时才连接，而不是在组件创建时。锁的存储出错时，调用以 `MutexDriverException` 失败。Redis 服务器连不上时，调用会失败：第一次连接在 5 秒后放弃，客户端重连期间的调用会立即失败。
- **生命周期**：组件被销毁时（应用停止时），会释放它持有的锁并关闭驱动。

### 同步的控制器动作

`@Synchronized` 让控制器动作在锁的保护下执行。锁在输入校验和访问控制通过之后获取，动作结束后释放。需要同一把锁的请求，无论来自哪个实例、通过哪种传输方式，都逐个执行；其他请求并行执行。请求被中止时（客户端已离开）不再等待；没有及时获得锁的请求以 `MutexTimeoutException`（HTTP 409）失败。

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {HTTPAction, ServiceAction} from 'lakutata/decorator/ctrl'
import {Synchronized} from 'lakutata/com/mutex'

class OrderController extends Controller {
    //每个订单一把锁：{id} 是校验后输入中的字段
    @HTTPAction('/orders/:id/pay', 'POST')
    @ServiceAction({cmd: 'order.pay'})
    @Synchronized('order:{id}')
    public async pay(input: {id: number}): Promise<void> {
    }

    //其他请求正在执行时立即失败（HTTP 409）
    @ServiceAction({cmd: 'search.reindex'})
    @Synchronized('search:reindex', {wait: false})
    public async reindex(): Promise<void> {
    }

    //根据输入计算锁名，使用注册为 "locks" 的锁组件，最多等待 5 秒
    @ServiceAction({cmd: 'user.export'})
    @Synchronized((input: {userId: string}): string => `export:${input.userId}`, {timeout: 5000, mutex: 'locks'})
    public async export(input: {userId: string}): Promise<void> {
    }
}
```

### 独占的定时任务

声明为 `exclusive` 的定时动作（使用 `lakutata/decorator/ctrl` 的 `@Schedule`），同一时间只在应用的一个实例中执行。每次执行都尝试从 `mutex` 组件（或者 `exclusive: {mutex, key}` 指定的组件和键）获取锁 `schedule:<key>`（键默认为动作的名字），没有获得锁的实例跳过这次执行。按间隔执行的任务对齐到间隔的整数倍（每 5 分钟就是 :00、:05、:10……），这样所有实例安排的时间都相同。执行结束后，锁会一直保留到计划时间之后半个周期（最多 30 秒），这样时钟稍慢的实例也会跳过这次执行。找不到锁组件时，这个动作不会执行，错误会写入日志。

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller, scheduleEntrypoint} from 'lakutata/com/entrypoint'
import {Schedule} from 'lakutata/decorator/ctrl'
import {Mutex} from 'lakutata/com/mutex'

class ReportController extends Controller {
    //每 5 分钟由一个实例执行
    @Schedule({every: '5m', exclusive: true})
    public async build(): Promise<void> {
    }

    //每天 03:00，使用组件 "locks" 中名为 schedule:purge 的锁
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

| 导出 | 说明 |
|---|---|
| `Mutex` | 组件：`tryAcquire`、`acquire`、`synchronized`、`heldLocks`；选项 `driver`、`prefix`、`ttl`、`timeout`、`retryDelay` |
| `MutexLock` | 已持有的锁：`name`、`token`、`fence`、`acquiredAt`、`held`、`signal`、`release()`、`extend()`、`await using` |
| `MutexAcquireOptions` | 一次获取的 `ttl`、`timeout` 和用于中止的 `signal` |
| `MutexDriverOptions` | `driver` 选项：下面某个驱动的选项，以 `type` 区分 |
| `MemoryMutexOptions`、`FileMutexOptions`、`RedisMutexOptions`、`PostgresMutexOptions`、`MysqlMutexOptions` | 各个驱动的选项 |
| `Synchronized` | 方法装饰器，让控制器动作在锁的保护下执行 |
| `SynchronizedOptions` | `@Synchronized` 的锁组件、`timeout`、`wait` 和 `ttl` |
| `lockNameOf` | 根据模板（`'order:{id}'`）和输入生成锁名 |
| `MutexDriver`、`DriverLock` | 驱动的基类，以及驱动授予的锁 |
| `MemoryMutexDriver`、`FileMutexDriver`、`RedisMutexDriver`、`PostgresMutexDriver`、`MysqlMutexDriver` | 各个驱动，可以不通过组件直接使用（不等待，也不续期） |
| `RedisMutexConnection`、`PostgresMutexConnection`、`MysqlMutexConnection` | 传给驱动构造函数的连接 |
| `MutexTimeoutException`、`MutexLostException`、`MutexDriverException`、`MutexDriverNotFoundException` | 异常 |

以上全部由 `lakutata/com/mutex` 和 `@lakutata/mutex` 导出。类型声明中的每一项都附有说明和示例。

## 错误

| 异常 | 什么时候 |
|---|---|
| `MutexTimeoutException`（`E_MUTEX_TIMEOUT`，HTTP 409） | `acquire()` 或 `synchronized()` 在超时前没有获得锁；`@Synchronized` 动作的锁被其他请求持有 |
| `MutexLostException`（`E_MUTEX_LOST`） | 不会被抛出：锁丢失时作为 `lock.signal` 的中止原因 |
| `MutexDriverException`（`E_MUTEX_DRIVER`） | 调用期间锁的存储出错（连不上、查询失败、文件错误） |
| `MutexDriverNotFoundException`（`E_MUTEX_DRIVER_NOT_FOUND`） | 第一次获取锁时，驱动所需的包（`redis`、`pg`、`mysql2`）没有安装 |
| `InvalidObjectOptionsException`（来自 `lakutata`） | 组件的某个选项的值不合法；应用启动失败 |
| `TypeError` | 锁名为空；`@Synchronized` 模板中的字段在输入中不存在 |

## 另见

- `lakutata` 包中的 `doc/zh/Mutex.md`：锁的指南。
- `@lakutata/entrypoint`（`lakutata/com/entrypoint`）：控制器、`@Schedule` 和定时任务适配器。
- `@lakutata/core`（`lakutata`）：组件、`Application` 和依赖注入。
- 在这个包中运行 `npm run test:stores`，会在 Docker 中针对 Redis、PostgreSQL 和 MySQL 测试各个驱动。

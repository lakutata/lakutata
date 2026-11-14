# Lakutata 互斥锁

**Mutex 组件**（`lakutata/com/mutex`，`@lakutata/mutex` 包）为应用提供具名锁：受同一把锁保护的工作，同一时间只在一处执行。锁的共享范围取决于所用的驱动，可以是一个进程内的各组件、一台机器上的各进程，或者应用的所有实例。该组件还为 `@Synchronized`（在锁的保护下执行控制器动作）和 `exclusive` 定时任务提供支持。详细说明见 `@lakutata/mutex` 的 README。

## 1. 配置

在应用的 `components` 中声明 `Mutex`，并命名为 `mutex`（`@Synchronized` 和 `exclusive` 定时任务默认使用该名称）。不指定 `driver` 时，锁保存在内存中。

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
            //不续期时持有 30 秒，持有期间每 10 秒续期一次
            ttl: 30000,
            //最多等待 10 秒
            timeout: 10000,
            prefix: 'lakutata:mutex:'
        }
    }
}))
```

| 驱动 | 共享范围 | 说明 |
|---|---|---|
| `{type: 'memory'}`（默认） | 一个进程内的各组件 | 开发、测试、单实例 |
| `{type: 'file', directory?}` | 一台机器上的各进程 | 以独占方式创建锁文件（不指定 `directory` 时，放在系统临时目录下的 `lakutata-mutex` 中）；已退出的进程所持有的锁会被立即接管 |
| `{type: 'redis', url}` | 所有实例 | Redis 4+ 或 Valkey，需要 `redis` 包；提供防护令牌；请使用 `noeviction`（键被淘汰即意味着锁丢失） |
| `{type: 'postgres', host, database, username, password, mode}` | 所有实例 | 需要 `pg` 包；`mode: 'advisory'`（默认）：在独占的连接上使用咨询锁，连接关闭时释放，无法通过事务模式的 PgBouncer 使用；`mode: 'table'`：使用表中的行，会过期，提供防护令牌 |
| `{type: 'mysql', host, database, username, password, mode}` | 所有实例 | 需要 `mysql2` 包；`mode: 'advisory'`（默认）：在独占的连接上使用 `GET_LOCK`，集群的各节点之间不共享；`mode: 'table'`：使用表中的行，会过期，提供防护令牌 |

客户端（`redis`、`pg`、`mysql2`）是可选的 peer 依赖。驱动在首次获取锁时才建立连接；缺少其所需的包时，该次获取以 `MutexDriverNotFoundException` 失败。

## 2. 使用

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {type Mutex, type MutexLock} from 'lakutata/com/mutex'

class Orders extends Component {
    @Inject('mutex')
    protected readonly mutex: Mutex

    public async work(): Promise<void> {
        //执行函数前获取，执行后释放，函数抛出异常时也会释放
        await this.mutex.synchronized('report:daily', async (lock: MutexLock): Promise<void> => {
            //锁丢失时以 MutexLostException 中止
            lock.signal.throwIfAborted()
        })

        //最多等待 3 秒，超时抛出 MutexTimeoutException
        const lock: MutexLock = await this.mutex.acquire('order:42', {timeout: 3000})
        try {
            console.log(lock.fence)
        } finally {
            await lock.release()
        }

        //只尝试一次：被其他持有者占用时返回 undefined
        const cleanup: MutexLock | undefined = await this.mutex.tryAcquire('cleanup')
        await cleanup?.release()

        //在代码块结束时释放
        {
            await using scoped: MutexLock = await this.mutex.acquire('order:43')
            console.log(scoped.held)
        }
    }
}
```

- **持有者**：获取锁时使用一个随机令牌；只有持有者能够释放或续期该锁。
- **过期**：会过期的驱动按 `ttl` 持有锁，组件每经过该时长的三分之一续期一次，因此崩溃的持有者最多再占用锁一个 `ttl`。PostgreSQL 和 MySQL 的咨询锁不会过期，而是随连接一起结束。
- **锁丢失**：续期持续失败直至锁过期，或者持有咨询锁的连接关闭时，`lock.held` 变为 `false`，`lock.signal` 以 `MutexLostException` 中止。受保护的工作不会被打断，因此它应当关注该信号。
- **防护令牌**：`lock.fence` 随每次获取递增（内存、Redis、`table` 模式），在锁保护下写入的存储可以借此拒绝旧持有者的写入。
- **不可重入**：获取组件已持有的锁时，与其他持有者一样需要等待该锁被释放。
- **生命周期**：组件在销毁时（即应用停止时）释放其持有的锁并关闭驱动。

## 3. 同步的动作

`@Synchronized(name, options?)` 让控制器动作在锁的保护下执行：锁在输入校验和访问控制通过之后获取，在动作结束后释放。需要同一把锁的请求在所有实例中逐个执行，与所用的传输方式无关；其他请求并行执行。名称是一个模板，其中的 `{field}` 取自校验后的输入；名称也可以是函数 `(input, context) => string`。选项包括 `mutex`（组件名，默认为 `'mutex'`）、`timeout`、`wait` 和 `ttl`。未能及时获得锁的请求以 `MutexTimeoutException`（HTTP 409）失败；请求被中止时，不再继续等待。

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {HTTPAction, ServiceAction} from 'lakutata/decorator/ctrl'
import {Synchronized} from 'lakutata/com/mutex'

class OrderController extends Controller {
    //每个订单一把锁：{id} 是校验后输入中的字段
    @HTTPAction('/orders/:id/pay', 'POST')
    @ServiceAction({cmd: 'order.pay'})
    @Synchronized('order:{id}')
    public async pay(input: { id: number }): Promise<void> {
    }

    //其他请求正在执行时立即失败（HTTP 409）
    @ServiceAction({cmd: 'search.reindex'})
    @Synchronized('search:reindex', {wait: false})
    public async reindex(): Promise<void> {
    }

    //根据输入计算锁名，使用注册为 "locks" 的锁组件，最多等待 5 秒
    @ServiceAction({cmd: 'user.export'})
    @Synchronized((input: { userId: string }): string => `export:${input.userId}`, {timeout: 5000, mutex: 'locks'})
    public async export(input: { userId: string }): Promise<void> {
    }
}
```

## 4. 独占的定时任务

声明为 `exclusive` 的定时动作同一时间只在应用的一个实例中执行。每次执行时，各实例尝试从组件 `mutex`（或者 `exclusive: {mutex, key}` 指定的组件）获取锁 `schedule:<key>`（key 默认为动作的名称），未获得锁的实例跳过本次执行。间隔按时钟对齐（每 5 分钟即为 :00、:05、:10……），因此所有实例计划的执行时间相同。执行结束后，锁会保留到计划时间之后的半个周期（最多 30 秒），这样即使某个实例的时钟稍慢，也不会再次执行该任务。没有锁组件时，该动作不会执行，错误会写入日志。

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {Schedule} from 'lakutata/decorator/ctrl'

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
```

入口需要配置定时适配器：`buildEntrypoints({controllers: [ReportController], schedule: scheduleEntrypoint()})`（见[定时任务](Schedules.md)）。

## 5. 异常

| 异常 | 抛出时机 |
|---|---|
| `MutexTimeoutException`（HTTP 409） | 超时前未获得锁；`@Synchronized` 动作的锁被其他请求持有 |
| `MutexLostException` | 不会被抛出，而是在锁丢失时作为 `lock.signal` 的中止原因 |
| `MutexDriverException` | 调用期间锁的存储发生错误 |
| `MutexDriverNotFoundException` | 未安装驱动所需的包（`redis`、`pg`、`mysql2`） |

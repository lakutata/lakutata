# Lakutata 互斥锁

**Mutex 组件**（`lakutata/com/mutex`，`@lakutata/mutex` 包）为应用提供具名的锁：受同一把锁保护的工作，同一时间只在一处执行。按所用的驱动，锁可以由一个进程内的各组件共享，由一台机器上的各进程共享，或者由应用的所有实例共享。这个组件还支撑 `@Synchronized`（让控制器动作在锁的保护下执行）和 `exclusive` 定时任务。更多细节见 `@lakutata/mutex` 的 README。

## 1. 配置

在应用的 `components` 中声明 `Mutex`，并命名为 `mutex`（`@Synchronized` 和 `exclusive` 定时任务默认使用这个名称）。不指定 `driver` 时，锁保存在内存中。

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
| `{type: 'file', directory?}` | 一台机器上的各进程 | 以独占方式创建锁文件（不指定 `directory` 时，放在系统临时目录下的 `lakutata-mutex` 中）；已退出的进程持有的锁会被立即接管 |
| `{type: 'redis', url}` | 所有实例 | Redis 4+ 或 Valkey，需要 `redis` 包；有防护令牌；请使用 `noeviction`（被淘汰的键就是丢失的锁） |
| `{type: 'postgres', host, database, username, password, mode}` | 所有实例 | 需要 `pg` 包；`mode: 'advisory'`（默认）：在独占的连接上使用咨询锁，连接关闭时释放，不能通过事务模式的 PgBouncer 使用；`mode: 'table'`：表中的行，会过期，有防护令牌 |
| `{type: 'mysql', host, database, username, password, mode}` | 所有实例 | 需要 `mysql2` 包；`mode: 'advisory'`（默认）：在独占的连接上使用 `GET_LOCK`，集群的各节点之间不共享；`mode: 'table'`：表中的行，会过期，有防护令牌 |

客户端（`redis`、`pg`、`mysql2`）是可选的 peer 依赖。驱动在第一次获取锁时才建立连接；缺少它所需的包时，这次获取会以 `MutexDriverNotFoundException` 失败。

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

- **持有者**：获取锁时使用一个随机令牌；只有持有者能释放或续期它。
- **过期**：会过期的驱动按 `ttl` 持有锁，组件每过三分之一的时间续期一次，所以崩溃的持有者最多再占用一个 `ttl`。PostgreSQL 和 MySQL 的咨询锁不会过期：它们随连接一起结束。
- **锁丢失**：续期一直失败直到锁过期，或者持有咨询锁的连接关闭时，`lock.held` 变为 `false`，`lock.signal` 以 `MutexLostException` 中止。受保护的工作不会被打断：它应当关注这个信号。
- **防护令牌**：`lock.fence` 随每次获取递增（内存、Redis、`table` 模式）：在锁的保护下写入的存储，可以用它拒绝旧持有者的写入。
- **不可重入**：获取组件已持有的锁时，和其他持有者一样要等待它被释放。
- **生命周期**：组件被销毁时（应用停止时）会释放它持有的锁并关闭驱动。

## 3. 同步的动作

`@Synchronized(name, options?)` 让控制器动作在锁的保护下执行：锁在输入校验和访问控制通过之后获取，动作结束后释放。需要同一把锁的请求，在所有实例中逐个执行，无论通过哪种传输方式；其他请求并行执行。名称是一个模板，其中的 `{field}` 取自校验后的输入；也可以是函数 `(input, context) => string`。选项有 `mutex`（组件名，默认 `'mutex'`）、`timeout`、`wait` 和 `ttl`。没有及时获得锁的请求以 `MutexTimeoutException`（HTTP 409）失败；请求被中止时，它不再等待。

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

声明为 `exclusive` 的定时动作，同一时间只在应用的一个实例中执行：每次执行都尝试从组件 `mutex`（或者 `exclusive: {mutex, key}` 指定的组件）获取锁 `schedule:<key>`（key 默认为动作的名字），没有获得锁的实例跳过这次执行。间隔按时钟对齐（每 5 分钟就是 :00、:05、:10……），这样所有实例安排的时间都相同。执行结束后，锁会一直保留到计划时间之后半个周期（最多 30 秒），这样即使某个实例的时钟稍慢，也不会把任务再执行一遍。没有锁组件时，这个动作不会执行，错误会写入日志。

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

入口需要配置定时适配器：`buildEntrypoints({controllers: [ReportController], schedule: scheduleEntrypoint()})`（见 [Schedules](Schedules.md)）。

## 5. 异常

| 异常 | 什么时候 |
|---|---|
| `MutexTimeoutException`（HTTP 409） | 超时前没有获得锁；`@Synchronized` 动作的锁被其他请求持有 |
| `MutexLostException` | 不会被抛出：锁丢失时作为 `lock.signal` 的中止原因 |
| `MutexDriverException` | 调用期间锁的存储出错 |
| `MutexDriverNotFoundException` | 驱动所需的包（`redis`、`pg`、`mysql2`）没有安装 |

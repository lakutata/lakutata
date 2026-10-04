# Lakutata 互斥锁

**Mutex 组件**（`lakutata/com/mutex`，包 `@lakutata/mutex`）提供应用的锁：按驱动共享锁的范围，同一时刻只有一个实例（或进程）执行某项工作。

## 1. 配置

```typescript
import {Mutex} from 'lakutata/com/mutex'

components: {
    mutex: {
        class: Mutex,
        driver: {type: 'redis', url: 'redis://cache:6379'},
        ttl: 30000,      //锁在不续期时的持有时长（毫秒），持有期间会自动续期
        timeout: 10000,  //等待锁的时长（毫秒）
        prefix: 'lakutata:mutex:'
    }
}
```

| 驱动 | 共享范围 | 说明 |
|---|---|---|
| `{type: 'memory'}`（默认） | 进程内的各个组件 | 开发、测试、单实例部署 |
| `{type: 'file', directory}` | 同一台机器上的进程 | 独占创建锁文件；进程已退出的锁会被接管 |
| `{type: 'redis', url}` | 所有实例 | `SET NX PX`，提供防护令牌；请使用 `noeviction`（被淘汰的键等于锁丢失） |
| `{type: 'postgres', host, database, username, password, mode}` | 所有实例 | `mode: 'advisory'`（默认）：在独立连接上使用 `pg_try_advisory_lock`，连接关闭即释放，不能经过 PgBouncer 的事务级连接池；`mode: 'table'`：首次使用时自动建表，按行加锁，提供防护令牌 |
| `{type: 'mysql', host, database, username, password, mode}` | 所有实例 | `mode: 'advisory'`（默认）：在独立连接上使用 `GET_LOCK`，集群之间不同步；`mode: 'table'`：按行加锁，提供防护令牌 |

客户端（`redis`、`pg`、`mysql2`）是可选依赖，按所用的驱动安装。

## 2. 用法

```typescript
const mutex = await app.getObject<Mutex>('mutex')

//执行前加锁，执行后释放（出错也会释放）
await mutex.synchronized('report:daily', async (lock) => {
    //锁丢失时（续期前过期、连接断开）lock.signal 会被中止
})

//最多等待到超时（MutexTimeoutException），或只尝试一次
const lock = await mutex.acquire('order:42', {timeout: 3000})
try { ... } finally { await lock.release() }
const maybe = await mutex.tryAcquire('cleanup')   //被其他持有者占用时返回 undefined

//离开作用域时自动释放
await using scoped = await mutex.acquire('order:42')
```

- **持有者**：加锁时生成令牌，只有持有者能释放和续期。
- **过期**：锁按 `ttl` 持有，持有期间自动续期；持有者崩溃后锁不会一直残留。PostgreSQL 和 MySQL 的 advisory 锁则随连接结束。
- **防护令牌**：`lock.fence` 随每次加锁递增（Redis、table 模式、memory），持锁写入的存储可以拒绝旧令牌的写入。
- **不可重入**：已被持有的锁，即使在同一进程中再次加锁，也会等待其释放。
- **生命周期**：组件销毁（应用停止）时释放它持有的所有锁。

## 3. 同步执行的动作

`@Synchronized` 让控制器的动作在持有锁的情况下执行：在输入通过 DTO 校验、访问控制通过之后加锁，执行完释放。同一把锁的请求在所有实例中
（无论来自哪个通道）依次执行，不同锁的请求并行执行。

```typescript
class OrderController extends Controller {
    @HTTPAction('/orders/:id/pay', 'POST', PayDTO)
    @ServiceAction({cmd: 'order.pay'}, PayDTO)
    @Synchronized('order:{id}')            //每个订单一把锁：{id} 取自校验后的输入
    public async pay(input: PayDTO) { ... }

    @Synchronized('search:reindex', {wait: false})     //已有请求在执行时立即失败（HTTP 409）
    @Synchronized((input, context) => `export:${context.clientId}`, {timeout: 5000, mutex: 'locks'})
}
```

请求被中止（客户端断开）时会停止等锁：控制器有 `this.signal`，此时会被中止，耗时的工作也可以据此停止。

## 4. 互斥的定时任务

声明了 `exclusive` 的定时任务，同一时刻只在一个实例中执行：每一轮由拿到锁的实例执行（使用名为 `mutex` 的组件，或 `exclusive: {mutex, key}`），
其他实例跳过。间隔会对齐到整数倍（所有实例在同一时刻触发）；执行很快结束时，锁会保持到半个周期（最多 30 秒）后再释放，这样时钟稍慢的实例也会跳过。
找不到锁组件时任务不会执行（并写入错误日志）。

```typescript
class ReportController extends Controller {
    @Schedule({every: '5m', exclusive: true})
    public async build(): Promise<void> { ... }
}
```

## 5. 异常

`MutexTimeoutException`（超时仍未拿到锁）、`MutexLostException`（`lock.signal` 中止的原因）、
`MutexDriverException`（存储出错）、`MutexDriverNotFoundException`（未安装驱动所需的客户端）。

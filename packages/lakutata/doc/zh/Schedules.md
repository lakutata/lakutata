# Lakutata 定时任务

`@Schedule` 让控制器的方法按计划执行：每隔固定时间执行一次，或者在 cron 表达式指定的时间执行。负责执行这些方法的是定时适配器，即 `lakutata/com/entrypoint` 中的 `scheduleEntrypoint()`，不需要安装其他包。

## 1. 第一个定时任务

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller, scheduleEntrypoint} from 'lakutata/com/entrypoint'
import {Schedule} from 'lakutata/decorator/ctrl'

class JobController extends Controller {
    //每 30 秒一次
    @Schedule('30s')
    public async heartbeat(): Promise<void> {
        console.log('Still alive')
    }

    //每天上海时间 03:00
    @Schedule({cron: '0 3 * * *', timezone: 'Asia/Shanghai'})
    public async purge(): Promise<void> {
        console.log('Purging the expired sessions')
    }
}

Application.run(() => ({
    id: 'jobs.app',
    name: 'Jobs',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [JobController],
            schedule: scheduleEntrypoint()
        })
    },
    bootstrap: ['entrypoint']
}))
```

- 定时任务在应用启动完成后才开始。入口必须列在 `bootstrap` 里，并且要配置 `schedule` 适配器：没有它，标了 `@Schedule` 的方法永远不会执行。
- 按间隔执行的任务，第一次执行是在启动后过了一个间隔，而不是启动时立即执行（如果启动时也要执行一次，见下文的 `immediate`）。
- 应用的每个实例都会执行定时任务。如果同一时间只想让一个实例执行，见第 4 节。

## 2. 计划的写法

`@Schedule(schedule, options?)` 的第一个参数是计划。第二个参数是所有动作通用的动作选项（`name`、`description`、`acl`、`rule`、`middlewares`、`groups`）。和其他动作装饰器不同，它不接受 DTO：定时任务没有输入。控制器的 `@Prefix` 对定时任务不起作用。

计划可以是：

| 计划 | 含义 |
|---|---|
| `'30s'`、`'1h30m'`、`'1.5h'` | 用时长表示的间隔 |
| `5000` | 以毫秒表示的间隔 |
| `'0 */5 * * * *'`、`'@daily'` | cron 表达式（不是时长的字符串都按 cron 表达式处理） |
| `{every: '30s', ...}` | 间隔，可加下表中的选项 |
| `{cron: '0 3 * * *', timezone: 'Asia/Shanghai', ...}` | cron 表达式，可指定时区并加下表中的选项 |

时长由数字加单位组成，单位是 `ms`、`s`、`m`、`h` 或 `d`。多段会相加（`1h30m`），可以带小数（`1.5h`），中间可以有空格。没有单位的数字（`'30'`）不算时长：它会被当成 cron 表达式，然后报错。

对象形式的选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `overlap` | `false` | 上一次还没执行完时，也开始新的一次。默认会跳过这一次 |
| `immediate` | `false` | 应用启动完成后立即额外执行一次 |
| `exclusive` | `false` | 同一时间只在应用的一个实例中执行（见第 4 节） |
| `timezone` | 进程所在的时区 | cron 表达式使用的 IANA 时区 |

### cron 表达式

cron 表达式有 6 个字段；省略秒时是 5 个字段，秒取 0：

```text
┌──────────── 秒（0-59），可省略
│ ┌────────── 分（0-59）
│ │ ┌──────── 时（0-23）
│ │ │ ┌────── 日（1-31）
│ │ │ │ ┌──── 月（1-12，或 jan-dec）
│ │ │ │ │ ┌── 星期（0-7，或 sun-sat；0 和 7 都是星期日）
│ │ │ │ │ │
* * * * * *
```

每个字段可以写 `*`（或 `?`）、单个值、范围（`1-5`）、步长（`*/15`、`10/15`、`10-40/15`），或用逗号分隔的列表（`1,15,30`）。月份和星期的英文缩写不区分大小写（`mon-fri`）。日和星期两个字段都有限制时，满足其中任意一个就算匹配，与传统 cron 相同。

支持的宏有 `@yearly`（或 `@annually`）、`@monthly`、`@weekly`、`@daily`（或 `@midnight`）和 `@hourly`。不支持 `L`、`W`、`#` 和 `@reboot`。

| 表达式 | 执行时间 |
|---|---|
| `'*/10 * * * * *'` | 每 10 秒 |
| `'0 */5 * * *'` | 每 5 分钟 |
| `'30 9 * * mon-fri'` | 周一到周五的 09:30 |
| `'0 0 1 * *'` | 每月 1 日零点 |

**夏令时。** 在会调整时钟的时区里，春季被跳过的时刻（纽约 2026 年 3 月 8 日的 02:30）当天不会执行，秋季重复出现的时刻只执行一次。

**写错时。** 间隔或 cron 表达式不合法会抛出 `SyntaxError`，时区不存在会抛出 `RangeError`，这些错误在定义控制器类时就会抛出，应用还没启动。合法但永远不会匹配的表达式（比如 2 月 30 日，`'0 0 30 2 *'`）可以声明，但永远不会执行，也不会有任何日志。

## 3. 什么时候执行

- **间隔：** 启动后过一个间隔执行第一次，之后每隔一个间隔执行一次。
- **cron：** 每次都安排在下一个与表达式匹配的时间。
- **错过的执行**会被跳过，不会补上：进程被挂起过（比如笔记本休眠）之后，任务在下一个计划时间执行。
- **重叠：** 默认情况下，上一次还在执行时，这一次会被跳过。设置 `overlap: true` 后，同一个任务可以同时有多次在执行。
- **`immediate: true`** 会在应用启动完成后立即额外执行一次。

## 4. 只在一个实例中执行

应用常常同时运行多个实例（多个容器、多台服务器）。声明了 `exclusive: true` 的任务，同一时间只会在其中一个实例中执行：

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {Schedule} from 'lakutata/decorator/ctrl'

class ReportController extends Controller {
    //每 5 分钟，只在一个实例中执行
    @Schedule({every: '5m', exclusive: true})
    public async build(): Promise<void> {
    }

    //每天 03:00，使用组件 locks 中名为 schedule:purge 的锁
    @Schedule({cron: '0 3 * * *', exclusive: {mutex: 'locks', key: 'purge'}})
    public async purge(): Promise<void> {
    }
}
```

- 应用需要一个各实例共用的互斥锁组件，默认名为 `mutex`，也可以用 `exclusive.mutex` 指定（见 [Mutex](Mutex.md) 第 4 节）。没有这个组件时，任务不会执行，错误会写入日志。
- 每次执行前先尝试获取锁 `schedule:<key>`，key 默认是动作名，也可以用 `exclusive.key` 指定。没拿到锁的实例跳过这一次。
- 独占任务的间隔按时钟对齐（每 5 分钟就是 :00、:05、:10……），这样所有实例安排的时间都相同。
- 执行结束后，锁会一直保留到计划时间之后半个周期（最多 30 秒），这样即使某个实例的时钟稍慢，也不会把任务再执行一遍。

## 5. 执行过程中

每次执行都像处理一个请求：它在自己的作用域里得到一个新的控制器，经过入口的中间件和访问控制。方法不会收到输入，返回值也会被忽略。

`this.context` 是一个 `ScheduleContext`：

| 属性 | 含义 |
|---|---|
| `schedule` | 计划的文字形式：`'every 30s'`、`'cron 0 3 * * *'` |
| `scheduledAt` | 这次执行的计划时间（`Date`）；实际开始可能晚几毫秒 |
| `run` | 这是本进程中的第几次执行，从 1 开始（被跳过的不计入） |

```typescript
import {Controller, type ScheduleContext} from 'lakutata/com/entrypoint'
import {Schedule} from 'lakutata/decorator/ctrl'

class JobController extends Controller {
    @Schedule({every: '1m', immediate: true})
    public async sync(): Promise<void> {
        const context: ScheduleContext = this.context as ScheduleContext
        console.log(`Run ${context.run} of ${context.schedule}, planned at ${context.scheduledAt.toISOString()}`)
    }
}
```

## 6. 错误与跳过

某一次执行抛出错误，不会影响这个任务：后面的执行照常进行。默认情况下，错误由应用的日志组件（`log`）记录，没有日志组件时写到控制台。适配器的选项可以替换这一行为：

```typescript
import {scheduleEntrypoint} from 'lakutata/com/entrypoint'

export const schedule = scheduleEntrypoint({
    //某次执行失败
    onError: (error, action, context): void => {
        console.error(`${action.name} failed at ${context.scheduledAt.toISOString()}: ${(error as Error).message}`)
    },
    //某次执行被跳过：上一次还没结束（'overlap'），或者锁在别的实例手里（'exclusive'）
    onSkip: (action, scheduledAt, reason): void => {
        console.warn(`${action.name} skipped at ${scheduledAt.toISOString()} (${reason})`)
    }
})
```

适配器还接受 `middlewares`（定时任务专用的中间件，在入口的中间件之后执行）和 `name`。

## 7. 停止

应用停止时，不再开始新的执行，独占任务会释放它们的锁。正在执行的任务有入口的 `shutdownTimeout`（默认 30 秒）可以完成，超时后会被中止：`this.signal` 会被触发，耗时长的任务可以检查它并提前结束。

## 8. 计算下一次的时间

`lakutata/com/entrypoint` 中的 `Cron` 和 `parseDuration` 就是定时任务使用的解析器：

```typescript
import {Cron, parseDuration} from 'lakutata/com/entrypoint'

const cron: Cron = new Cron('30 9 * * mon-fri', 'Asia/Shanghai')
//给定时间之后的下一个时间（精确到秒），永远不匹配时为 undefined
console.log(cron.next(new Date('2026-10-16T12:00:00Z'))) //2026-10-19T01:30:00.000Z，即上海时间周一 09:30
console.log(parseDuration('1h30m')) //5400000
```

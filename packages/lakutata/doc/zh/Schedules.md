# Lakutata 定时任务

`@Schedule` 使控制器的方法按计划执行：每隔固定时间执行一次，或在 cron 表达式指定的时间执行。负责执行这些方法的是定时适配器，即 `lakutata/com/entrypoint` 中的 `scheduleEntrypoint()`，无需安装其他包。

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

- 定时任务在应用启动完成后才开始。入口必须列在 `bootstrap` 中，并且需要配置 `schedule` 适配器，否则标注了 `@Schedule` 的方法永远不会执行。
- 按间隔执行的任务在启动后经过一个间隔才首次执行，而不是在启动时立即执行（如果启动时也需执行一次，见下文的 `immediate`）。
- 应用的每个实例都会执行定时任务。如果希望同一时间只由一个实例执行，见第 4 节。

## 2. 计划的写法

`@Schedule(schedule, options?)` 的第一个参数是计划。第二个参数为所有动作通用的动作选项（`name`、`description`、`acl`、`rule`、`middlewares`、`groups`）。与其他动作装饰器不同，该装饰器不接受 DTO，因为定时任务没有输入。控制器的 `@Prefix` 对定时任务不起作用。

计划可以是：

| 计划 | 含义 |
|---|---|
| `'30s'`、`'1h30m'`、`'1.5h'` | 以时长表示的间隔 |
| `5000` | 以毫秒表示的间隔 |
| `'0 */5 * * * *'`、`'@daily'` | cron 表达式（不是时长的字符串都按 cron 表达式处理） |
| `{every: '30s', ...}` | 间隔，可附加下表中的选项 |
| `{cron: '0 3 * * *', timezone: 'Asia/Shanghai', ...}` | cron 表达式，可指定时区并附加下表中的选项 |

时长由数字和单位组成，单位为 `ms`、`s`、`m`、`h` 或 `d`。多段时长会相加（`1h30m`），可以带小数（`1.5h`），中间可以有空格。没有单位的数字（`'30'`）不视为时长，而是被当作 cron 表达式处理，随后报错。

对象形式的选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `overlap` | `false` | 上一次尚未执行完毕时，仍开始新的一次执行。默认会跳过这一次 |
| `immediate` | `false` | 应用启动完成后立即额外执行一次 |
| `exclusive` | `false` | 同一时间只在应用的一个实例中执行（见第 4 节） |
| `timezone` | 进程所在的时区 | cron 表达式使用的 IANA 时区 |

### cron 表达式

cron 表达式有 6 个字段；省略秒时为 5 个字段，秒取 0：

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

每个字段可以是 `*`（或 `?`）、单个值、范围（`1-5`）、步长（`*/15`、`10/15`、`10-40/15`），或用逗号分隔的列表（`1,15,30`）。月份和星期的英文缩写不区分大小写（`mon-fri`）。日和星期两个字段都有限制时，满足其中任意一个即视为匹配，与传统 cron 相同。

支持的宏有 `@yearly`（或 `@annually`）、`@monthly`、`@weekly`、`@daily`（或 `@midnight`）和 `@hourly`。不支持 `L`、`W`、`#` 和 `@reboot`。

| 表达式 | 执行时间 |
|---|---|
| `'*/10 * * * * *'` | 每 10 秒 |
| `'0 */5 * * *'` | 每 5 分钟 |
| `'30 9 * * mon-fri'` | 周一至周五的 09:30 |
| `'0 0 1 * *'` | 每月 1 日零点 |

**夏令时。** 在会调整时钟的时区中，春季被跳过的时刻（例如纽约 2026 年 3 月 8 日的 02:30）当天不会执行，秋季重复出现的时刻只执行一次。

**写错时。** 间隔或 cron 表达式不合法会抛出 `SyntaxError`，时区不存在会抛出 `RangeError`。这些错误在定义控制器类时便会抛出，此时应用尚未启动。没有任何日期能够匹配的表达式（例如 2 月 30 日，`'0 0 30 2 *'`）同样会抛出 `SyntaxError`，因为这样的任务永远不会执行。

## 3. 什么时候执行

- **间隔：** 启动后经过一个间隔首次执行，之后每隔一个间隔执行一次。
- **cron：** 每次都安排在下一个与表达式匹配的时间。
- **错过的执行**会被跳过，不会补执行；进程曾被挂起（例如笔记本休眠）后，任务在下一个计划时间执行。
- **重叠：** 默认情况下，上一次仍在执行时，本次执行会被跳过。设置 `overlap: true` 后，同一个任务的多次执行可以同时运行。
- **`immediate: true`** 会在应用启动完成后立即额外执行一次。

## 4. 只在一个实例中执行

应用常常同时运行多个实例（多个容器、多台服务器）。声明了 `exclusive: true` 的任务在同一时间只会在其中一个实例中执行：

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

- 应用需要一个由各实例共用的互斥锁组件，默认名称为 `mutex`，也可以通过 `exclusive.mutex` 指定（见[互斥锁](Mutex.md)第 4 节）。缺少该组件时，任务不会执行，错误将写入日志。
- 每次执行前先尝试获取锁 `schedule:<key>`，key 默认为动作名，也可以通过 `exclusive.key` 指定。未获得锁的实例跳过本次执行。
- 独占任务的间隔按时钟对齐（每 5 分钟即为 :00、:05、:10……），使所有实例安排的时间相同。
- 执行结束后，锁会保留至计划时间之后半个周期（最多 30 秒），因此即使某个实例的时钟稍慢，也不会将任务再执行一遍。

## 5. 执行过程中

每次执行都如同处理一个请求，在其自身的作用域中获得一个新的控制器，并经过入口的中间件和访问控制。方法不会收到输入，返回值也会被忽略。

`this.context` 是一个 `ScheduleContext`：

| 属性 | 含义 |
|---|---|
| `schedule` | 计划的文字形式：`'every 30s'`、`'cron 0 3 * * *'` |
| `scheduledAt` | 本次执行的计划时间（`Date`）；实际开始时间可能晚几毫秒 |
| `run` | 本次执行在本进程中的序号，从 1 开始（被跳过的执行不计入） |

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

某一次执行抛出错误不会影响该任务，后续的执行照常进行。默认情况下，错误由应用的日志组件（`log`）记录，没有日志组件时写入控制台。适配器的选项可以替换这一行为：

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

应用停止时，不再开始新的执行，独占任务会释放其持有的锁。正在执行的任务可在入口的 `shutdownTimeout`（默认 30 秒）内完成，超时后将被中止，此时 `this.signal` 会被触发，耗时较长的任务可以检查该信号并提前结束。

## 8. 计算下一次的时间

`lakutata/com/entrypoint` 中的 `Cron` 和 `parseDuration` 即为定时任务使用的解析器：

```typescript
import {Cron, parseDuration} from 'lakutata/com/entrypoint'

const cron: Cron = new Cron('30 9 * * mon-fri', 'Asia/Shanghai')
//给定时间之后的下一个时间（精确到秒），永远不匹配时为 undefined
console.log(cron.next(new Date('2026-10-16T12:00:00Z'))) //2026-10-19T01:30:00.000Z，即上海时间周一 09:30
console.log(parseDuration('1h30m')) //5400000
```

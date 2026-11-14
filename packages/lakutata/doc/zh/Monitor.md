# Lakutata 监控

`lakutata/com/monitor` 中的监控器用于测量应用所在进程的 CPU 使用率、内存、事件循环延迟以及 HTTP 请求耗时。每个监控器都是一个组件，以固定大小的内存保存自创建（或自上次 `reset()`）以来各次测量的统计数据。除 `lakutata` 外，无需安装其他包。

## 1. 声明和读取监控器

```typescript
import {Application, type ILogger} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {CpuMonitor, EventLoopMonitor, HttpRequestMonitor, MemoryMonitor} from 'lakutata/com/monitor'

class MetricsController extends Controller {
    @Inject('cpu')
    protected readonly cpu: CpuMonitor

    @Inject('memory')
    protected readonly memory: MemoryMonitor

    @Inject('eventLoop')
    protected readonly eventLoop: EventLoopMonitor

    @Inject('httpRequests')
    protected readonly httpRequests: HttpRequestMonitor

    @GET('/metrics')
    public async metrics(): Promise<Record<string, unknown>> {
        return {
            cpu: this.cpu.statistics,
            memory: this.memory.statistics,
            eventLoop: this.eventLoop.statistics,
            httpRequests: this.httpRequests.statistics
        }
    }
}

Application
    .run(() => ({
        id: 'api.app',
        name: 'API',
        components: {
            cpu: {class: CpuMonitor},
            memory: {class: MemoryMonitor},
            eventLoop: {class: EventLoopMonitor},
            httpRequests: {class: HttpRequestMonitor},
            entrypoint: buildEntrypoints({
                controllers: [MetricsController],
                http: expressHTTPEntrypoint({port: 8080})
            })
        },
        //在应用启动时创建，从一开始就测量
        bootstrap: ['cpu', 'memory', 'eventLoop', 'httpRequests', 'entrypoint']
    }))
    .onLaunched(async (app: Application, log: ILogger): Promise<void> => {
        const cpu: CpuMonitor = await app.getObject<CpuMonitor>('cpu')
        const eventLoop: EventLoopMonitor = await app.getObject<EventLoopMonitor>('eventLoop')
        //每分钟记录这一分钟的统计，然后开始新的一段（/metrics 也随之从零开始）
        setInterval((): void => {
            log.info({cpuAvg: cpu.statistics.usageAvg, eventLoopMax: eventLoop.statistics.max}, 'the last minute')
            cpu.reset()
            eventLoop.reset()
        }, 60000)
    })
```

- 使用 `class` 声明所需的每个监控器，名称可自行选择。监控器是单例，因此注入同一监控器的所有对象共享同一份统计数据。
- 监控器从创建时开始测量，因此应将其列在 `bootstrap` 中。否则，监控器在首次被使用时才会创建，并从那时开始测量。
- 监控器没有选项。为监控器指定的选项会被忽略，应用启动时会给出警告。
- 每次读取 `statistics` 时都会重新计算。`reset()` 开始一个新的统计周期，此后的统计数据只包含重置之后的测量。
- 监控器的定时器不会使进程保持运行；应用停止时，监控器也随之停止。

## 2. 测量什么

| 监控器 | 测量 | 采样 | 单位 |
|---|---|---|---|
| `CpuMonitor` | 进程的 CPU 时间 | 每秒一次 | 单个核心的百分比 |
| `MemoryMonitor` | 进程的内存：常驻内存、堆、外部内存 | 创建时一次，之后每秒一次 | 字节 |
| `EventLoopMonitor` | 事件循环的延迟，以及事件循环处于忙碌状态的时间占比 | 持续 | 毫秒、百分比 |
| `HttpRequestMonitor` | 进程所响应的 HTTP 请求的耗时 | 每个请求 | 毫秒 |

CPU、内存和 HTTP 请求的统计数据包含最新值、最小值、最大值和平均值（均为精确值），以及保留三位有效数字的百分位数（P50、P90、P95、P99）。在首次测量之前，CPU 和 HTTP 请求的统计数据均为 0。

## 3. `CpuMonitor`

| 字段 | 含义 |
|---|---|
| `usage` | 最新一次采样 |
| `usageMin`、`usageMax`、`usageAvg` | 各次采样的最小值、最大值和平均值 |
| `usageP50`、`usageP90`、`usageP95`、`usageP99` | 各次采样的百分位数 |

- 使用率等于整个进程的 CPU 时间（用户态和内核态，包括所有线程）除以经过的时间，以单个核心的百分比表示。100 表示一个核心被完全占满；使用多个核心的进程（worker 线程、Node.js 线程池）会超过 100。数值保留 5 位小数。
- 首次采样在监控器创建一秒后进行。
- 事件循环被阻塞时，下一次采样会推迟，并覆盖整个阻塞时间。该次采样按其覆盖的秒数计入统计，因此平均值和百分位数会按时长对忙碌时段加权。

## 4. `MemoryMonitor`

| 字段 | 含义 |
|---|---|
| `physicalTotal` | 机器的内存总量（`os.totalmem()`），而非容器的内存限制 |
| `physicalUsed`、`physicalUsage` | 进程的常驻内存（`rss`），以及其占 `physicalTotal` 的百分比 |
| `heapTotal`、`heapUsed`、`heapUsage` | V8 的堆和其中已使用的部分，以及两者之比（百分比） |
| `externalUsed` | 绑定到 JavaScript 对象的 C++ 对象所占用的内存，包括 `Buffer` |
| `physicalUsedMin`、`…Max`、`…Avg`、`…P50`、`…P90`、`…P95`、`…P99` | `physicalUsed` 的统计 |
| `heapUsedMin`、`…Max`、`…Avg`、`…P50`、`…P90`、`…P95`、`…P99` | `heapUsed` 的统计 |
| `externalUsedMin`、`…Max`、`…Avg`、`…P50`、`…P90`、`…P95`、`…P99` | `externalUsed` 的统计 |

- 数值以字节为单位；平均值和两个百分比保留 2 位小数。
- `heapUsage` 比较的是已使用的堆与目前已分配的堆，而非堆的上限，因此该值偏高本身并不说明存在问题。内存泄漏的表现是 `heapUsedMin` 在一个又一个统计周期中逐步升高。
- `reset()` 保留最新值（`physicalUsed`、`heapUsed`……），其他统计数据重新开始计算。

## 5. `EventLoopMonitor`

| 字段 | 含义 |
|---|---|
| `min`、`max`、`avg`、`stdDev` | 延迟的最小值、最大值、平均值和标准差 |
| `p50`、`p90`、`p95`、`p99` | 延迟的百分位数 |
| `utilRate` | 事件循环忙碌的时间占比，单位为百分比 |

- 延迟是指一个 1 毫秒定时器两次运行之间的间隔。事件循环空闲时，延迟约为 1 毫秒；同步工作（耗时的计算、同步 I/O、大型 JSON）占用事件循环时，延迟会变长。`max` 即最长的一次阻塞。
- `utilRate` 覆盖自监控器创建或上次 `reset()` 以来的整个时段；该值接近 100 时，表示事件循环已没有空闲时间。刚调用 `reset()` 之后，该值为 100，因为事件循环正忙于运行发起该调用的代码。
- 这些数值来自 Node.js 的直方图（`monitorEventLoopDelay`），不做舍入，并且均为近似值，最小值、最大值和平均值也不例外。
- 应用空闲时，1 毫秒定时器约占用单个核心的 1.5 %。因此在电池供电的设备上，请仅在需要时声明该监控器。

## 6. `HttpRequestMonitor`

| 字段 | 含义 |
|---|---|
| `count` | 已响应的请求数 |
| `min`、`max`、`avg`、`stdDev` | 请求耗时的最小值、最大值、平均值和标准差 |
| `p50`、`p90`、`p95`、`p99` | 请求耗时的百分位数 |

- 该监控器统计进程中所有 HTTP 服务器所响应的请求（HTTP 适配器、HTTP 服务、基于 HTTP 的 JSON-RPC、Socket.IO 服务器、自定义服务器），包括出错的请求和 HTTPS 请求。HTTP/2 请求、进程自身发出的请求，以及从未得到响应的请求，均不计入统计。
- 统计数据不按路由或状态码细分。
- 该监控器只统计在其创建之后开始的请求，创建时正在处理的请求不计入。在动作中读取时，统计数据不包含当前正在响应的请求。
- 耗时以毫秒为单位，保留 2 位小数。

## 7. worker 线程

在 worker 线程中声明的监控器测量以下内容：

- 该线程自身事件循环的延迟和忙碌时间（`EventLoopMonitor`）；
- 该线程自身的 HTTP 服务器所处理的请求（`HttpRequestMonitor`）；
- 整个进程的 CPU 和常驻内存（`CpuMonitor`、`MemoryMonitor` 的 `physicalUsed`），但堆仅为该线程自身的堆（`heapUsed`）。

# Lakutata 监控

`lakutata/com/monitor` 中的监控器测量应用所在的进程：CPU 使用率、内存、事件循环的延迟，以及 HTTP 请求的耗时。每个监控器都是一个组件，在固定大小的内存中保存它自创建以来（或者自上次 `reset()` 以来）各次测量的统计。除了 `lakutata`，不需要安装其他包。

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

- 用 `class` 声明需要的每个监控器，名字自己选。监控器是单例，注入它的所有对象共用同一份统计。
- 监控器从创建时开始测量：要把它列在 `bootstrap` 里。否则它在第一次被用到时才创建，从那时起才开始测量。
- 监控器没有选项。给它的选项会被忽略，并在应用启动时给出警告。
- 每次读取 `statistics` 时都会重新计算。`reset()` 开始新的一段：之后的统计只包含此后的测量。
- 监控器的定时器不会让进程保持运行；应用停止时监控器也随之停止。

## 2. 测量什么

| 监控器 | 测量 | 采样 | 单位 |
|---|---|---|---|
| `CpuMonitor` | 进程的 CPU 时间 | 每秒一次 | 单个核心的百分比 |
| `MemoryMonitor` | 进程的内存：常驻内存、堆、外部内存 | 创建时一次，之后每秒一次 | 字节 |
| `EventLoopMonitor` | 事件循环的延迟，以及它忙碌的时间占比 | 持续 | 毫秒、百分比 |
| `HttpRequestMonitor` | 进程响应的 HTTP 请求的耗时 | 每个请求 | 毫秒 |

CPU、内存和 HTTP 请求的统计包含最新值、最小值、最大值和平均值，这些都是精确值；另外还有三位有效数字的百分位数（P50、P90、P95、P99）。CPU 和 HTTP 请求的统计在第一次测量之前全都是 0。

## 3. `CpuMonitor`

| 字段 | 含义 |
|---|---|
| `usage` | 最新一次采样 |
| `usageMin`、`usageMax`、`usageAvg` | 各次采样的最小值、最大值和平均值 |
| `usageP50`、`usageP90`、`usageP95`、`usageP99` | 各次采样的百分位数 |

- 使用率是整个进程的 CPU 时间（用户态和内核态，包括所有线程）除以经过的时间，以单个核心的百分比表示：100 表示一个核心完全占满，使用多个核心的进程（worker 线程、Node.js 的线程池）会超过 100。数值保留 5 位小数。
- 第一次采样在监控器创建一秒后进行。
- 事件循环被阻塞时，下一次采样会延迟，并覆盖整个阻塞的时间。这次采样按它覆盖的秒数计入，所以平均值和百分位数按时长反映忙碌的时段。

## 4. `MemoryMonitor`

| 字段 | 含义 |
|---|---|
| `physicalTotal` | 机器的内存（`os.totalmem()`），不是容器的内存限制 |
| `physicalUsed`、`physicalUsage` | 进程的常驻内存（`rss`），以及它占 `physicalTotal` 的百分比 |
| `heapTotal`、`heapUsed`、`heapUsage` | V8 的堆和其中已使用的部分，以及两者之比（百分比） |
| `externalUsed` | 绑定到 JavaScript 对象上的 C++ 对象占用的内存，包括 `Buffer` |
| `physicalUsedMin`、`…Max`、`…Avg`、`…P50`、`…P90`、`…P95`、`…P99` | `physicalUsed` 的统计 |
| `heapUsedMin`、`…Max`、`…Avg`、`…P50`、`…P90`、`…P95`、`…P99` | `heapUsed` 的统计 |
| `externalUsedMin`、`…Max`、`…Avg`、`…P50`、`…P90`、`…P95`、`…P99` | `externalUsed` 的统计 |

- 数值的单位是字节；平均值和两个百分比保留 2 位小数。
- `heapUsage` 比较的是已使用的堆和目前已分配的堆，而不是堆的上限：这个值高本身不说明有问题。内存泄漏的表现是 `heapUsedMin` 一段比一段高。
- `reset()` 保留最新值（`physicalUsed`、`heapUsed`……）；其他统计重新开始。

## 5. `EventLoopMonitor`

| 字段 | 含义 |
|---|---|
| `min`、`max`、`avg`、`stdDev` | 延迟的最小值、最大值、平均值和标准差 |
| `p50`、`p90`、`p95`、`p99` | 延迟的百分位数 |
| `utilRate` | 事件循环忙碌的时间占比，单位为百分比 |

- 延迟是一个 1 毫秒定时器两次运行之间的间隔：事件循环空闲时大约是 1 毫秒；同步的工作（耗时的计算、同步 I/O、很大的 JSON）占住事件循环时会变长。`max` 就是最长的一次阻塞。
- `utilRate` 覆盖自创建或上次 `reset()` 以来的整段时间：接近 100 时，事件循环已经没有空闲时间。刚调用 `reset()` 之后它是 100，因为事件循环正忙于运行调用它的代码。
- 这些数值来自 Node.js 的直方图（`monitorEventLoopDelay`）：不做舍入，并且都是近似值，最小值、最大值和平均值也一样。
- 在应用空闲时，1 毫秒的定时器大约占用单个核心的 1.5 %：在用电池供电的设备上，只在需要时才声明这个监控器。

## 6. `HttpRequestMonitor`

| 字段 | 含义 |
|---|---|
| `count` | 已响应的请求数 |
| `min`、`max`、`avg`、`stdDev` | 请求耗时的最小值、最大值、平均值和标准差 |
| `p50`、`p90`、`p95`、`p99` | 请求耗时的百分位数 |

- 它统计进程中所有 HTTP 服务器响应的请求（HTTP 适配器、HTTP 服务、基于 HTTP 的 JSON-RPC、Socket.IO 的服务器、你自己的服务器），包括出错的请求，也包括 HTTPS。它不统计 HTTP/2 的请求、进程自己发出的请求，以及从未得到响应的请求。
- 它不按路由或状态码细分。
- 它只统计在它创建之后开始的请求：创建时正在处理的请求不计入。在动作中读取时，统计不包含正在响应的这个请求。
- 耗时的单位是毫秒，保留 2 位小数。

## 7. worker 线程

在 worker 线程中声明的监控器测量的是：

- 它自己的事件循环的延迟和忙碌时间（`EventLoopMonitor`）；
- 它自己的 HTTP 服务器的请求（`HttpRequestMonitor`）；
- 整个进程的 CPU 和常驻内存（`CpuMonitor`、`MemoryMonitor` 的 `physicalUsed`），但堆是它自己的（`heapUsed`）。

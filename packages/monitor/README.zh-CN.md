# @lakutata/monitor

[English](README.md) | 中文

lakutata 框架的监控器。它们是一组组件，测量进程的 CPU 使用率、内存、事件循环的延迟和忙碌的时间占比，以及进程收到的 HTTP 请求的耗时；统计使用 Node.js 的直方图，占用的内存大小固定。每个监控器都提供 `statistics` getter，给出自创建或上次 `reset()` 以来的最新值、最小值、最大值、平均值和百分位数。`lakutata` 包把这个包重新导出为 `lakutata/com/monitor`。

## 安装

```shell
npm install lakutata
```

它没有可选依赖：测量数据来自 `node:process`、`node:os` 和 `node:perf_hooks`。

## 用法

在应用的 `components` 中注册监控器，并把它们列在 `bootstrap` 中，因为监控器从创建时才开始测量。之后用 `getObject()` 或 `@Inject` 获取它们，读取 `statistics`；监控器都是单例。

```typescript
import {Application} from 'lakutata'
import {
    CpuMonitor,
    EventLoopMonitor,
    HttpRequestMonitor,
    MemoryMonitor,
    type ICpuMonitorStatistics,
    type IEventLoopMonitorStatistics,
    type IHttpRequestMonitorStatistics,
    type IMemoryMonitorStatistics
} from 'lakutata/com/monitor'

Application
    .run(() => ({
        id: 'monitor.app',
        name: 'Monitor',
        components: {
            cpu: {class: CpuMonitor},
            memory: {class: MemoryMonitor},
            eventLoop: {class: EventLoopMonitor},
            httpRequests: {class: HttpRequestMonitor}
        },
        bootstrap: ['cpu', 'memory', 'eventLoop', 'httpRequests']
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const cpu: CpuMonitor = await app.getObject('cpu')
        const memory: MemoryMonitor = await app.getObject('memory')
        const eventLoop: EventLoopMonitor = await app.getObject('eventLoop')
        const httpRequests: HttpRequestMonitor = await app.getObject('httpRequests')
        //每分钟报告一次，每次只包含最近这一分钟；这个定时器让进程保持运行（监控器的定时器不会）
        setInterval((): void => {
            const cpuStatistics: ICpuMonitorStatistics = cpu.statistics
            const memoryStatistics: IMemoryMonitorStatistics = memory.statistics
            const loopStatistics: IEventLoopMonitorStatistics = eventLoop.statistics
            const httpStatistics: IHttpRequestMonitorStatistics = httpRequests.statistics
            console.log({
                cpuPercent: cpuStatistics.usageAvg,
                rssBytes: memoryStatistics.physicalUsed,
                heapPercent: memoryStatistics.heapUsage,
                loopDelayP99Ms: loopStatistics.p99,
                loopBusyPercent: loopStatistics.utilRate,
                requests: httpStatistics.count,
                requestP95Ms: httpStatistics.p95
            })
            for (const monitor of [cpu, memory, eventLoop, httpRequests]) monitor.reset()
        }, 60000)
    })
```

| 监控器 | 测量内容 | 单位 | 采样 | 保留位数 |
|---|---|---|---|---|
| `CpuMonitor` | 进程每一秒的用户态加内核态 CPU 时间 | 单个核心的百分比（使用多个核心时超过 100） | 每秒一次，第一次采样在创建 1 秒后 | 5 位小数 |
| `MemoryMonitor` | `process.memoryUsage()`：常驻内存、V8 堆、外部内存；主机的总内存 | 字节（`*Usage` 字段为百分比） | 创建时一次，之后每秒一次 | 平均值和百分比保留 2 位小数 |
| `EventLoopMonitor` | 事件循环中一个 1 毫秒定时器两次运行之间的间隔（事件循环空闲时大约 1 毫秒）；事件循环忙碌的时间占比 | 毫秒；百分比 | 持续（Node.js 的 `monitorEventLoopDelay`，精度 1 毫秒） | 不舍入 |
| `HttpRequestMonitor` | `node:http` 服务器（Express、Fastify）收到的每个请求的耗时，从请求到达起，到响应结束为止 | 毫秒；请求数 | 每个请求，在响应结束后不久成批计入 | 2 位小数 |

- **读取统计**：每次读取 getter 都会重新计算。最小值、最大值、平均值和百分位数覆盖监控器创建或重置以来的所有采样：每次报告后调用 `reset()`，就能一段一段地测量。百分位数来自直方图（三位有效数字）。最小值、最大值和平均值是精确值，`EventLoopMonitor` 除外：它的这几个值和百分位数一样来自 Node.js 的直方图，是近似值。
- **事件循环被阻塞时**：下一次 CPU 采样会延迟，并覆盖整个阻塞的时间。这次采样覆盖了几秒，就计入几次，所以平均值和百分位数会按时长给忙碌的时段加权。
- **第一次采样之前**：CPU 的统计在第一秒内都是 0，HTTP 的统计在第一个请求结束之前都是 0。在事件循环出现空闲之前，它的 `utilRate` 一直是 100，刚调用 `reset()` 之后也是这样。
- **生命周期**：监控器的定时器不会让进程保持运行；应用销毁时，监控器随之停止。
- **范围**：监控器只测量当前进程：在集群中或有多个实例时，每个进程有各自的监控器。`physicalTotal` 是主机的内存，不是容器的内存限制。进程自己发出的请求和 HTTP/2 请求不计入。

## API

| 导出 | 说明 |
|---|---|
| `CpuMonitor` | CPU 使用率组件：`statistics`、`reset()` |
| `MemoryMonitor` | 内存组件：`statistics`、`reset()` |
| `EventLoopMonitor` | 事件循环组件：`statistics`、`reset()` |
| `HttpRequestMonitor` | HTTP 请求组件（进程收到的请求）：`statistics`、`reset()` |
| `ICpuMonitorStatistics` | `usage` 和 `usageMin`/`Max`/`Avg`/`P50`/`P90`/`P95`/`P99`，单位为单个核心的百分比 |
| `IMemoryMonitorStatistics` | `physical*`（常驻内存）、`heap*`（V8 堆）、`external*`，单位为字节，另有以百分比表示的 `physicalUsage` 和 `heapUsage` |
| `IEventLoopMonitorStatistics` | 以毫秒为单位的 `min`、`max`、`avg`、`stdDev`、`p50`、`p90`、`p95`、`p99`，以及以百分比表示的 `utilRate` |
| `IHttpRequestMonitorStatistics` | `count`，以及以毫秒为单位的 `min`、`max`、`avg`、`stdDev`、`p50`、`p90`、`p95`、`p99` |
| `IMonitor` | 监控器的接口：一个 `statistics` 属性 |

以上全部由 `lakutata/com/monitor` 和 `@lakutata/monitor` 导出。类型声明中的每一项都附有说明和示例。

## 错误

监控器没有自己的异常：读取 `statistics` 和调用 `reset()` 都不会失败。监控器没有的选项会被忽略，并在应用启动时给出警告。

## 另见

- 网站上的指南：[监控](https://lakutata.com/zh/guide/Monitor)。
- `lakutata` 包中的 `doc/zh/Monitor.md`：监控指南。
- 同一位置的 `doc/zh/Application.md`：组件和 bootstrap 步骤。
- `@lakutata/core`（`lakutata`）：组件、`Application` 和依赖注入。
- `@lakutata/logger`（`lakutata/com/logger`）：日志记录器，用来写出报告。

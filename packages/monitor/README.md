# @lakutata/monitor

English | [中文](README.zh-CN.md)

The monitors of the Lakutata framework: components that measure the process's CPU usage, memory, event loop delay and
utilization, and the duration of the HTTP requests it receives, using Node.js histograms in constant memory. Each one
exposes a `statistics` getter (the latest value, minimum, maximum, mean and percentiles since it was created or last
`reset()`). The umbrella package `lakutata` re-exports this package as `lakutata/com/monitor`.

## Installation

```shell
npm install lakutata
```

It has no optional dependencies: the measurements come from `node:process`, `node:os` and `node:perf_hooks`.

## Usage

Register the monitors in the application's `components` and list them in `bootstrap`, because a monitor starts measuring
when it is created. Then obtain them with `getObject()` or `@Inject` and read their `statistics`; they are singletons.

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
        //A report every minute, each covering the last minute; this timer keeps the process running (the timers of
        //the monitors do not)
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

| Monitor | Measures | Unit | Sampling | Rounded to |
|---|---|---|---|---|
| `CpuMonitor` | The process's user plus system CPU time over each second | percent of one core (above 100 with several cores) | every second, first sample 1 s after creation | 5 decimals |
| `MemoryMonitor` | `process.memoryUsage()`: resident set, V8 heap, external memory; the host's total memory | bytes (the `*Usage` fields in percent) | at creation, then every second | 2 decimals for the means and percentages |
| `EventLoopMonitor` | The interval between runs of a 1 ms timer on the event loop (about 1 ms when the loop is idle); the share of time the loop is busy | milliseconds; percent | continuously (Node's `monitorEventLoopDelay`, 1 ms resolution) | not rounded |
| `HttpRequestMonitor` | The duration of each request received by a `node:http` server (Express, Fastify), from its arrival to the end of its response | milliseconds; a count | each request, delivered in batches shortly after its response | 2 decimals |

- **Reading the statistics**: the getter computes them again on each read. The minimum, maximum, mean and percentiles
  cover every sample since the monitor was created or reset: call `reset()` after each report to measure one period at
  a time. The percentiles come from histograms (3 significant digits). The minimum, maximum and mean are exact, except
  those of `EventLoopMonitor`, which come from the Node.js histogram like its percentiles and are approximate.
- **A blocked event loop**: the next CPU sample is late and covers the whole time the loop was blocked. It counts once
  per second it covers, so that the mean and the percentiles weight busy periods by their duration.
- **Before the first sample**: the CPU statistics are 0 for the first second, and the HTTP statistics until a request
  ends. The event loop's `utilRate` reads 100 until the loop has been idle, as right after a `reset()`.
- **Lifecycle**: the timers of the monitors do not keep the process alive, and the monitors stop when the application
  stops.
- **Scope**: the monitors measure only the current process; in a cluster or with several instances, each process has its
  own. `physicalTotal` is the host's memory, not a container's limit. Requests that the process sends, and HTTP/2
  requests, are not counted.

## API

| Export | What it is |
|---|---|
| `CpuMonitor` | The CPU usage component: `statistics`, `reset()` |
| `MemoryMonitor` | The memory component: `statistics`, `reset()` |
| `EventLoopMonitor` | The event loop component: `statistics`, `reset()` |
| `HttpRequestMonitor` | The component for received HTTP requests: `statistics`, `reset()` |
| `ICpuMonitorStatistics` | `usage` and `usageMin`/`Max`/`Avg`/`P50`/`P90`/`P95`/`P99`, in percent of one core |
| `IMemoryMonitorStatistics` | `physical*` (resident set), `heap*` (V8 heap), `external*`, in bytes, plus `physicalUsage` and `heapUsage` in percent |
| `IEventLoopMonitorStatistics` | `min`, `max`, `avg`, `stdDev`, `p50`, `p90`, `p95`, `p99` in milliseconds, `utilRate` in percent |
| `IHttpRequestMonitorStatistics` | `count`, then `min`, `max`, `avg`, `stdDev`, `p50`, `p90`, `p95`, `p99` in milliseconds |
| `IMonitor` | The monitor interface: a `statistics` property |

All of them are exported by `lakutata/com/monitor` and `@lakutata/monitor`. The typings document each declaration with
examples.

## Errors

The monitors throw no package-specific exceptions: reading `statistics` and calling `reset()` never fail. An option that
a monitor does not have is ignored, with a warning when the application launches.

## See also

- The guide on the website: [Monitors](https://lakutata.com/guide/Monitor).
- `doc/en/Monitor.md` in the `lakutata` package (Chinese in `doc/zh`): the monitors guide.
- `doc/en/Application.md` in the same place: components and the bootstrap.
- `@lakutata/core` (`lakutata`): components, `Application` and dependency injection.
- `@lakutata/logger` (`lakutata/com/logger`): the logger, for writing the reports.

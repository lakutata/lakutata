# @lakutata/monitor

The monitors of the lakutata framework: components measuring the process's CPU usage, memory, event loop delay and
utilization, and the durations of the HTTP requests it receives, on the histograms of Node.js, in constant memory. Each
exposes a `statistics` getter (the latest value, minimum, maximum, mean and percentiles since its creation or its last
`reset()`). The umbrella package `lakutata` re-exports it as `lakutata/com/monitor`.

## Installation

```shell
npm install lakutata
```

It has no optional dependencies: the measures come from `node:process`, `node:os` and `node:perf_hooks`.

## Usage

Register the monitors in the `components` of the application and list them in `bootstrap`: a monitor starts measuring
when it is created. Then read their `statistics` with `getObject()` or `@Inject`; they are singletons.

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
        //A report every minute, each covering the last minute
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
        }, 60000).unref()
    })
```

| Monitor | Measures | Unit | Sampling | Rounded to |
|---|---|---|---|---|
| `CpuMonitor` | User plus system CPU time of the process over each second | percent of one core (above 100 with several cores) | every second, first sample 1 s after creation | 5 decimals |
| `MemoryMonitor` | `process.memoryUsage()`: resident set, V8 heap, external memory; the host's total memory | bytes (the `*Usage` fields in percent) | at creation, then every second | 2 decimals for the means and percentages |
| `EventLoopMonitor` | How late the main event loop runs a 1 ms timer; the share of time it is busy | milliseconds; percent | continuously (Node's `monitorEventLoopDelay`, 1 ms resolution) | not rounded |
| `HttpRequestMonitor` | The duration of each request received by a `node:http` server (Express, Fastify), from its arrival to the end of its response | milliseconds; a count | each request, delivered in batches shortly after its response | 2 decimals |

- **Reading the statistics**: every getter call computes them anew. The minimum, maximum, mean and percentiles cover
  every sample since the monitor was created or reset: call `reset()` after each report to read a period. The
  percentiles come from histograms (3 significant digits); the minimum, maximum and mean are exact.
- **Before the first sample**: the statistics are 0 (the CPU monitor's for its first second, the HTTP monitor's until a
  request ends).
- **Lifecycle**: the timers do not keep the process alive; the monitors stop when the application is destroyed.
- **Scope**: the monitors measure the current process only: under a cluster or several instances, each has its own.
  `physicalTotal` is the host's memory, not a container's limit. The requests the process sends, and HTTP/2 requests,
  are not counted.

## API

| Export | What it is |
|---|---|
| `CpuMonitor` | The CPU usage component: `statistics`, `reset()` |
| `MemoryMonitor` | The memory component: `statistics`, `reset()` |
| `EventLoopMonitor` | The event loop component: `statistics`, `reset()` |
| `HttpRequestMonitor` | The received HTTP requests component: `statistics`, `reset()` |
| `ICpuMonitorStatistics` | `usage` and `usageMin`/`Max`/`Avg`/`P50`/`P90`/`P95`/`P99`, in percent of one core |
| `IMemoryMonitorStatistics` | `physical*` (resident set), `heap*` (V8 heap), `external*`, in bytes, plus `physicalUsage` and `heapUsage` in percent |
| `IEventLoopMonitorStatistics` | `min`, `max`, `avg`, `stdDev`, `p50`, `p90`, `p95`, `p99` in milliseconds, `utilRate` in percent |
| `IHttpRequestMonitorStatistics` | `count`, then `min`, `max`, `avg`, `stdDev`, `p50`, `p90`, `p95`, `p99` in milliseconds |
| `IMonitor` | The interface of the monitors: a `statistics` property |

All are exported by `lakutata/com/monitor` and `@lakutata/monitor`. The typings document each declaration with
examples.

## Errors

The monitors throw no exception of their own: reading `statistics` and calling `reset()` never fail. Declaring a
monitor with options it does not have is warned of when the application starts.

## See also

- `doc/en/Application.md` of the package `lakutata` (Chinese in `doc/zh`): the components and the bootstrap.
- `@lakutata/core` (`lakutata`): the components, `Application` and the dependency injection.
- `@lakutata/logger` (`lakutata/com/logger`): the logger, to write the reports.

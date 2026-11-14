# Lakutata Monitors

The `lakutata/com/monitor` monitors measure the process an application runs in: its CPU usage, its memory, its event
loop delays, and the time its HTTP requests take. Each one is a component that keeps statistics of its measurements
since it was created, or since its last `reset()`, in constant memory. They need nothing beyond `lakutata`.

## 1. Declaring and reading the monitors

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
        //Created when the application launches, so that they measure from the start
        bootstrap: ['cpu', 'memory', 'eventLoop', 'httpRequests', 'entrypoint']
    }))
    .onLaunched(async (app: Application, log: ILogger): Promise<void> => {
        const cpu: CpuMonitor = await app.getObject<CpuMonitor>('cpu')
        const eventLoop: EventLoopMonitor = await app.getObject<EventLoopMonitor>('eventLoop')
        //Every minute, the statistics of the minute, then a new period (/metrics starts over with it)
        setInterval((): void => {
            log.info({cpuAvg: cpu.statistics.usageAvg, eventLoopMax: eventLoop.statistics.max}, 'the last minute')
            cpu.reset()
            eventLoop.reset()
        }, 60000)
    })
```

- Declare each monitor you need with its `class`, under the name of your choice. A monitor is a singleton, so every
  object that injects it shares its statistics.
- A monitor measures from its creation: list it in `bootstrap`. Otherwise it is created the first time it is used, and
  measures from then on.
- Monitors have no options. An option specified for one is ignored, with a warning when the application launches.
- `statistics` is computed on each read. `reset()` starts a new period: the statistics then cover the measurements taken
  since.
- Their timers do not keep the process alive, and they stop when the application stops.

## 2. What they measure

| Monitor | Measures | Sampled | Unit |
|---|---|---|---|
| `CpuMonitor` | The process's CPU time | Every second | Percent of one core |
| `MemoryMonitor` | The process's memory: resident, heap, external | At its creation, then every second | Bytes |
| `EventLoopMonitor` | Event loop delays, and the share of time the event loop is busy | Continuously | Milliseconds, percent |
| `HttpRequestMonitor` | The duration of HTTP requests the process responds to | Each request | Milliseconds |

CPU, memory and HTTP request statistics hold the latest value, the minimum, the maximum and the mean, which are exact,
and percentiles (P50, P90, P95, P99) with 3 significant digits. CPU and HTTP request statistics are all 0 before their
first measurement.

## 3. `CpuMonitor`

| Field | Meaning |
|---|---|
| `usage` | The latest sample |
| `usageMin`, `usageMax`, `usageAvg` | Minimum, maximum and mean of the samples |
| `usageP50`, `usageP90`, `usageP95`, `usageP99` | Sample percentiles |

- Usage is the whole process's CPU time (user and system, every thread) over the elapsed time, in percent of one core:
  100 is one fully busy core, and a process using several cores (worker threads, the Node.js thread pool) goes
  above 100. Values are rounded to 5 decimals.
- The first sample is taken one second after the monitor is created.
- When the event loop is blocked, the next sample comes late and covers the whole blocked time. It then counts once per
  second it covers, so that the mean and the percentiles weight busy periods by their duration.

## 4. `MemoryMonitor`

| Fields | Meaning |
|---|---|
| `physicalTotal` | The machine's memory (`os.totalmem()`), not a container's limit |
| `physicalUsed`, `physicalUsage` | The process's resident memory (`rss`), and its percentage of `physicalTotal` |
| `heapTotal`, `heapUsed`, `heapUsage` | V8's heap and its used part, and their ratio in percent |
| `externalUsed` | Memory of C++ objects bound to JavaScript objects, including `Buffer`s |
| `physicalUsedMin`, `…Max`, `…Avg`, `…P50`, `…P90`, `…P95`, `…P99` | The statistics of `physicalUsed` |
| `heapUsedMin`, `…Max`, `…Avg`, `…P50`, `…P90`, `…P95`, `…P99` | The statistics of `heapUsed` |
| `externalUsedMin`, `…Max`, `…Avg`, `…P50`, `…P90`, `…P95`, `…P99` | The statistics of `externalUsed` |

- Values are in bytes; means and the two percentages are rounded to 2 decimals.
- `heapUsage` compares the used heap with the heap allocated so far, not with its limit: a high value alone is not a
  problem. A leak shows as a `heapUsedMin` that rises from one period to the next.
- `reset()` keeps the latest values (`physicalUsed`, `heapUsed`…); the other statistics start again.

## 5. `EventLoopMonitor`

| Field | Meaning |
|---|---|
| `min`, `max`, `avg`, `stdDev` | Minimum, maximum, mean and standard deviation of the delays |
| `p50`, `p90`, `p95`, `p99` | Delay percentiles |
| `utilRate` | The share of time the event loop was busy, in percent |

- The delay is the interval between runs of a 1 ms timer: about 1 ms when the event loop is idle, more when synchronous
  work (a long computation, synchronous I/O, a large JSON) holds it. `max` is the longest block.
- `utilRate` covers the whole period since the monitor's creation or its last `reset()`: near 100, the event loop has
  no idle time left. Right after a `reset()`, it reads 100, because the event loop is busy running the code that called
  it.
- Values come from the Node.js histogram (`monitorEventLoopDelay`): they are not rounded, and they are approximate,
  including the minimum, the maximum and the mean.
- The 1 ms timer uses CPU even while the application is idle: on a battery-powered device, declare
  this monitor only when you need it.

## 6. `HttpRequestMonitor`

| Field | Meaning |
|---|---|
| `count` | The number of requests responded to |
| `min`, `max`, `avg`, `stdDev` | The minimum, maximum, mean and standard deviation of their durations |
| `p50`, `p90`, `p95`, `p99` | Percentiles of their durations |

- It counts the requests that every HTTP server in the process responds to (the HTTP adapters, the HTTP service,
  JSON-RPC over HTTP, the Socket.IO server, a custom server), including error responses and HTTPS requests. It does not
  count HTTP/2 requests, requests the process sends, or requests it never responds to.
- It provides no breakdown by route or status.
- It counts only requests that start after its creation: a request in progress when the monitor is created is not
  counted. When read from an action, the statistics do not include the request being handled.
- Durations are in milliseconds, rounded to 2 decimals.

## 7. Worker threads

A worker thread that declares monitors measures:

- its own event loop's delays and busy time (`EventLoopMonitor`);
- the requests its own HTTP servers handle (`HttpRequestMonitor`);
- the whole process's CPU and resident memory (`CpuMonitor`, `physicalUsed` of `MemoryMonitor`), but its own heap
  (`heapUsed`).

# Lakutata Monitors

The monitors of `lakutata/com/monitor` measure the process an application runs in: its CPU usage, its memory, the delays
of its event loop, and the time its HTTP requests take. Each one is a component that keeps the statistics of its
measures since it was created, or since its last `reset()`, in constant memory. They need nothing more than `lakutata`.

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
- The monitors have no options. An option given to one is ignored, with a warning when the application starts.
- `statistics` is computed at each read. `reset()` starts a new period: the statistics then cover the measures taken
  since.
- Their timers do not keep the process alive, and they stop when the application stops.

## 2. What they measure

| Monitor | Measures | Sampled | Unit |
|---|---|---|---|
| `CpuMonitor` | The CPU time of the process | Every second | Percent of one core |
| `MemoryMonitor` | The memory of the process: resident, heap, external | At its creation, then every second | Bytes |
| `EventLoopMonitor` | The delays of the event loop, and the share of the time it is busy | Continuously | Milliseconds, percent |
| `HttpRequestMonitor` | The duration of the HTTP requests the process answers | Each request | Milliseconds |

The statistics of the CPU, the memory and the HTTP requests hold the latest value, the minimum, the maximum and the
mean, which are exact, and percentiles (P50, P90, P95, P99) with 3 significant digits. The statistics of the CPU and of
the HTTP requests are all 0 before their first measure.

## 3. `CpuMonitor`

| Field | Meaning |
|---|---|
| `usage` | The latest sample |
| `usageMin`, `usageMax`, `usageAvg` | The minimum, the maximum and the mean of the samples |
| `usageP50`, `usageP90`, `usageP95`, `usageP99` | The percentiles of the samples |

- The usage is the CPU time of the whole process (user and system, every thread) over the elapsed time, in percent of
  one core: 100 is one core fully busy, and a process using several cores (worker threads, the thread pool of Node.js)
  goes above 100. The values are rounded to 5 decimals.
- The first sample is taken one second after the monitor is created.
- When the event loop is blocked, the next sample comes late and covers the whole blocked time. It then counts once per
  second it covers, so that the mean and the percentiles weigh the busy periods by their duration.

## 4. `MemoryMonitor`

| Fields | Meaning |
|---|---|
| `physicalTotal` | The memory of the machine (`os.totalmem()`), not the limit of a container |
| `physicalUsed`, `physicalUsage` | The resident memory of the process (`rss`), and its percentage of `physicalTotal` |
| `heapTotal`, `heapUsed`, `heapUsage` | The heap of V8 and its used part, and their ratio in percent |
| `externalUsed` | The memory of the C++ objects bound to JavaScript objects, the `Buffer`s among them |
| `physicalUsedMin`, `…Max`, `…Avg`, `…P50`, `…P90`, `…P95`, `…P99` | The statistics of `physicalUsed` |
| `heapUsedMin`, `…Max`, `…Avg`, `…P50`, `…P90`, `…P95`, `…P99` | The statistics of `heapUsed` |
| `externalUsedMin`, `…Max`, `…Avg`, `…P50`, `…P90`, `…P95`, `…P99` | The statistics of `externalUsed` |

- The values are in bytes; the means and the two percentages are rounded to 2 decimals.
- `heapUsage` compares the used heap with the heap allocated so far, not with its limit: a high value alone is not a
  problem. A leak shows as a `heapUsedMin` that rises from one period to the next.
- `reset()` keeps the latest values (`physicalUsed`, `heapUsed`…); the other statistics start again.

## 5. `EventLoopMonitor`

| Field | Meaning |
|---|---|
| `min`, `max`, `avg`, `stdDev` | The minimum, the maximum, the mean and the standard deviation of the delays |
| `p50`, `p90`, `p95`, `p99` | The percentiles of the delays |
| `utilRate` | The share of the time the event loop was busy, in percent |

- The delay is the interval between the runs of a timer of 1 ms: about 1 ms when the event loop is idle, more when
  synchronous work (a long computation, synchronous I/O, a large JSON) holds it. `max` is the longest block.
- `utilRate` covers the whole period since the creation or the last `reset()`: near 100, the event loop has no idle
  time left. Right after a `reset()`, it reads 100, the event loop being busy running the code that called it.
- The values come from the histogram of Node.js (`monitorEventLoopDelay`): they are not rounded, and they are
  approximate, the minimum, the maximum and the mean included.
- The timer of 1 ms costs about 1.5 % of one core while the application is idle: on a device that runs on a battery,
  declare this monitor only when you need it.

## 6. `HttpRequestMonitor`

| Field | Meaning |
|---|---|
| `count` | The number of requests answered |
| `min`, `max`, `avg`, `stdDev` | The minimum, the maximum, the mean and the standard deviation of their durations |
| `p50`, `p90`, `p95`, `p99` | The percentiles of their durations |

- It counts the requests answered by every HTTP server of the process (the HTTP adapters, the HTTP service, JSON-RPC
  over HTTP, the server of Socket.IO, a server of your own), errors included, HTTPS too. It does not count the requests
  of HTTP/2, those that the process sends, nor those it never answers.
- It gives no breakdown by route or by status.
- It only counts the requests that start after its creation: a request in progress when the monitor is created is not
  counted. Read from an action, the statistics do not include the request being answered.
- The durations are in milliseconds, rounded to 2 decimals.

## 7. Worker threads

A worker thread that declares monitors measures:

- the delays and the busy time of its own event loop (`EventLoopMonitor`);
- the requests of its own HTTP servers (`HttpRequestMonitor`);
- the CPU and the resident memory of the whole process (`CpuMonitor`, `physicalUsed` of `MemoryMonitor`), but its own
  heap (`heapUsed`).

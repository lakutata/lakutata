# Background jobs

This example builds a service that makes reports in the background: a request queues a report and gets its id at once,
a queue action builds the report, and the client asks for its state until it is done. A scheduled job deletes the old
reports, in one instance of the service at a time. It starts from the `service` template and shows the queue component
and its actions, the retries and the dead letter queue, a schedule, a lock shared by the instances, and the tests. No
server is needed: the queue is in memory, and the reports and the locks are files.

| Action | Name | What it does |
|---|---|---|
| `POST` | `/reports` | Queues the report of a month, `{"month": "2026-09"}`, and answers with its id |
| `GET` | `/reports/:id` | Gives the state of a report (`queued`, `running`, `done`, `failed`) and its result |
| Queue | `report.build` | Builds a report: 2 at a time, 3 attempts |
| Queue | `report.build.dead` | Marks the reports that used up their attempts as failed |
| Schedule | `*/5 * * * *` | Deletes the reports finished more than a day ago, in one instance |

## 1. Create the project

```bash
npx @lakutata/cli create --name reports --template service --yes
cd reports
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
echo 'data/' >> .gitignore
```

The project is a workspace whose service is `packages/app` ([ProjectStructure](../ProjectStructure.md)). The queues
(`lakutata/com/queue`) and the locks (`lakutata/com/mutex`) come with the `lakutata` package, and their memory and file
drivers need no other package, so nothing is installed. The example controller of the template is removed, and the
`data` directory, which holds the reports and the locks, is kept out of git.

## 2. The input

**`packages/app/src/dtos/ReportDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * A new report: the sales of a month
 */
export class CreateReportDTO extends DTO {
    @Expect(DTO.String().pattern(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM').required())
    public month: string
}

/**
 * A report by its id
 */
export class ReportIdDTO extends DTO {
    @Expect(DTO.String().uuid().required())
    public id: string
}

/**
 * The message of a job: the report to build
 */
export class BuildReportDTO extends CreateReportDTO {
    @Expect(DTO.String().uuid().required())
    public id: string
}
```

- `CreateReportDTO` is the body of `POST /reports`. The second argument of `pattern()` names the pattern in the error
  message: `"month" with value "2026-13" fails to match the YYYY-MM pattern`.
- `BuildReportDTO` is the message that the queue carries: the id of the report and its month. A queue action validates
  its message with its DTO, as any action validates its input ([DTOValidation](../DTOValidation.md)).

## 3. The reports

**`packages/app/src/components/Reports.ts`**

```typescript
import {randomUUID} from 'node:crypto'
import {mkdir, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'
import {type SalesSummary} from './Sales.js'
import {ReportNotFoundException} from '../exceptions/ReportNotFoundException.js'

/**
 * A report, from its request to its result
 */
export interface Report {
    id: string
    month: string
    state: 'queued' | 'running' | 'done' | 'failed'
    attempts: number
    createdAt: string
    finishedAt?: string
    result?: SalesSummary
    error?: string
}

/**
 * The reports: a JSON file each, in a directory that the instances of the service on a machine share
 */
export class Reports extends Component {

    /**
     * The directory of the reports
     */
    @Configurable(DTO.String().required())
    protected readonly directory: string

    /**
     * How long a finished report is kept, in milliseconds
     */
    @Configurable(DTO.Number().positive().required())
    protected readonly keep: number

    /**
     * Create the directory when it is missing
     */
    protected async init(): Promise<void> {
        await mkdir(this.directory, {recursive: true})
    }

    /**
     * The file of a report
     * @param id
     */
    protected file(id: string): string {
        return path.join(this.directory, `${id}.json`)
    }

    /**
     * Write a report to a temporary file, then rename the file, so that a reader never gets half a report
     * @param report
     */
    protected async save(report: Report): Promise<Report> {
        const temporary: string = `${this.file(report.id)}.${process.pid}.tmp`
        await writeFile(temporary, JSON.stringify(report))
        await rename(temporary, this.file(report.id))
        return report
    }

    /**
     * A new report, queued
     * @param month
     */
    public async create(month: string): Promise<Report> {
        return await this.save({id: randomUUID(), month: month, state: 'queued', attempts: 0, createdAt: new Date().toISOString()})
    }

    /**
     * A report, or a 404 error
     * @param id
     */
    public async get(id: string): Promise<Report> {
        try {
            return JSON.parse(await readFile(this.file(id), 'utf8')) as Report
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ReportNotFoundException(`The report ${id} does not exist`)
            throw error
        }
    }

    /**
     * Change a report
     * @param id
     * @param changes
     */
    public async update(id: string, changes: Partial<Report>): Promise<Report> {
        return await this.save({...await this.get(id), ...changes})
    }

    /**
     * Delete the reports that finished longer ago than the time they are kept
     * @param now the time of the cleaning
     * @returns the number of reports deleted
     */
    public async clean(now: Date = new Date()): Promise<number> {
        let deleted: number = 0
        for (const name of await readdir(this.directory)) {
            if (!name.endsWith('.json')) continue
            const report: Report = await this.get(path.basename(name, '.json'))
            if (report.finishedAt && now.getTime() - Date.parse(report.finishedAt) > this.keep) {
                await rm(this.file(report.id), {force: true})
                deleted++
            }
        }
        return deleted
    }
}
```

**`packages/app/src/exceptions/ReportNotFoundException.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * The report of the request does not exist
 */
export class ReportNotFoundException extends Exception {
    public errno: string = 'E_REPORT_NOT_FOUND'

    public readonly statusCode: number = 404
}
```

A report is `queued`, then `running`, and ends `done` with its result or `failed` with its error. The `Reports`
component keeps each report in a JSON file:

- A component is created once and shared by the whole service: the HTTP actions, the queue actions and the schedule
  use the same instance ([Objects](../Objects.md)). Its `@Configurable` properties are its options, given in
  `Config.ts`, and its `init()` creates the directory.
- A report is written to a temporary file, then renamed, so a request never reads half a report.
- `clean()` deletes the reports that finished more than `keep` ago; it is what the schedule runs. It takes the current
  time as an argument, so that the test can run it as if it were tomorrow.
- The instances of the service on one machine share the directory. In a service with a database, the reports would be
  a table, behind the same methods.

## 4. The sales

**`packages/app/src/components/Sales.ts`**

```typescript
import {setTimeout} from 'node:timers/promises'
import {Component} from 'lakutata'

/**
 * The sales of a month
 */
export interface SalesSummary {
    orders: number
    revenue: number
}

/**
 * The sales of the shop. Made up in this example; in a real service, queries to its database, the slow part of a report
 */
export class Sales extends Component {

    /**
     * The orders and the revenue of a month
     * @param month 2026-09
     * @param signal aborted when the job is stopped: at its time limit, or when the service stops
     */
    public async summarize(month: string, signal?: AbortSignal): Promise<SalesSummary> {
        //The slow part: half a second here
        await setTimeout(500, undefined, {signal: signal})
        //Made-up figures, always the same for a given month
        const orders: number = Number(month.replace('-', '')) % 500 + 100
        return {orders: orders, revenue: orders * 37.5}
    }
}
```

A report counts the orders of a month and their revenue. Here the figures are made up, after a wait of half a second
that stands for the slow queries of a real service. `summarize()` takes the job's signal, so that the wait stops when
the job is aborted. Because `Sales` is a separate component, the tests can replace its `summarize()` to make a job fail.

## 5. The controller

**`packages/app/src/controllers/ReportController.ts`**

```typescript
import {Controller, Result, type StatusResult} from 'lakutata/com/entrypoint'
import {type Logger} from 'lakutata/com/logger'
import {type Queue, QueueAction, type QueueContext, type QueueDeadLetter} from 'lakutata/com/queue'
import {GET, POST, Prefix, Schedule} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {type Report, type Reports} from '../components/Reports.js'
import {type Sales, type SalesSummary} from '../components/Sales.js'
import {BuildReportDTO, CreateReportDTO, ReportIdDTO} from '../dtos/ReportDTO.js'

@Prefix({route: '/reports'})
export class ReportController extends Controller {

    /**
     * The queues of the service (the component "queue" of its options)
     */
    @Inject('queue')
    protected readonly queue: Queue

    /**
     * The reports (the component "reports")
     */
    @Inject('reports')
    protected readonly reports: Reports

    /**
     * The sales of the shop (the component "sales")
     */
    @Inject('sales')
    protected readonly sales: Sales

    /**
     * The log of the service
     */
    @Inject('log')
    protected readonly log: Logger

    /**
     * POST /reports {"month": "2026-09"}: the report is queued, and its id returned at once
     * @param input
     */
    @POST('/', CreateReportDTO)
    public async create(input: CreateReportDTO): Promise<StatusResult> {
        const report: Report = await this.reports.create(input.month)
        await this.queue.add('report.build', {id: report.id, month: report.month}, {jobId: report.id})
        return Result.status(202, report, {Location: `/reports/${report.id}`})
    }

    /**
     * GET /reports/:id: its state, and its result once done
     * @param input
     */
    @GET('/:id', ReportIdDTO)
    public async get(input: ReportIdDTO): Promise<Report> {
        return await this.reports.get(input.id)
    }

    /**
     * Builds the reports of the queue report.build: 2 at a time, 3 attempts 1 s then 2 s apart, 1 minute each
     * @param input
     */
    @QueueAction('report.build', BuildReportDTO, {concurrency: 2, attempts: 3, backoff: {type: 'exponential', delay: '1s'}, timeout: '1m'})
    public async build(input: BuildReportDTO): Promise<SalesSummary> {
        const context: QueueContext = this.context as QueueContext
        await this.reports.update(input.id, {state: 'running', attempts: context.attempt})
        try {
            const result: SalesSummary = await this.sales.summarize(input.month, this.signal)
            await this.reports.update(input.id, {state: 'done', result: result, error: undefined, finishedAt: new Date().toISOString()})
            return result
        } catch (error) {
            //Back in the queue: delivered again after the backoff while attempts remain, then sent to report.build.dead
            await this.reports.update(input.id, {state: 'queued', error: (error as Error).message})
            throw error
        }
    }

    /**
     * The jobs of report.build that used up their attempts
     * @param input
     */
    @QueueAction('report.build.dead')
    public async failed(input: QueueDeadLetter): Promise<void> {
        const job: BuildReportDTO = input.input as BuildReportDTO
        await this.reports.update(job.id, {state: 'failed', error: input.error.message, finishedAt: input.failedAt})
    }

    /**
     * Every 5 minutes, in one instance at a time: delete the old reports
     */
    @Schedule({cron: '*/5 * * * *', exclusive: true})
    public async clean(): Promise<void> {
        const deleted: number = await this.reports.clean()
        this.log.info('%d old reports deleted', deleted)
    }
}
```

One controller holds the actions of three transports: HTTP, the queue and the schedule. Each request, message or run
gets a new instance of the controller, with the components injected ([Controllers](../Controllers.md)).

- `create()` saves the report, adds a message to the queue `report.build` with `queue.add()`, and answers without
  waiting for the build: `Result.status()` sends the status 202 (Accepted), the report, and a `Location` header that
  points to it ([HTTP](../HTTP.md)). The `jobId` of the message is the id of the report.
- `@QueueAction` makes `build()` the consumer of the queue `report.build` ([Queue](../Queue.md)). It processes 2
  messages at a time (`concurrency`), each for at most 1 minute (`timeout`: after that, `this.signal` is aborted and
  the message is retried). Its context, a `QueueContext`, gives the number of the current `attempt` (1 on the first
  delivery) and the `attempts` allowed.
- A message is acknowledged when its action returns, and the value the action returns becomes the result of the
  message, which the queue keeps. When the action throws, `build()` puts the report back in the `queued` state with
  the error, and the message is delivered again after the `backoff` (1 s, then 2 s), up to 3 attempts. After the third
  failed attempt, it goes to the dead letter queue `report.build.dead`, a queue like the others: `failed()` consumes
  it and marks the report as failed.
- A message is delivered at least once: after a crash, a server-backed driver delivers it again, and `build()` builds
  the same report a second time, which does no harm.
- `@Schedule` runs `clean()` at the times of the cron expression, every 5 minutes ([Schedules](../Schedules.md)). With
  `exclusive: true`, each run first tries to get the lock `schedule:ReportController:clean` from the `mutex` component;
  the instances that do not get it skip the run ([Mutex](../Mutex.md)).

## 6. The options of the service

**`packages/app/src/config/Config.ts`**

```typescript
import path from 'node:path'
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints, scheduleEntrypoint} from 'lakutata/com/entrypoint'
import {Mutex} from 'lakutata/com/mutex'
import {buildQueueOptions, queueEntrypoint} from 'lakutata/com/queue'
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'
import compression from 'compression'
import {authenticate} from '../middlewares/Authenticate.js'
import {HealthController} from '../controllers/HealthController.js'
import {ReportController} from '../controllers/ReportController.js'
import {Reports} from '../components/Reports.js'
import {Sales} from '../components/Sales.js'

/**
 * The options of the service
 * @param port the port of the HTTP server, the PORT environment variable or 8080 by default
 * @param data the directory of the reports and of the locks, the DATA environment variable or data by default
 */
export function config(port: number = Number(process.env.PORT ?? 8080), data: string = process.env.DATA ?? 'data'): ApplicationOptions {
    return {
        id: 'reports',
        name: 'reports',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //The messages are kept in the memory of the process, and their results for an hour
            queue: buildQueueOptions({results: {keep: '1h'}}),
            //The locks: files that the instances of the service on a machine share
            mutex: {class: Mutex, driver: {type: 'file', directory: path.join(data, 'locks')}},
            //The finished reports are kept for a day
            reports: {class: Reports, directory: path.join(data, 'reports'), keep: 24 * 60 * 60 * 1000},
            sales: {class: Sales},
            entrypoint: buildEntrypoints({
                controllers: [HealthController, ReportController],
                http: expressHTTPEntrypoint({
                    port: port,
                    //The results and the errors are {errno, errMsg, data}; the errors keep their status (400, 404…)
                    respond: jsonEnvelope(),
                    body: {limit: '100mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    middlewares: [authenticate],
                    before: (app): void => void app.use(compression())
                }),
                //Delivers the messages of the queues to the @QueueAction actions
                queue: queueEntrypoint('queue'),
                //Runs the @Schedule actions
                schedule: scheduleEntrypoint()
            })
        },
        bootstrap: ['entrypoint']
    }
}
```

This is the `Config.ts` of the template, with:

- the `queue` component, made by `buildQueueOptions()`: without a `driver`, the messages are kept in the memory of the
  process. The queue keeps the results of the messages for an hour (a day by default): the test reads one of them,
  while the service itself reads the reports from their files;
- the `mutex` component, with the `file` driver: a lock is a file in `data/locks`, shared by the processes on the
  machine that use this directory;
- the `reports` and `sales` components of the example, with their options;
- the `ReportController` instead of the example controller;
- two more entrypoint adapters: `queueEntrypoint('queue')` delivers the messages of the `queue` component to the
  `@QueueAction` actions, and `scheduleEntrypoint()` runs the `@Schedule` actions ([Entrypoint](../Entrypoint.md)).
  Without its adapter, a decorator has no effect;
- `jsonEnvelope()` without `errorStatus`, so that the errors keep their status (400, 404), as REST clients expect.

`bootstrap: ['entrypoint']` creates the entrypoint at launch, and with it the queue: the actions start consuming once
the service has launched. The template's middleware `Authenticate.ts` stays: it is a middleware of the HTTP adapter, so
the queue messages and the scheduled runs do not go through it.

## 7. Run it

Run two instances of the service on this machine; they share the `data` directory:

```bash
npm run dev
```

In a second terminal, once the first instance has started:

```bash
PORT=8081 npm start
```

In a third terminal, queue a report on the first instance and read it on the second one:

```bash
curl -i -X POST localhost:8080/reports -H 'Content-Type: application/json' -d '{"month": "2026-09"}'
# HTTP/1.1 202 Accepted
# Location: /reports/eadbb7c5-7202-4aca-b2b6-daeeb23ad9f9
# {"errno":null,"errMsg":null,"data":{"id":"eadbb7c5-7202-4aca-b2b6-daeeb23ad9f9","month":"2026-09","state":"queued","attempts":0,"createdAt":"2026-10-17T15:00:46.797Z"}}

curl localhost:8081/reports/eadbb7c5-7202-4aca-b2b6-daeeb23ad9f9
# {"errno":null,"errMsg":null,"data":{"id":"eadbb7c5-7202-4aca-b2b6-daeeb23ad9f9","month":"2026-09","state":"running","attempts":1,"createdAt":"2026-10-17T15:00:46.797Z"}}

curl localhost:8081/reports/eadbb7c5-7202-4aca-b2b6-daeeb23ad9f9
# {"errno":null,"errMsg":null,"data":{"id":"eadbb7c5-7202-4aca-b2b6-daeeb23ad9f9","month":"2026-09","state":"done","attempts":1,"createdAt":"2026-10-17T15:00:46.797Z","result":{"orders":209,"revenue":7837.5},"finishedAt":"2026-10-17T15:00:47.303Z"}}

curl -i -X POST localhost:8080/reports -H 'Content-Type: application/json' -d '{"month": "2026-13"}'
# HTTP/1.1 400 Bad Request
# {"errno":"E_INVALID_VALUE","errMsg":"\"month\" with value \"2026-13\" fails to match the YYYY-MM pattern","data":null}

curl -i localhost:8081/reports/5b0f8a52-2f4e-4a3c-9a55-0b1c3c4d5e6f
# HTTP/1.1 404 Not Found
# {"errno":"E_REPORT_NOT_FOUND","errMsg":"The report 5b0f8a52-2f4e-4a3c-9a55-0b1c3c4d5e6f does not exist","data":null}
```

The first instance, which received the request, builds the report in half a second; the second one reads its file.

Every 5 minutes, at :00, :05, :10…, one of the two instances deletes the old reports. This time it was the first one,
which wrote in its terminal:

```
app │ [23:05:00.009] INFO (reports/97338): 0 old reports deleted
```

The second instance did not get the lock and skipped the run, without writing anything to its log. No report was
deleted: the reports are kept for a day.

## 8. Test it

The test of the template is replaced by a test of the reports. It starts the service with its reports and its locks in
a temporary directory:

**`packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it, type TestContext} from 'node:test'
import assert from 'node:assert'
import {mkdtemp, rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {setTimeout} from 'node:timers/promises'
import {Application} from 'lakutata'
import {type Queue} from 'lakutata/com/queue'
import {config} from '../config/Config.js'
import {type Report, type Reports} from '../components/Reports.js'
import {type Sales} from '../components/Sales.js'

const PORT: number = Number(process.env.TEST_PORT ?? 18087)

/**
 * A request to the service: its status and its {errno, errMsg, data}
 * @param method
 * @param route
 * @param body
 */
async function request(method: string, route: string, body?: unknown): Promise<{ status: number, errno: string | null, data: any }> {
    const response: Response = await fetch(`http://127.0.0.1:${PORT}${route}`, {
        method: method,
        headers: {'Authorization': 'Bearer test-token', 'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    const envelope = await response.json() as { errno: string | null, data: any }
    return {status: response.status, errno: envelope.errno, data: envelope.data}
}

/**
 * Read a report until its job has ended (done or failed)
 * @param id
 */
async function finished(id: string): Promise<Report> {
    for (; ;) {
        const report: Report = (await request('GET', `/reports/${id}`)).data
        if (report.state === 'done' || report.state === 'failed') return report
        await setTimeout(100)
    }
}

describe('reports', (): void => {

    let app: Application
    let data: string

    before(async (): Promise<void> => {
        process.env.API_TOKEN = 'test-token'
        //The reports and the locks in a temporary directory
        data = await mkdtemp(path.join(os.tmpdir(), 'reports-'))
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config(PORT, data)).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
        await rm(data, {recursive: true, force: true})
    })

    it('builds a report in the background', async (): Promise<void> => {
        const created = await request('POST', '/reports', {month: '2026-09'})
        assert.strictEqual(created.status, 202)
        assert.strictEqual(created.data.state, 'queued')
        //The result of the job, kept by the queue
        const queue: Queue = await app.getObject<Queue>('queue')
        assert.deepStrictEqual(await queue.result('report.build', created.data.id), {orders: 209, revenue: 7837.5})
        const report = await request('GET', `/reports/${created.data.id}`)
        assert.strictEqual(report.data.state, 'done')
        assert.deepStrictEqual(report.data.result, {orders: 209, revenue: 7837.5})
        assert.strictEqual(report.data.attempts, 1)
    })

    it('retries a job that failed', async (t: TestContext): Promise<void> => {
        const sales: Sales = await app.getObject<Sales>('sales')
        //The first call fails, the next ones run the real code
        const summarize = t.mock.method(sales, 'summarize')
        summarize.mock.mockImplementationOnce(async (): Promise<never> => {
            throw new Error('The database did not answer')
        })
        const created = await request('POST', '/reports', {month: '2026-08'})
        const report: Report = await finished(created.data.id)
        assert.strictEqual(report.state, 'done')
        assert.strictEqual(report.attempts, 2)
        assert.strictEqual(summarize.mock.callCount(), 2)
    })

    it('fails a job after its attempts', async (t: TestContext): Promise<void> => {
        const sales: Sales = await app.getObject<Sales>('sales')
        t.mock.method(sales, 'summarize', async (): Promise<never> => {
            throw new Error('The database did not answer')
        })
        const created = await request('POST', '/reports', {month: '2026-07'})
        const report: Report = await finished(created.data.id)
        assert.strictEqual(report.state, 'failed')
        assert.strictEqual(report.attempts, 3)
        assert.strictEqual(report.error, 'The database did not answer')
    })

    it('refuses an invalid month and an unknown report', async (): Promise<void> => {
        const invalid = await request('POST', '/reports', {month: '2026-13'})
        assert.strictEqual(invalid.status, 400)
        assert.strictEqual(invalid.errno, 'E_INVALID_VALUE')
        const unknown = await request('GET', '/reports/5b0f8a52-2f4e-4a3c-9a55-0b1c3c4d5e6f')
        assert.strictEqual(unknown.status, 404)
        assert.strictEqual(unknown.errno, 'E_REPORT_NOT_FOUND')
    })

    it('deletes the reports finished for more than a day', async (): Promise<void> => {
        //What the schedule runs, called directly: now, then as if it were tomorrow
        const reports: Reports = await app.getObject<Reports>('reports')
        assert.strictEqual(await reports.clean(new Date()), 0)
        assert.strictEqual(await reports.clean(new Date(Date.now() + 25 * 60 * 60 * 1000)), 3)
    })
})
```

- The first test reads the result of the job with `queue.result()`, which waits until the message has been processed,
  then reads the report.
- To make a job fail, the tests replace the `summarize()` method of the `sales` component with `t.mock.method()` from
  `node:test`: for one call, to see the job succeed on its second attempt, then for every call, to see it fail after
  its 3 attempts, which takes 3 seconds (the backoff). The component is shared, so the action calls the replaced
  method, which is restored at the end of the test.
- The last test calls `clean()` directly, as if it were tomorrow, rather than waiting for the cron expression.

```bash
npm test
```

```
app │   ✔ builds a report in the background
app │   ✔ retries a job that failed
app │   ✔ fails a job after its attempts
app │   ✔ refuses an invalid month and an unknown report
app │   ✔ deletes the reports finished for more than a day
app │ ℹ pass 5
✔ test ran in app
```

The service logs each failed attempt, with its error: `The queue action ReportController:build failed on the message
<id> of report.build (attempt 1 of 3)`. `queueEntrypoint('queue', {onError})` replaces this log.

## 9. With several machines

The example runs its instances on one machine. On several machines, each part needs a driver that the machines share,
and the code of the actions does not change:

- The queue: the memory driver keeps the messages in one process. An instance builds only the reports it was asked
  for, and the messages still waiting when it stops are lost: their reports stay `queued`, and the schedule never
  deletes them. With Redis (`driver: {type: 'redis', url: process.env.REDIS_URL}`, and
  `npm install bullmq ioredis -w app`), the messages survive restarts, any instance can process them, and the results
  are shared ([Queue](../Queue.md)).
- The locks: the file driver shares them only between the processes of one machine. Redis
  (`driver: {type: 'redis', url}`, and `npm install redis -w app`) or PostgreSQL share them between machines
  ([Mutex](../Mutex.md)).
- The reports: a database table ([A REST API with a database](RestAPI.md)), or a volume that every instance mounts as
  `DATA`.

`npm start` runs the built service, and `npm run docker:build` makes its image (the template's `Dockerfile`).

<!--
check:
  create: reports service
  remove: packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
  run: npm test
-->

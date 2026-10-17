# 后台任务

这个示例构建一个在后台生成报表的服务：请求把一份报表加入队列，立即得到它的 id；队列的动作负责生成报表，客户端则反复查询报表的状态，直到报表生成完毕。一个定时任务负责删除旧报表，同一时间只在一个服务实例中执行。示例从 `service` 模板开始，展示队列组件及其动作、重试和死信队列、定时任务、各实例共用的锁，以及测试。整个示例不需要单独的服务器：队列在内存中，报表和锁都是文件。

| 动作 | 名称 | 作用 |
|---|---|---|
| `POST` | `/reports` | 把某个月的报表加入队列（`{"month": "2026-09"}`），返回它的 id |
| `GET` | `/reports/:id` | 取报表的状态（`queued`、`running`、`done`、`failed`）和结果 |
| 队列 | `report.build` | 生成报表：同时处理 2 份，最多尝试 3 次 |
| 队列 | `report.build.dead` | 把尝试次数已用完的报表标为失败 |
| 定时任务 | `*/5 * * * *` | 删除结束超过一天的报表，只在一个实例中执行 |

## 1. 创建项目

```bash
npx @lakutata/cli create --name reports --template service --yes
cd reports
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
echo 'data/' >> .gitignore
```

项目是一个工作区，服务在 `packages/app` 中（见 [ProjectStructure](../ProjectStructure.md)）。队列（`lakutata/com/queue`）和锁（`lakutata/com/mutex`）都包含在 `lakutata` 包中，它们的内存驱动和文件驱动不需要其他包，所以这里什么都不用安装。这里还删掉了模板中的示例控制器，并让 git 忽略存放报表和锁的 `data` 目录。

## 2. 输入

**`packages/app/src/dtos/ReportDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * 新报表：某个月的销售额
 */
export class CreateReportDTO extends DTO {
    @Expect(DTO.String().pattern(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM').required())
    public month: string
}

/**
 * 按 id 指定的报表
 */
export class ReportIdDTO extends DTO {
    @Expect(DTO.String().uuid().required())
    public id: string
}

/**
 * 任务的消息：要生成的报表
 */
export class BuildReportDTO extends CreateReportDTO {
    @Expect(DTO.String().uuid().required())
    public id: string
}
```

- `CreateReportDTO` 是 `POST /reports` 的请求体。`pattern()` 的第二个参数是这条规则的名字，错误消息中会用到它：`"month" with value "2026-13" fails to match the YYYY-MM pattern`。
- `BuildReportDTO` 是队列传递的消息：报表的 id 和月份。队列的动作和其他动作一样，用自己的 DTO 校验输入，这里的输入就是消息（见 [DTOValidation](../DTOValidation.md)）。

## 3. 报表

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
 * 一份报表：从请求到结果
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
 * 报表：每份报表是目录中的一个 JSON 文件，同一台机器上的各个服务实例共用这个目录
 */
export class Reports extends Component {

    /**
     * 报表所在的目录
     */
    @Configurable(DTO.String().required())
    protected readonly directory: string

    /**
     * 已结束的报表保留多久（毫秒）
     */
    @Configurable(DTO.Number().positive().required())
    protected readonly keep: number

    /**
     * 目录不存在时创建它
     */
    protected async init(): Promise<void> {
        await mkdir(this.directory, {recursive: true})
    }

    /**
     * 报表的文件
     * @param id
     */
    protected file(id: string): string {
        return path.join(this.directory, `${id}.json`)
    }

    /**
     * 写入报表：先写到临时文件再重命名，读取的一方就不会读到写了一半的报表
     * @param report
     */
    protected async save(report: Report): Promise<Report> {
        const temporary: string = `${this.file(report.id)}.${process.pid}.tmp`
        await writeFile(temporary, JSON.stringify(report))
        await rename(temporary, this.file(report.id))
        return report
    }

    /**
     * 新报表，处于排队状态
     * @param month
     */
    public async create(month: string): Promise<Report> {
        return await this.save({id: randomUUID(), month: month, state: 'queued', attempts: 0, createdAt: new Date().toISOString()})
    }

    /**
     * 取一份报表，不存在时抛出 404 错误
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
     * 修改报表
     * @param id
     * @param changes
     */
    public async update(id: string, changes: Partial<Report>): Promise<Report> {
        return await this.save({...await this.get(id), ...changes})
    }

    /**
     * 删除结束时间超过保留期限的报表
     * @param now 清理的时间
     * @returns 删除的报表数
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
 * 请求的报表不存在
 */
export class ReportNotFoundException extends Exception {
    public errno: string = 'E_REPORT_NOT_FOUND'

    public readonly statusCode: number = 404
}
```

报表先是 `queued`（排队中），然后是 `running`（生成中），最后要么是 `done`（完成）并带有结果，要么是 `failed`（失败）并带有错误。`Reports` 组件把每份报表保存为一个 JSON 文件：

- 组件只创建一次，由整个服务共用：HTTP 动作、队列动作和定时任务用的是同一个实例（见 [Objects](../Objects.md)）。它的 `@Configurable` 属性就是它的选项，在 `Config.ts` 中给出；目录由它的 `init()` 创建。
- 报表先写入临时文件，再重命名，所以请求不会读到写了一半的报表。
- `clean()` 删除结束后已超过 `keep` 时长的报表，这就是定时任务要做的工作。它把当前时间作为参数，这样测试就能模拟明天执行时的情形。
- 同一台机器上的各个服务实例共用这个目录。如果服务有数据库，报表就会是一张表，方法保持不变。

## 4. 销售数据

**`packages/app/src/components/Sales.ts`**

```typescript
import {setTimeout} from 'node:timers/promises'
import {Component} from 'lakutata'

/**
 * 一个月的销售额
 */
export interface SalesSummary {
    orders: number
    revenue: number
}

/**
 * 商店的销售数据。本例中是编造的；在真实的服务中，这里是对数据库的查询，也是生成报表时最慢的部分
 */
export class Sales extends Component {

    /**
     * 一个月的订单数和收入
     * @param month 2026-09
     * @param signal 任务被停止时中止：到了时间上限，或者服务正在停止
     */
    public async summarize(month: string, signal?: AbortSignal): Promise<SalesSummary> {
        //慢的部分：这里只等半秒
        await setTimeout(500, undefined, {signal: signal})
        //编造的数字，同一个月每次都相同
        const orders: number = Number(month.replace('-', '')) % 500 + 100
        return {orders: orders, revenue: orders * 37.5}
    }
}
```

报表统计一个月的订单数和收入。这里的数字是编造的，前面等待的半秒代表的是真实服务中缓慢的查询。`summarize()` 接收任务的信号，任务被中止时，等待也随之结束。`Sales` 是一个单独的组件，所以测试可以替换它的 `summarize()`，让任务失败。

## 5. 控制器

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
     * 服务的队列（选项中的 "queue" 组件）
     */
    @Inject('queue')
    protected readonly queue: Queue

    /**
     * 报表（"reports" 组件）
     */
    @Inject('reports')
    protected readonly reports: Reports

    /**
     * 商店的销售数据（"sales" 组件）
     */
    @Inject('sales')
    protected readonly sales: Sales

    /**
     * 服务的日志
     */
    @Inject('log')
    protected readonly log: Logger

    /**
     * POST /reports {"month": "2026-09"}：报表加入队列，立即返回它的 id
     * @param input
     */
    @POST('/', CreateReportDTO)
    public async create(input: CreateReportDTO): Promise<StatusResult> {
        const report: Report = await this.reports.create(input.month)
        await this.queue.add('report.build', {id: report.id, month: report.month}, {jobId: report.id})
        return Result.status(202, report, {Location: `/reports/${report.id}`})
    }

    /**
     * GET /reports/:id：报表的状态，完成后还有结果
     * @param input
     */
    @GET('/:id', ReportIdDTO)
    public async get(input: ReportIdDTO): Promise<Report> {
        return await this.reports.get(input.id)
    }

    /**
     * 生成队列 report.build 中的报表：同时处理 2 份，最多尝试 3 次，间隔先 1 秒后 2 秒，每次最长 1 分钟
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
            //重新排队：还有尝试次数时，等待退避时间后重新投递；次数用完后发往 report.build.dead
            await this.reports.update(input.id, {state: 'queued', error: (error as Error).message})
            throw error
        }
    }

    /**
     * report.build 中尝试次数已用完的任务
     * @param input
     */
    @QueueAction('report.build.dead')
    public async failed(input: QueueDeadLetter): Promise<void> {
        const job: BuildReportDTO = input.input as BuildReportDTO
        await this.reports.update(job.id, {state: 'failed', error: input.error.message, finishedAt: input.failedAt})
    }

    /**
     * 每 5 分钟一次，同一时间只在一个实例中执行：删除旧报表
     */
    @Schedule({cron: '*/5 * * * *', exclusive: true})
    public async clean(): Promise<void> {
        const deleted: number = await this.reports.clean()
        this.log.info('%d old reports deleted', deleted)
    }
}
```

一个控制器包含了三种传输方式的动作：HTTP、队列和定时任务。每个请求、每条消息、每次定时执行都会得到一个新的控制器实例，组件已经注入其中（见 [Controllers](../Controllers.md)）。

- `create()` 保存报表，用 `queue.add()` 向队列 `report.build` 添加一条消息，不等报表生成就立即回复：`Result.status()` 发送状态码 202（Accepted）、报表本身，以及指向这份报表的 `Location` 响应头（见 [HTTP](../HTTP.md)）。消息的 `jobId` 就是报表的 id。
- `@QueueAction` 让 `build()` 成为队列 `report.build` 的消费者（见 [Queue](../Queue.md)）。它同时处理 2 条消息（`concurrency`），每条最长 1 分钟（`timeout`：超时后 `this.signal` 被中止，消息会重试）。它的上下文是 `QueueContext`，从中可以知道这是第几次尝试（`attempt`，第一次投递为 1），以及一共允许尝试几次（`attempts`）。
- 动作正常返回时消息被确认，动作的返回值就是这条消息的结果，由队列保存。动作抛出错误时，`build()` 把报表改回 `queued` 状态并记下错误，消息在等待 `backoff`（先 1 秒，再 2 秒）后重新投递，最多尝试 3 次。3 次都失败后，消息进入死信队列 `report.build.dead`，它和普通队列一样：`failed()` 消费其中的消息，把报表标为失败。
- 消息至少投递一次：进程崩溃后，如果使用的是有服务端的驱动，这条消息会再次投递，`build()` 会把同一份报表再生成一遍，这不会造成问题。
- `@Schedule` 按 cron 表达式的时间执行 `clean()`，也就是每 5 分钟一次（见 [Schedules](../Schedules.md)）。设置了 `exclusive: true` 后，每次执行前先尝试从 `mutex` 组件获取锁 `schedule:ReportController:clean`，没拿到锁的实例跳过这一次（见 [Mutex](../Mutex.md)）。

## 6. 服务的选项

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
 * 服务的选项
 * @param port HTTP 服务器的端口，默认取环境变量 PORT，没有时为 8080
 * @param data 报表和锁所在的目录，默认取环境变量 DATA，没有时为 data
 */
export function config(port: number = Number(process.env.PORT ?? 8080), data: string = process.env.DATA ?? 'data'): ApplicationOptions {
    return {
        id: 'reports',
        name: 'reports',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //消息保存在进程的内存中，它们的结果保留一小时
            queue: buildQueueOptions({results: {keep: '1h'}}),
            //锁是文件，同一台机器上的各个服务实例共用
            mutex: {class: Mutex, driver: {type: 'file', directory: path.join(data, 'locks')}},
            //已结束的报表保留一天
            reports: {class: Reports, directory: path.join(data, 'reports'), keep: 24 * 60 * 60 * 1000},
            sales: {class: Sales},
            entrypoint: buildEntrypoints({
                controllers: [HealthController, ReportController],
                http: expressHTTPEntrypoint({
                    port: port,
                    //结果和错误都是 {errno, errMsg, data}，错误保留各自的状态码（400、404 等）
                    respond: jsonEnvelope(),
                    body: {limit: '100mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    middlewares: [authenticate],
                    before: (app): void => void app.use(compression())
                }),
                //把队列的消息投递给 @QueueAction 动作
                queue: queueEntrypoint('queue'),
                //执行 @Schedule 动作
                schedule: scheduleEntrypoint()
            })
        },
        bootstrap: ['entrypoint']
    }
}
```

这是模板中的 `Config.ts`，改动如下：

- 新增 `queue` 组件，由 `buildQueueOptions()` 生成：没有指定 `driver`，所以消息保存在进程的内存中。队列把消息的结果保留一小时（默认一天）：测试会读取其中一个结果，服务本身则从文件中读取报表；
- 新增 `mutex` 组件，使用 `file` 驱动：每把锁是 `data/locks` 中的一个文件，同一台机器上使用这个目录的各个进程共用这些锁；
- 新增本例的 `reports` 和 `sales` 组件，以及它们的选项；
- 用 `ReportController` 替换示例控制器；
- 入口多了两个适配器：`queueEntrypoint('queue')` 把 `queue` 组件的消息投递给 `@QueueAction` 动作，`scheduleEntrypoint()` 执行 `@Schedule` 动作（见 [Entrypoint](../Entrypoint.md)）。没有对应的适配器，装饰器就不起作用；
- `jsonEnvelope()` 不再设置 `errorStatus`，这样错误保留各自的状态码（400、404），这是 REST 客户端所期望的。

`bootstrap: ['entrypoint']` 在启动时创建入口，队列也随之创建：服务启动完成后，动作就开始消费消息。模板中的中间件 `Authenticate.ts` 保留不变：它是 HTTP 适配器的中间件，队列的消息和定时任务的执行都不经过它。

## 7. 运行

在同一台机器上运行两个服务实例，它们共用 `data` 目录：

```bash
npm run dev
```

第一个实例启动后，在第二个终端中运行：

```bash
PORT=8081 npm start
```

在第三个终端中，向第一个实例提交一份报表，再从第二个实例读取：

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

报表由收到请求的第一个实例生成，用时半秒；第二个实例读取的是它写下的文件。

每 5 分钟（:00、:05、:10……）两个实例中会有一个删除旧报表。这次是第一个实例，它在终端中输出：

```
app │ [23:05:00.009] INFO (reports/97338): 0 old reports deleted
```

第二个实例没有拿到锁，跳过了这一次，日志中没有任何输出。这次没有删除任何报表：报表要保留一天。

## 8. 测试

模板中的测试换成了针对报表的测试。它启动服务，把报表和锁放在临时目录中：

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
 * 向服务发一个请求，返回状态码和 {errno, errMsg, data}
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
 * 反复读取一份报表，直到它的任务结束（完成或失败）
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
        //报表和锁放在临时目录中
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
        //任务的结果，由队列保存
        const queue: Queue = await app.getObject<Queue>('queue')
        assert.deepStrictEqual(await queue.result('report.build', created.data.id), {orders: 209, revenue: 7837.5})
        const report = await request('GET', `/reports/${created.data.id}`)
        assert.strictEqual(report.data.state, 'done')
        assert.deepStrictEqual(report.data.result, {orders: 209, revenue: 7837.5})
        assert.strictEqual(report.data.attempts, 1)
    })

    it('retries a job that failed', async (t: TestContext): Promise<void> => {
        const sales: Sales = await app.getObject<Sales>('sales')
        //第一次调用失败，之后的调用执行真正的代码
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
        //直接调用定时任务要做的工作：先用现在的时间，再用明天的时间
        const reports: Reports = await app.getObject<Reports>('reports')
        assert.strictEqual(await reports.clean(new Date()), 0)
        assert.strictEqual(await reports.clean(new Date(Date.now() + 25 * 60 * 60 * 1000)), 3)
    })
})
```

- 第一个测试用 `queue.result()` 读取任务的结果（它会一直等到消息处理完），然后读取报表。
- 为了让任务失败，测试用 `node:test` 的 `t.mock.method()` 替换 `sales` 组件的 `summarize()`：一个测试只替换一次调用，任务在第二次尝试时成功；另一个测试替换所有调用，任务在 3 次尝试后失败，由于有退避等待，这需要 3 秒。组件是共用的，所以动作调用的就是替换后的方法；测试结束时方法会恢复原样。
- 最后一个测试直接调用 `clean()`，模拟明天执行的情形，不必等到 cron 表达式指定的时间。

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

服务会记录每次失败的尝试及其错误：`The queue action ReportController:build failed on the message <id> of report.build (attempt 1 of 3)`。`queueEntrypoint('queue', {onError})` 可以替换这条日志。

## 9. 部署到多台机器

本例的实例都运行在同一台机器上。部署到多台机器时，每个部分换用一个共享的驱动即可，动作的代码不变：

- 队列：内存驱动只在一个进程中保存消息。一个实例只生成它自己收到的报表；它停止时仍在等待的消息会丢失，对应的报表停留在 `queued` 状态，定时任务也不会删除它们。换用 Redis（`driver: {type: 'redis', url: process.env.REDIS_URL}`，并运行 `npm install bullmq ioredis -w app`）后，消息在重启后仍然保留，任何实例都可以处理，结果也由各实例共享（见 [Queue](../Queue.md)）。
- 锁：文件驱动只在一台机器的各进程之间共享。Redis（`driver: {type: 'redis', url}`，并运行 `npm install redis -w app`）或 PostgreSQL 可以在多台机器之间共享锁（见 [Mutex](../Mutex.md)）。
- 报表：放进数据库的一张表（见 [带数据库的 REST API](RestAPI.md)），或者放在一个卷上，每个实例都把它挂载为 `DATA`。

`npm start` 运行构建好的服务，`npm run docker:build` 用模板中的 `Dockerfile` 构建镜像。

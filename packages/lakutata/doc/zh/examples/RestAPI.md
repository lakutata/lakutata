# 带数据库的 REST API

这个示例构建一个管理任务列表的服务：通过 HTTP API 创建任务、分页列出任务、把任务标为已完成以及删除任务，数据保存在 SQLite 数据库中。它从 `service` 模板开始，展示 lakutata 服务中最常用的部分：实体及其迁移、校验输入的 DTO、带 HTTP 状态码的异常、控制器，以及测试。

| 方法 | 路由 | 作用 |
|---|---|---|
| `GET` | `/tasks?done=false&limit=10&offset=0` | 分页列出任务，可以只列已完成或未完成的 |
| `GET` | `/tasks/:id` | 取一个任务 |
| `POST` | `/tasks` | 创建任务：`{"title": "Write the report"}` |
| `PATCH` | `/tasks/:id` | 修改标题，或标为已完成：`{"done": true}` |
| `DELETE` | `/tasks/:id` | 删除任务 |

## 1. 创建项目

```bash
npx @lakutata/cli create --name tasks --template service --yes
cd tasks
npm install better-sqlite3 -w app
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
echo '*.sqlite' >> .gitignore
```

项目是一个工作区，服务在 `packages/app` 中（见 [ProjectStructure](../ProjectStructure.md)）。服务通过 `better-sqlite3` 驱动使用 SQLite，所以要安装这个驱动；[DatabaseDrivers](../DatabaseDrivers.md) 中的其他数据库用法相同，只是驱动和选项不同。这里还删掉了模板中的示例控制器，并让 git 忽略数据库文件。

## 2. 实体

**`packages/app/src/entities/Task.ts`**

```typescript
import {Column, CreateDateColumn, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

/**
 * 一个任务：要做什么，以及是否已经完成
 */
@Entity('tasks')
export class Task {
    @PrimaryGeneratedColumn()
    public id: number

    @Column({type: 'varchar', length: 200})
    public title: string

    @Column({default: false})
    public done: boolean

    @CreateDateColumn()
    public createdAt: Date
}
```

实体是一个类，它的装饰器（来自 `lakutata/decorator/orm`）描述对应的表：`tasks` 表有一个由数据库生成的 id、一个标题、是否已完成，以及创建时间（见 [Entities](../Entities.md)）。

## 3. 输入

**`packages/app/src/dtos/TaskDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'
import {PaginationSearchDTO} from 'lakutata/dtos'

/**
 * 按 id 指定的任务（路由中的 :id 是文本，由 strict(false) 转换）
 */
export class TaskIdDTO extends DTO {
    @Expect(DTO.Number().integer().positive().strict(false).required())
    public id: number
}

/**
 * 新任务
 */
export class CreateTaskDTO extends DTO {
    @Expect(DTO.String().trim().strict(false).min(1).max(200).required())
    public title: string
}

/**
 * 任务的修改
 */
export class UpdateTaskDTO extends TaskIdDTO {
    @Expect(DTO.String().trim().strict(false).min(1).max(200).optional())
    public title?: string

    @Expect(DTO.Boolean().optional())
    public done?: boolean
}

/**
 * 一页任务（limit、offset），可以只取已完成或未完成的
 */
export class TaskSearchDTO extends PaginationSearchDTO {
    @Expect(DTO.Boolean().strict(false).optional())
    public done?: boolean
}
```

每个动作在运行前都会用 DTO 校验输入，不合法的输入会得到 400 错误（见 [DTOValidation](../DTOValidation.md)）：

- HTTP 动作的输入由路由参数、请求体和查询字符串合并而成；
- 路由参数和查询字符串都是文本：`.strict(false)` 把 `'1'` 转换为数字 1，把 `'false'` 转换为布尔值，否则这些规则会拒绝文本；
- 只有加上 `.strict(false)`，`.trim()` 才会去掉标题首尾的空格；严格模式下的规则会直接拒绝这样的标题；
- `TaskSearchDTO` 继承自 `PaginationSearchDTO`（来自 `lakutata/dtos`），用它的 `limit`（默认 10）和 `offset`（默认 0）选择一页。

## 4. 异常

**`packages/app/src/exceptions/TaskNotFoundException.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * 请求的任务不存在
 */
export class TaskNotFoundException extends Exception {
    public errno: string = 'E_TASK_NOT_FOUND'

    public readonly statusCode: number = 404
}
```

异常有一个 `errno`，客户端用它判断是哪种错误；还有回复这个错误时使用的 HTTP 状态码（见 [Exceptions](../Exceptions.md)）。异常的消息在抛出时给出。

## 5. 控制器

**`packages/app/src/controllers/TaskController.ts`**

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {type Database} from 'lakutata/com/database'
import {DELETE, GET, PATCH, POST, Prefix} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {type PaginationResultDTO, paginator} from 'lakutata/dtos'
import {type Repository} from 'lakutata/orm'
import {Task} from '../entities/Task.js'
import {CreateTaskDTO, TaskIdDTO, TaskSearchDTO, UpdateTaskDTO} from '../dtos/TaskDTO.js'
import {TaskNotFoundException} from '../exceptions/TaskNotFoundException.js'

@Prefix({route: '/tasks'})
export class TaskController extends Controller {

    /**
     * 服务的数据库（选项中的 "database" 组件）
     */
    @Inject('database')
    protected readonly database: Database

    /**
     * 数据库中的任务
     */
    protected get tasks(): Repository<Task> {
        return this.database.getRepository(Task)
    }

    /**
     * 取一个任务，不存在时抛出 404 错误
     * @param id
     */
    protected async find(id: number): Promise<Task> {
        const task: Task | null = await this.tasks.findOneBy({id: id})
        if (!task) throw new TaskNotFoundException(`The task ${id} does not exist`)
        return task
    }

    /**
     * GET /tasks?done=false&limit=10&offset=0
     * @param input
     */
    @GET('/', TaskSearchDTO)
    public async list(input: TaskSearchDTO): Promise<PaginationResultDTO<Task>> {
        return await paginator(input, async (limit: number, offset: number) => {
            const [items, total] = await this.tasks.findAndCount({
                where: input.done === undefined ? {} : {done: input.done},
                order: {id: 'ASC'},
                take: limit,
                skip: offset
            })
            return {items: items, total: total}
        })
    }

    /**
     * GET /tasks/1
     * @param input
     */
    @GET('/:id', TaskIdDTO)
    public async get(input: TaskIdDTO): Promise<Task> {
        return await this.find(input.id)
    }

    /**
     * POST /tasks {"title": "Write the report"}
     * @param input
     */
    @POST('/', CreateTaskDTO)
    public async create(input: CreateTaskDTO): Promise<Task> {
        return await this.tasks.save(this.tasks.create({title: input.title}))
    }

    /**
     * PATCH /tasks/1 {"done": true}
     * @param input
     */
    @PATCH('/:id', UpdateTaskDTO)
    public async update(input: UpdateTaskDTO): Promise<Task> {
        const task: Task = await this.find(input.id)
        if (input.title !== undefined) task.title = input.title
        if (input.done !== undefined) task.done = input.done
        return await this.tasks.save(task)
    }

    /**
     * DELETE /tasks/1
     * @param input
     */
    @DELETE('/:id', TaskIdDTO)
    public async remove(input: TaskIdDTO): Promise<void> {
        await this.tasks.remove(await this.find(input.id))
    }
}
```

- `@Prefix({route: '/tasks'})` 把控制器的路由放在 `/tasks` 之下；每个动作有自己的 HTTP 方法、路由和 DTO（见 [HTTP](../HTTP.md)）。
- `@Inject('database')` 把服务的 `database` 组件交给控制器：这是一个 TypeORM 连接，通过它的仓储读写实体（见 [Database](../Database.md)）。
- `paginator()`（来自 `lakutata/dtos`）构建一页结果：其中的条目，以及 `meta`，包括条目数、总数、limit 和 offset。
- 动作返回的值就是结果；抛出的异常就是这个请求的错误。

## 6. 服务的选项

**`packages/app/src/config/Config.ts`**

```typescript
import path from 'node:path'
import type {ApplicationOptions} from 'lakutata'
import {buildDatabaseOptions} from 'lakutata/com/database'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'
import compression from 'compression'
import {authenticate} from '../middlewares/Authenticate.js'
import {HealthController} from '../controllers/HealthController.js'
import {TaskController} from '../controllers/TaskController.js'
import {Task} from '../entities/Task.js'

/**
 * 服务的选项
 * @param port HTTP 服务器的端口，默认取环境变量 PORT，没有时为 8080
 * @param database SQLite 数据库文件，默认取环境变量 DATABASE，没有时为 tasks.sqlite（":memory:" 表示内存中的数据库）
 */
export function config(port: number = Number(process.env.PORT ?? 8080), database: string = process.env.DATABASE ?? 'tasks.sqlite'): ApplicationOptions {
    return {
        id: 'tasks',
        name: 'tasks',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            database: buildDatabaseOptions({
                type: 'better-sqlite3',
                database: database,
                entities: [Task],
                //随服务一起编译的迁移（build/migrations），连接数据库时运行
                migrations: [path.join(import.meta.dirname, '..', 'migrations', '*.js')],
                migrationsRun: true
            }),
            entrypoint: buildEntrypoints({
                controllers: [HealthController, TaskController],
                http: expressHTTPEntrypoint({
                    port: port,
                    //结果和错误都是 {errno, errMsg, data}，错误保留各自的状态码（400、404 等）
                    respond: jsonEnvelope(),
                    body: {limit: '1mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    middlewares: [authenticate],
                    before: (app): void => void app.use(compression())
                })
            })
        },
        //先连接数据库（并运行迁移），再让 HTTP 服务器开始监听
        bootstrap: ['database', 'entrypoint']
    }
}
```

这是模板中的 `Config.ts`，改动如下：

- 新增 `database` 组件：SQLite 数据库文件（服务运行目录下的 `tasks.sqlite`，或者环境变量 `DATABASE` 指定的文件）、它的实体，以及连接时运行的迁移；
- 用 `TaskController` 替换示例控制器；
- `jsonEnvelope()` 不再设置 `errorStatus`：结果和错误都是 `{errno, errMsg, data}`，错误保留各自的状态码（400、401、404），这是 REST 客户端所期望的；
- 请求体最多 1 MB（模板允许 100 MB），对任务来说足够了；
- `bootstrap: ['database', 'entrypoint']`：先连接数据库并运行迁移，再让 HTTP 服务器开始监听。

模板中的中间件 `Authenticate.ts` 保留不变：设置了环境变量 `API_TOKEN` 时，请求必须带上 `Authorization: Bearer <API_TOKEN>`。

## 7. 迁移

表由迁移创建，迁移根据实体生成：

```bash
npm run migration:generate
```

```
✔ Migrations generated: packages/app/src/migrations/1792247417843-database.ts
```

这个命令会构建并启动服务，把实体和数据库对比，然后写出迁移（文件名中带有生成的时间）：

```typescript
import { MigrationInterface, QueryRunner } from "lakutata/orm";

export class Migrations1792247417843 implements MigrationInterface {
    name = 'Migrations1792247417843'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "tasks" (
                "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                "title" varchar(200) NOT NULL,
                "done" boolean NOT NULL DEFAULT (0),
                "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP TABLE "tasks"
        `);
    }

}
```

迁移和服务一起编译。服务连接的数据库还没运行过这个迁移时，就会运行它。实体改动后，用同样的方法生成下一个迁移（见 [Migrations](../Migrations.md)）。

## 8. 运行

```bash
npm run dev
```

在另一个终端中：

```bash
curl -X POST localhost:8080/tasks -H 'Content-Type: application/json' -d '{"title": "Write the report"}'
# {"errno":null,"errMsg":null,"data":{"title":"Write the report","id":1,"done":false,"createdAt":"2026-10-17T14:33:07.000Z"}}

curl -X POST localhost:8080/tasks -H 'Content-Type: application/json' -d '{"title": "Book the room"}'
curl -X PATCH localhost:8080/tasks/1 -H 'Content-Type: application/json' -d '{"done": true}'

curl 'localhost:8080/tasks?done=false&limit=5'
# {"errno":null,"errMsg":null,"data":{"items":[{"id":2,"title":"Book the room","done":false,"createdAt":"2026-10-17T14:33:07.000Z"}],"meta":{"count":1,"total":1,"limit":5,"offset":0}}}

curl -i localhost:8080/tasks/9
# HTTP/1.1 404 Not Found
# {"errno":"E_TASK_NOT_FOUND","errMsg":"The task 9 does not exist","data":null}

curl -i -X POST localhost:8080/tasks -H 'Content-Type: application/json' -d '{"title": ""}'
# HTTP/1.1 400 Bad Request
# {"errno":"E_INVALID_VALUE","errMsg":"\"title\" is not allowed to be empty","data":null}
```

## 9. 测试

模板中的测试换成了针对任务的测试。它用内存中的数据库启动服务（启动时运行迁移），然后调用各个路由：

**`packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Application} from 'lakutata'
import {config} from '../config/Config.js'

const PORT: number = Number(process.env.TEST_PORT ?? 18081)

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

describe('tasks', (): void => {

    let app: Application

    before(async (): Promise<void> => {
        process.env.API_TOKEN = 'test-token'
        //内存中的数据库，服务启动时运行迁移
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config(PORT, ':memory:')).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
    })

    it('answers the health check without authentication', async (): Promise<void> => {
        assert.deepStrictEqual(await (await fetch(`http://127.0.0.1:${PORT}/health`)).json(), {errno: null, errMsg: null, data: {status: 'ok'}})
    })

    it('refuses the requests without authentication', async (): Promise<void> => {
        const response: Response = await fetch(`http://127.0.0.1:${PORT}/tasks`)
        assert.strictEqual(response.status, 401)
    })

    it('creates, lists, updates and deletes the tasks', async (): Promise<void> => {
        const created = await request('POST', '/tasks', {title: 'Write the report'})
        assert.strictEqual(created.status, 200)
        assert.strictEqual(created.data.title, 'Write the report')
        assert.strictEqual(created.data.done, false)
        await request('POST', '/tasks', {title: 'Book the room'})
        const updated = await request('PATCH', `/tasks/${created.data.id}`, {done: true})
        assert.strictEqual(updated.data.done, true)
        const open = await request('GET', '/tasks?done=false&limit=5')
        assert.deepStrictEqual(open.data.items.map((task: { title: string }): string => task.title), ['Book the room'])
        assert.deepStrictEqual(open.data.meta, {count: 1, total: 1, limit: 5, offset: 0})
        assert.strictEqual((await request('DELETE', `/tasks/${created.data.id}`)).status, 200)
        const missing = await request('GET', `/tasks/${created.data.id}`)
        assert.strictEqual(missing.status, 404)
        assert.strictEqual(missing.errno, 'E_TASK_NOT_FOUND')
    })

    it('refuses an invalid task', async (): Promise<void> => {
        const invalid = await request('POST', '/tasks', {title: ''})
        assert.strictEqual(invalid.status, 400)
        assert.strictEqual(invalid.errno, 'E_INVALID_VALUE')
    })
})
```

```bash
npm test
```

```
app │   ✔ answers the health check without authentication
app │   ✔ refuses the requests without authentication
app │   ✔ creates, lists, updates and deletes the tasks
app │   ✔ refuses an invalid task
app │ ℹ pass 4
✔ test ran in app
```

## 10. 在生产环境中

- `npm start` 运行构建好的服务（`NODE_ENV=production` 决定它的模式），`npm run docker:build` 用模板中的 `Dockerfile` 构建镜像。请把 `DATABASE` 指向卷上的路径，这样容器重建后任务数据仍然保留。
- 模板的 `installer` 功能（`lakutata create --with installer`）可以制作安装包，让服务随系统启动（见 [Installers](../Installers.md)）。
- 换用其他数据库，就是换一个驱动和 `buildDatabaseOptions()` 的选项；迁移要针对那个数据库生成。

# A REST API with a database

This example builds a service that keeps a list of tasks: an HTTP API to create tasks, list them a page at a time,
mark them done and delete them, stored in a SQLite database. It starts from the `service` template and shows the
everyday parts of a lakutata service: an entity and its migration, the DTOs that validate the input, an exception with
its HTTP status, a controller, and the tests.

| Method | Route | What it does |
|---|---|---|
| `GET` | `/tasks?done=false&limit=10&offset=0` | Lists the tasks, a page at a time, the done ones or the others |
| `GET` | `/tasks/:id` | Gives a task |
| `POST` | `/tasks` | Creates a task: `{"title": "Write the report"}` |
| `PATCH` | `/tasks/:id` | Changes its title or marks it done: `{"done": true}` |
| `DELETE` | `/tasks/:id` | Deletes it |

## 1. Create the project

```bash
npx @lakutata/cli create --name tasks --template service --yes
cd tasks
npm install better-sqlite3 -w app
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
echo '*.sqlite' >> .gitignore
```

The project is a workspace whose service is `packages/app` ([ProjectStructure](../ProjectStructure.md)). The service
uses SQLite through the `better-sqlite3` driver, installed here; any other database of
[DatabaseDrivers](../DatabaseDrivers.md) works the same, with its own driver and options. The example controller of the
template is removed, and the database file is kept out of git.

## 2. The entity

**`packages/app/src/entities/Task.ts`**

```typescript
import {Column, CreateDateColumn, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

/**
 * A task: what to do, and whether it is done
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

An entity is a class whose decorators (from `lakutata/decorator/orm`) describe its table: `tasks`, with an id given by
the database, a title, whether it is done, and the date it was created on ([Entities](../Entities.md)).

## 3. The input

**`packages/app/src/dtos/TaskDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'
import {PaginationSearchDTO} from 'lakutata/dtos'

/**
 * A task by its id (the :id of the route: text, converted by strict(false))
 */
export class TaskIdDTO extends DTO {
    @Expect(DTO.Number().integer().positive().strict(false).required())
    public id: number
}

/**
 * A new task
 */
export class CreateTaskDTO extends DTO {
    @Expect(DTO.String().trim().strict(false).min(1).max(200).required())
    public title: string
}

/**
 * The changes of a task
 */
export class UpdateTaskDTO extends TaskIdDTO {
    @Expect(DTO.String().trim().strict(false).min(1).max(200).optional())
    public title?: string

    @Expect(DTO.Boolean().optional())
    public done?: boolean
}

/**
 * A page of the tasks (limit, offset), the done ones or the others
 */
export class TaskSearchDTO extends PaginationSearchDTO {
    @Expect(DTO.Boolean().strict(false).optional())
    public done?: boolean
}
```

Each action validates its input with a DTO before it runs, and refuses invalid input with a 400 error
([DTOValidation](../DTOValidation.md)):

- the input of an HTTP action merges the route parameters, the body and the query string;
- the route parameters and the query string are text: `.strict(false)` converts `'1'` to the number 1 and `'false'` to
  the boolean, which the schemas otherwise refuse;
- `.trim()` removes the spaces around the title only with `.strict(false)`: a strict schema refuses them instead;
- `TaskSearchDTO` extends `PaginationSearchDTO` (from `lakutata/dtos`), whose `limit` (10 by default) and `offset` (0)
  select a page.

## 4. The exception

**`packages/app/src/exceptions/TaskNotFoundException.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * The task of the request does not exist
 */
export class TaskNotFoundException extends Exception {
    public errno: string = 'E_TASK_NOT_FOUND'

    public readonly statusCode: number = 404
}
```

An exception has an `errno`, the code that clients test, and the HTTP status it is answered with
([Exceptions](../Exceptions.md)). Its message is given when it is thrown.

## 5. The controller

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
     * The database of the service (the component "database" of its options)
     */
    @Inject('database')
    protected readonly database: Database

    /**
     * The tasks of the database
     */
    protected get tasks(): Repository<Task> {
        return this.database.getRepository(Task)
    }

    /**
     * A task, or a 404 error
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

- `@Prefix({route: '/tasks'})` puts the routes of the controller under `/tasks`; each action has its verb, its route
  and its DTO ([HTTP](../HTTP.md)).
- `@Inject('database')` gives the controller the `database` component of the service: a TypeORM connection, whose
  repositories read and write the entities ([Database](../Database.md)).
- `paginator()` (from `lakutata/dtos`) builds the page: the items, and `meta` with their count, the total, the limit
  and the offset.
- An action returns its result; a thrown exception is the error of the request.

## 6. The options of the service

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
 * The options of the service
 * @param port the port of the HTTP server, the PORT environment variable or 8080 by default
 * @param database the file of the SQLite database, the DATABASE environment variable or tasks.sqlite by default
 * (":memory:" for a database in memory)
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
                //The migrations compiled with the service (build/migrations), run when it connects
                migrations: [path.join(import.meta.dirname, '..', 'migrations', '*.js')],
                migrationsRun: true
            }),
            entrypoint: buildEntrypoints({
                controllers: [HealthController, TaskController],
                http: expressHTTPEntrypoint({
                    port: port,
                    //The results and the errors are {errno, errMsg, data}; the errors keep their status (400, 404…)
                    respond: jsonEnvelope(),
                    body: {limit: '1mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    middlewares: [authenticate],
                    before: (app): void => void app.use(compression())
                })
            })
        },
        //The database is connected (and migrated) before the HTTP server listens
        bootstrap: ['database', 'entrypoint']
    }
}
```

This is the `Config.ts` of the template, with:

- the `database` component: the SQLite file (`tasks.sqlite` in the directory the service runs in, or the `DATABASE`
  environment variable), its entities, and its migrations, run when it connects;
- the `TaskController` instead of the example controller;
- `jsonEnvelope()` without `errorStatus`: the results and the errors are `{errno, errMsg, data}`, and the errors keep
  their status (400, 401, 404), which REST clients expect;
- a body of 1 MB at most (the template allows 100 MB), more than a task needs;
- `bootstrap: ['database', 'entrypoint']`: the database is connected and migrated before the HTTP server listens.

The template's middleware `Authenticate.ts` stays: when the `API_TOKEN` environment variable is set, the requests must
carry `Authorization: Bearer <API_TOKEN>`.

## 7. The migration

The table is created by a migration, generated from the entities:

```bash
npm run migration:generate
```

```
✔ Migrations generated: packages/app/src/migrations/1792247417843-database.ts
```

The command builds and starts the service, compares its entities with the database, and writes the migration (its
name holds the time it is generated):

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

It is compiled with the service, and run when the service connects to a database that has not run it. After a change
of the entities, generate the next one the same way ([Migrations](../Migrations.md)).

## 8. Run it

```bash
npm run dev
```

In another terminal:

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

## 9. Test it

The test of the template is replaced by a test of the tasks. It starts the service with a database in memory, migrated
when it starts, and calls its routes:

**`packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Application} from 'lakutata'
import {config} from '../config/Config.js'

const PORT: number = Number(process.env.TEST_PORT ?? 18081)

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

describe('tasks', (): void => {

    let app: Application

    before(async (): Promise<void> => {
        process.env.API_TOKEN = 'test-token'
        //A database in memory, migrated when the service starts
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

## 10. In production

- `npm start` runs the built service (`NODE_ENV=production` sets its mode), and `npm run docker:build` makes its image
  (the template's `Dockerfile`). Give `DATABASE` a path on a volume, so that the tasks outlive the container.
- The `installer` feature of the template (`lakutata create --with installer`) makes installers that run the service at
  the start of the system ([Installers](../Installers.md)).
- Another database is another driver and other options of `buildDatabaseOptions()`; generate the migrations against
  it.

<!--
check:
  create: tasks service
  remove: packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
  run: npm run migration:generate
  run: npm test
-->

# 从 Lakutata 1.x 升级

Lakutata 1.x 是一组包：`@lakutata/core` 1.x、模块 `@lakutata-module/*`（`service`、`api`）、组件 `@lakutata-component/*`（`typeorm`、`cacher` 等）以及 `@lakutata/cli` 1.0。Lakutata 3 是 API 完全不同的另一个框架，所以 1.x 项目要移植到 3.x，而不是原地升级。本页说明移植的方法，以及 1.x 的各个部分在 3.x 中对应什么。

本页只适用于依赖 1.x 版本 `@lakutata/core` 的项目。依赖 `lakutata` 包 2.x 版本的项目请看 [UpgradingFrom2](UpgradingFrom2.md)，不要按本页升级。本页涉及的 1.x 包是 npm 上发布的版本（`@lakutata/core` 1.0.60、`@lakutata-module/service` 1.2.7、`@lakutata-module/api` 1.0.29、`@lakutata-component/typeorm` 1.1.19、`@lakutata-component/cacher` 1.0.15、`@lakutata/cli` 1.0.37）；从其他地方获得的这些包的构建版本，可能有本页没有涉及的 API。

## 1. 识别 1.x 项目

| 特征 | 1.x | 3.x |
|---|---|---|
| 依赖 | `@lakutata/core` `^1…`、`@lakutata-module/service`、`@lakutata-component/*` | `lakutata` `^3…` |
| `src/App.ts` | `createApp(Config(true)).then(…)` | `Application.run(config)` |
| 模块系统 | CommonJS：导入不带扩展名，使用 `__dirname` | ES 模块：相对导入以 `.js` 结尾 |
| 服务动作 | `@lakutata-module/service` 的 `@Controller({_ctrl: …})` 和 `@PATTERN({_act: …})` | `lakutata/decorator/ctrl` 的 `@ServiceAction({…})` |
| 校验 | 交给 `@Accept` 的 `Validator` schema（yup） | 带 `@Expect` 的 DTO 类 |
| Node.js | `>=14.15.1`（`@lakutata/core` 1.0.60） | `^22.13.0 \|\| >=24.11.0` |

**3.x 的 `@lakutata/core` 不是 1.x 那个库的新版本。** 它是 Lakutata 3 的核心，只是用了同一个名字，API 完全不同。在 1.x 项目中执行 `npm install @lakutata/core@latest`，或者使用 `*` 这样的版本范围，都会用它替换 1.x 的核心库，导致构建失败。不要逐个升级 1.x 的包：移植后的应用依赖 `lakutata` 3，它会带来自己的 `@lakutata/core`。

## 2. 移植的方法

1. **创建一个 3.x 项目**，放在 1.x 项目旁边，选用与它同类的模板：服务或网关用 `service`（带 HTTP API、健康检查和 `Dockerfile`），命令行工具用 `cli`（见 [GettingStarted](GettingStarted.md)）：

   ```bash
   npx @lakutata/cli create --name orders --template service
   ```

2. **逐个部分移植**，每移植一部分就构建和测试一次：数据库及其实体（第 8 节）、作为 DTO 的输入（第 7 节）、组件（第 3 节）、服务动作及其调用方（第 5 节）、HTTP API（第 6 节）、配置（第 9 节）、测试（第 10 节）。
3. **保持对客户端的约定不变**：服务动作的模式及其中的键、`errno` 错误码、HTTP 路由及其响应的格式、事件的名称。这样调用方、用户界面和设备都不需要随移植而改动。
4. **规划各个服务的移植顺序。** 1.x 的服务模块和 3.x 的服务传输方式互不相通：3.x 服务既不能响应 1.x 服务的 `invoke()`，也不能调用 1.x 服务。请把互相调用的服务一起移植，或者保留一个 1.x 服务作为桥梁，直到它的调用方都移植完成。

直接修改 1.x 项目是行不通的：模块系统、容器、校验和传输方式全都同时改变了。

## 3. 应用及其对象

见 [Application](Application.md)、[Objects](Objects.md) 和 [Injection](Injection.md)。

| 1.x | 3.x |
|---|---|
| `createApp(Config(isProd))`，返回应用的 promise | `Application.run(config).onLaunched(…)` |
| 选项 `id`、`name`、`timezone`、`components: {name: {class, …}}` | 同样的选项 |
| `modules: {name: {class, …}}` | `components`：长期存在的对象就是 `Component` |
| `plugins: [{class, scope, …}]`，通过 `app.<类名>` 访问 | `providers`（共享的客户端用 `@Singleton()`）或 `components`，按名字注入 |
| `processes`、`threads`、`workflows`、`onModulesLoaded`、`onComponentsLoaded` | 没有对应项：使用 `bootstrap` 步骤，并在组件中使用 Node.js 的 `child_process` 或 `worker_threads` |
| `initialize()` | `init()`；3.x 新增了销毁时运行的 `destroy()` |
| 组件中的 `app.on('ready', …)` | 组件的 `launched()` 钩子，或者应用的 `onLaunched` |
| `@Inject('name')`、`@Inject(Application)` | 相同，来自 `lakutata/decorator/di` |
| `app.Components.get<T>('name')`、`app.Modules.service`，以及为它们声明类型的 `declare module` | 在带类型的属性上使用 `@Inject('name')`；在对象之外使用 `await app.getObject<T>('name')`；不再需要类型扩充 |
| `@Configurable()` | `@Configurable(schema)`：启动时用 schema 校验选项（不给 schema 时接受任何值） |
| 全局的 `getApp()` | `@Inject(Application)` |
| 测试中的 `new SomeComponent()` | 不要这样做：使用 `await new Container().set(SomeComponent, options)` |
| `app.Logger.info`、`.warning`、`.error`、`.debug` 等（winston） | `@Inject('log')` 注入 `ILogger`：`info`、`warn`、`error`、`debug`、`trace`（`emerg`、`alert`、`crit` 改为 `error`，`notice` 改为 `info`） |
| `app.Security.MD5()`、`SHA1()`、`SHA256()` | `lakutata/utils` 中的 `md5()`、`sha1()`、`sha256()`，它们返回 `Buffer`（用 `.toString('hex')` 转换）；带密钥时使用 `lakutata/security` 中的 `hmac()` |
| `app.Security.generateRandomString()` | `lakutata/utils` 中的 `randomString()` |
| `app.Security.encryptByPassword()`、`encryptByKey()` 及对应的 `decrypt…` | `lakutata/security` 中的同名函数（见 [Security](Security.md)） |
| `app.Security.generatePasswordHash()`、`validatePassword()` | `lakutata/provider/passwordHash` 中的 `PasswordHash` provider |
| `app.Formatter.asTimestamp()`、`asDateText()` | `lakutata` 中的 `Time`（见 [Time](Time.md)） |
| `app.JSON`、`app.MessagePack`、`app.HttpRequest`、`app.Shell` | `JSON`、`lakutata/utils` 中的 `MessagePack`、`fetch()`、Node.js 的 `child_process` |
| `delay()` | `lakutata/utils` 中的 `delay()` |
| 用 `app.emit()`、`app.on()` 作为事件总线 | 组件本身就是事件发射器：注入它，使用它的 `emit()` 和 `on()` |
| `throw this.generateException(OrderNotFoundException, 'Order', 'not found')` | `throw new OrderNotFoundException('Order {id} not found', {id})`；异常不再有 `district` |

一个 1.x 组件：

```text
//1.x
export class OrderComponent extends Component {
    @Inject(Application) protected readonly app: Application
    @Inject('db') protected readonly db: TypeOrmComponent
    @Configurable() protected readonly keepDays: number = 30

    protected async initialize(): Promise<void> {
        this.app.on('ready', () => this.startCleanup())
    }
}
```

在 3.x 中，同一个组件：

```typescript
import {Component, DTO, Exception, type ILogger} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'
import type {Database} from 'lakutata/com/database'

export class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'

    public readonly statusCode: number = 404
}

export class Orders extends Component {
    @Inject('db')
    protected readonly db: Database

    @Inject('log')
    protected readonly log: ILogger

    @Configurable(DTO.Number().integer().min(1))
    protected readonly keepDays: number = 30

    protected timer: NodeJS.Timeout

    //应用启动完成之后（1.x 中是 app.on('ready')）
    protected async launched(): Promise<void> {
        this.timer = setInterval((): void => this.log.info('Keeping %d days of orders', this.keepDays), 3600000)
    }

    protected async destroy(): Promise<void> {
        clearInterval(this.timer)
    }

    public async get(id: string): Promise<Record<string, unknown>> {
        const rows: Record<string, unknown>[] = await this.db.query('SELECT * FROM orders WHERE id = ?', [id])
        if (!rows.length) throw new OrderNotFoundException('Order {id} not found', {id: id})
        return rows[0]
    }
}
```

- 异常的 `errno` 保持不变，所以检查它的客户端照常工作。3.x 新增了 `statusCode`，即错误的 HTTP 状态码，并用模板生成错误消息（见 [Exceptions](Exceptions.md)）。
- 同一个类仍然可以用不同的名字、不同的选项声明多次（多个缓存、两个 HTTP 服务器）：每个声明都是独立的实例，按名字注入。

## 4. 包的对应关系

| 1.x | 3.x |
|---|---|
| `@lakutata/core` 1.x | `lakutata`：`lakutata`、`lakutata/decorator/di`、`lakutata/decorator/dto`、`lakutata/utils` |
| `@lakutata-module/service` | `lakutata/com/entrypoint`（`@ServiceAction` 和服务传输方式）、`@lakutata/nats`（第 5 节） |
| `@lakutata-module/api` | `lakutata/adapter/express` 或 `lakutata/adapter/fastify`，配合 `@GET`、`@POST` 等（第 6 节） |
| `@lakutata-component/typeorm` | `lakutata/com/database`、`lakutata/orm`、`lakutata/decorator/orm`（第 8 节） |
| `@lakutata-component/cacher` | `lakutata/com/cacher`（第 8 节） |
| `@lakutata/cli` 1.0（`lakutata`、`lakutata-deploy`） | `@lakutata/cli` 3：`lakutata create`、`run`、`migration`、`package` 等（见 [Command](Command.md)）；没有部署命令 |
| 其他 `@lakutata-component/*` 包 | 没有对应项：在应用中自行实现它们的功能，或者改用其他库 |

只能从这些子路径导入：3.x 不支持从包内部的文件导入（1.x 项目有时会从包的 `/distro/…`、`/src/…` 或 `/build/…` 导入）。

## 5. 服务调用

在 1.x 中，每个应用都有一个 `service` 模块：它把自己的控制器注册到一个注册中心应用（基于 Redis），用 `invoke({serviceId, data, timeout})` 调用其他应用的动作；它的通道（channel）在服务之间传递事件。3.x 没有注册中心应用：`entrypoint` 组件通过某种传输方式提供服务动作，由代理调用它们（见 [ServiceCalls](ServiceCalls.md)）：

- **NATS**（见 [NATS](NATS.md)）最接近 1.x 的模型：各个服务共用一个 NATS 服务器，按应用 id（相当于 1.x 的 `serviceId`）互相寻址，调用在一个服务的多个实例之间分摊，并且可以发布事件。它的 `ServiceProxy` 调用其他服务；NATS 服务器取代了注册中心应用。
- **HTTP 服务**配合 `HTTPServiceProxy`，或者 **gRPC**（见 [GRPC](GRPC.md)），按已知的地址调用服务。

1.x 服务模块中的一个控制器：

```text
//1.x
@Controller({_ctrl: 'order'})
export class OrderController extends BaseController {
    @Inject('order') protected readonly order: OrderComponent

    @PATTERN({_act: 'get'})
    @Accept(TGetOrderOptionsSchema)
    public async get(inp: TPattern & TGetOrderOptions): Promise<IOrder> {
        return await this.order.get(inp.id)
    }
}
```

在 3.x 中，同样的动作通过 NATS 提供，并用一个代理调用另一个服务：

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {Prefix, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {buildNatsClientOptions, buildServiceProxy, natsServiceEntrypoint} from '@lakutata/nats'

class GetOrderDTO extends DTO {
    @Expect(DTO.String().required())
    public id: string
}

//模式中的键可以任意取：调用方仍然发送 {_ctrl: 'order', _act: 'get', id}
@Prefix({pattern: {_ctrl: 'order'}})
class OrderController extends Controller {
    @ServiceAction({_act: 'get'}, GetOrderDTO)
    public async get(input: GetOrderDTO): Promise<{ id: string }> {
        return {id: input.id}
    }
}

Application.run(() => ({
    //其他服务调用时使用的 id：即 1.x 的 serviceId
    id: 'orders.app',
    name: 'orders',
    components: {
        nats: buildNatsClientOptions({servers: process.env.NATS_URL ?? 'nats://127.0.0.1:4222'}),
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            service: natsServiceEntrypoint('nats')
        })
    },
    providers: {
        //另一个服务：await this.users.invoke({_ctrl: 'user', _act: 'get', id}, 30000)
        users: buildServiceProxy({natsComponentName: 'nats', serviceId: 'users.app'})
    },
    bootstrap: ['nats', 'entrypoint']
}))
```

- **模式。** `@Prefix({pattern})` 加上 `@ServiceAction` 取代 `@Controller` 加上 `@PATTERN`，使用同样的键，所以调用方发送的消息不需要改变（用 `_action` 代替 `_act` 也一样）。模式中额外的键仍然会选中不同的动作：`{_act: 'query', batch: true}` 和 `{_act: 'query', batch: false}` 是两个动作。前缀和动作给同一个键设置不同的值时，3.x 会报错（1.x 中以控制器的值为准）。
- **输入。** 动作收到的消息中不含它的模式中的键：原来读取 `inp.batch` 或 `inp._act` 的方法，要改为从完整的消息 `this.context.input` 中读取。网关给每条消息加上的字段（用户的 id、组织的 id）仍然作为 DTO 的普通字段，或者改由中间件处理（见 [Middlewares](Middlewares.md)）。
- **调用。** `this.app.Modules.service.invoke({serviceId, data, timeout})` 改为对注入的代理调用 `this.users.invoke(message, timeout)`。动作失败时抛出 `ServiceInvokeException`，它带有远端错误的 `errno` 和其他属性。`transform` 选项和由多个调用对象组成的调用链没有对应项：请用代码实现；`service.parallel(…)` 改为对多个调用使用 `Promise.all()`。1.x 的调用默认等待 60 秒，3.x 的代理默认等待 10 分钟：请给调用指定超时时间。
- **事件。** 通道的 `triggerAll(event, …args)` 改为 NATS 组件的 `nats.emitServiceEvent(event, …args)`，每个实例都通过 `proxy.on(event, listener)` 或 `nats.onServiceEvent(serviceId, event, listener)` 接收。`triggerOne` 的效果是每个服务只有一个实例收到事件：请发布到自己的主题上（`nats.publish(subject, payload)`），并以服务的 id 作为队列组订阅（`nats.subscribe(subject, handler, {queue: app.appId})`），同一个服务的各个实例共用这个队列组。
- **由多个实例分担的工作。** 必须由服务的某一个实例处理的工作（例如处理一个数据流），适合使用消息队列（见 [Queue](Queue.md)）：同一个组的各个实例分摊队列中的消息，并支持重试。
- **时钟服务。** 原来向其他服务发布定时信号的应用，改为在每个服务中使用 `@Schedule`；只能在一个实例中运行的任务加上 `exclusive`（见 [Schedules](Schedules.md)）。

## 6. HTTP API

1.x 的 `api` 模块改为入口的 HTTP 适配器 `expressHTTPEntrypoint()` 或 `fastifyHTTPEntrypoint()`（见 [HTTP](HTTP.md)）。一个路由就是一个带 `@GET`、`@POST` 等装饰器的控制器方法；它的输入是一个对象：查询参数和请求体，路由参数覆盖在它们之上，由它的 DTO 校验。1.x 的参数装饰器（请求体、查询参数、某个请求头、请求和响应）由 DTO 和 `this.context` 取代，后者是带有 `request` 和 `response` 的 `HTTPContext`。

只要响应保持原来的格式，客户端就能照常工作。自定义的响应器按 1.x 客户端期望的格式写出响应，例如 `{code, payload}`，结果的 `code` 为 0：

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller, HTTPContext} from 'lakutata/com/entrypoint'
import {POST} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {describeError, expressHTTPEntrypoint, statusOfError, type ExpressResponder} from 'lakutata/adapter/express'
import type {Request, Response} from 'express'

//按 1.x 客户端读取的格式响应：结果为 {code: 0, payload}，错误的 code 不为 0
const legacyEnvelope: ExpressResponder = {
    success(response: Response, data: unknown): void {
        response.status(200).json({code: 0, payload: data ?? null})
    },
    error(response: Response, error: unknown): void {
        response.status(statusOfError(error)).json({code: 1, payload: describeError(error)})
    }
}

class QueryDTO extends DTO {
    @Expect(DTO.String().required())
    public method: string
}

class RpcController extends Controller {
    //POST /rpc?method=order.get，带 JSON 请求体
    @POST('/rpc', QueryDTO)
    public async call(input: QueryDTO): Promise<{ method: string, token?: string }> {
        //从上下文的请求中读取一个请求头
        const request: Request = (this.context as HTTPContext).request as Request
        return {method: input.method, token: request.header('x-token')}
    }
}

Application.run(() => ({
    id: 'gateway.app',
    name: 'gateway',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [RpcController],
            http: expressHTTPEntrypoint({port: 8080, respond: legacyEnvelope})
        })
    },
    bootstrap: ['entrypoint']
}))
```

- `statusOfError()` 和 `describeError()` 给出适配器本来会发送的状态码和 `{errno, errMsg}`；响应器决定响应的格式。1.x 的 `api` 模块的响应是 `{statusCode, code, error, payload, timestamp, server}`（或者经它的 `responseFormatter` 处理后的格式）：请写出客户端读取的那些字段。`jsonEnvelope()` 给出的则是 3.x 的封套 `{errno, errMsg, data}`。
- `api` 模块允许任何来源的跨域请求（CORS），并对响应签名（`x-signature` 系列响应头）。3.x 的适配器不发送 CORS 响应头，除非用中间件加上（见 [HTTP](HTTP.md) 第 7 节）；校验签名的客户端需要一个加上这些响应头的中间件。
- 1.x 组件自己启动的服务器（为 Socket.IO 启动的 HTTP 服务器、其他 Web 框架）可以继续留在组件中，在 `startup()` 中启动，在 `destroy()` 中关闭。`socketIOServiceEntrypoint()` 也可以共用 HTTP 适配器的服务器，通过 Socket.IO 提供服务动作（见 [ServiceCalls](ServiceCalls.md) 第 4 节）。

## 7. 校验

1.x 的 `Validator` 生成 yup schema；3.x 用 DTO 类校验，DTO 的 schema 采用 joi 的 API（见 [DTOValidation](DTOValidation.md)）。1.x 中成对出现的 schema 和类型，合并成一个 DTO 类：

| 1.x（`Validator`，yup） | 3.x（`DTO`） |
|---|---|
| `Validator.Object({…})` 和一个 `T…Options` 类型 | 一个继承 `DTO` 的类，每个属性一个 `@Expect` |
| `Validator.String`、`.Number`、`.Boolean`、`.Date`、`.Array(of)`、`.Any` | `DTO.String()`、`DTO.Number()`、`DTO.Boolean()`、`DTO.Date()`、`DTO.Array(of)`、`DTO.Any()` |
| `Validator.Integer`、`Validator.Email` | `DTO.Number().integer()`、`DTO.String().email()` |
| `.required()` | `.required()` |
| `.notRequired()`、`.optional()` | `.optional()` |
| `.nullable()` | `.allow(null)` |
| `.oneOf([…])` | `.valid(…)` |
| `.matches(regex)` | `.pattern(regex)` |
| `.test(fn)` | `.custom(fn)` |
| `.when(…)` | `.when(…)`（使用 joi 的选项） |
| `schema.concat(other)` | 继承另一个 DTO，或者使用 `.concat()` |
| 方法上的 `@Accept(schema, {stripUnknown})` | 方法上的 `@Accept(DTO)`，或者动作的 DTO |

- **类型转换。** 1.x 的 `@Accept` 默认会转换值（yup 的 `strict: false`）：在每个被校验的方法上，`'5'` 都会变成 5。3.x 的 schema 是严格的：类型不对的值会被拒绝，而不是被转换。依赖这种转换的输入（以文本形式到达的数字、布尔值或日期，无论来自查询字符串、路由参数还是其他来源），要在 schema 上声明 `.strict(false)`。
- 默认会删除未声明的键；要保留它们的 DTO 继承 `FlexibleDTO`（`lakutata/dtos`）。
- 不合法的输入会以 `InvalidValueException`（`E_INVALID_VALUE`，HTTP 状态码 400）失败。

## 8. 数据库和缓存

**数据库。** 1.x 的 `TypeOrmComponent` 改为 `Database` 组件，用 `buildDatabaseOptions()` 声明（见 [Database](Database.md)、[Entities](Entities.md)）。ORM 是 TypeORM 1.1（1.x 使用的是 0.3）：

| 1.x | 3.x |
|---|---|
| `db: {class: TypeOrmComponent, options: {type: 'mysql', …, entities: [glob]}}` | `db: buildDatabaseOptions({type: 'mysql', …, entities: [Order, …]})` |
| `this.db.getRepository(Order)`、`this.db.manager`、`this.db.transaction(…)`、`this.db.query(sql)` | `Database` 的同名方法 |
| 从 `@lakutata-component/typeorm` 或 `typeorm` 导入的装饰器、操作符和类型 | `lakutata/decorator/orm`（装饰器）和 `lakutata/orm`（`In`、`Like` 等操作符，以及各种类型）；不再安装 `typeorm` 包 |
| `relations: ['customer']`、`select: ['id']` | `relations: {customer: true}`、`select: {id: true}` |
| `ConnectionOptions` | `MysqlDataSourceOptions` 等（`ConnectionOptions` 系列名字是已弃用的别名） |
| `this.db.queryData(options, Entity)` 及其查询语言 | 没有对应项：把这种查询语言作为应用自己的组件保留下来，基于 TypeORM 的查询选项实现，分页使用 `paginator`（`lakutata/dtos`） |

- **生产环境中的 `synchronize: true`** 会在每次启动时修改数据表。请关闭它，改用迁移（见 [Migrations](Migrations.md)）：先对生产数据库的副本生成第一个迁移（实体与数据表一致时，它应该是空的），之后由 `migrationsRun` 在启动时运行新的迁移。
- **使用 `__dirname` 的 glob** 在 ES 模块中不存在：请逐个列出实体类，迁移文件的路径用 `import.meta.dirname` 构造。

**缓存。** 1.x 的 `CacherComponent` 改为 `Cacher` 组件，用 `buildCacherOptions()` 声明（见 [Cache](Cache.md)）。`get(key)`、`set(key, value, ttl)` 和 `del(key)` 保留原来的名字（1.x 只能在选项中设置的存活时间，现在可以在每次 `set` 时给出），`wrap(key, fn)` 先读缓存、未命中时再计算。键不存在时返回 `undefined`，而 1.x 返回 `null`（存储出错时也是 `null`）；`null` 和 `false` 现在可以作为值缓存。键的构成方式也不同，1.x 写入的缓存条目在 3.x 中读不到：请从空缓存开始。

## 9. 配置、运行模式和入口

- **一份配置。** 1.x 通过入口文件选择生产或开发环境（`App.ts` 调用 `Config(true)`，开发入口调用 `Config(false)`）。在 3.x 中，`config()` 只有一个函数，运行模式来自环境：依次是 `MODE`、`NODE_ENV`、`mode` 选项；`app.mode()` 给出当前的模式（见 [Application](Application.md)）。
- **配置的值**来自环境变量，在 `config()` 中读取，或者作为 `@Configurable` 属性的默认值。声明不合法时，启动会以 `InvalidObjectOptionsException` 失败，并列出所有不合法的选项，所以缺少的环境变量会在启动时立即暴露，而不是等到第一次使用时。
- **选项中接收应用、用来访问其他组件的函数**，改为注入：组件自己注入它需要的对象。
- **写在配置代码中的凭据**，请移到环境变量或部署环境的密钥中。

## 10. 测试、构建和部署

- **测试。** 1.x 中连接共享开发服务器、直接启动应用的 `npm test`，改为对编译后的测试运行 `node --test`：每个测试文件用 `Application.run(config(port))` 在自己的端口上启动应用，调用它，最后释放它；组件放在 `Container` 中单独测试；其他服务用替身代替（见[示例](examples/README.md)）。
- **`package.json` 中的 `lakutata` 字段**在 1.x 中告诉命令行工具项目的类型（`type`）、目录和配置文件。在 3.x 中这个字段有别的含义（打包应用的 `resources` 和 `installer`，见 [Packaging](Packaging.md)）：请删除 1.x 的这个字段。
- **Node.js、TypeScript 和模块系统。** Node.js `^22.13.0 || >=24.11.0`，与模板一样使用 TypeScript 6，ES 模块（`"type": "module"`，相对导入以 `.js` 结尾），`tsconfig.json` 继承 `lakutata/tsconfig.json`。
- **端口。** 1.x 的服务模块监听自己的端口（默认 6912），注册中心监听另一个端口（6911）。3.x 的适配器监听各自选项中的端口，而使用 NATS 的服务只主动连接 NATS 服务器：`Dockerfile` 改为暴露这些端口。
- **脚本。** 模板的脚本取代了 `shx rm -rf ./build`（改为 `lakutata clean`）、安装时编译的 `prepare`，以及开发入口；`lakutata-deploy` 没有对应项：`service` 模板带有 `Dockerfile` 和 `docker:build` 脚本，镜像由部署环境自己的工具推送。

## 11. 用户界面

1.x 系统中单独构建、通过 HTTP 调用网关的 Web 界面并不使用 Lakutata，不需要改动，只要网关保持它的路由和响应格式（第 6 节）、界面用到的模式，以及界面检查的 `errno` 错误码不变。服务器保持原来的路径和事件时，它们的 WebSocket 客户端也能照常工作。

## 12. 检查移植结果

```bash
npm ls @lakutata/core            # 只有一个版本：lakutata 带来的 3.x 版本，没有残留的 1.x
npm run build                    # 没有从 @lakutata-module/*、@lakutata-component/* 或 1.x 的 @lakutata/core 导入的代码
grep -rnE "createApp|generateException|initialize\(|app\.(Components|Modules|Logger)|Validator\.|__dirname" src
npm test
MODE=production npm start        # 查看启动日志，然后按 Ctrl+C：应用平稳退出
```

- `grep` 列出残留的 1.x 代码。请逐行检查它找到的结果。
- 调用方和界面得到的响应与 1.x 服务的相同：相同的模式、`errno` 错误码和响应格式。
- 数据库：对生产数据库的副本运行 `lakutata migration generate`，不应生成任何变更。

## 13. 常见错误

- 在 1.x 项目中升级 `@lakutata/core`：3.x 版本是另一个库（第 1 节）。
- 从动作的输入中读取模式中的键：它们已经从输入中删除（第 5 节）。
- 依赖 1.x 类型转换的输入（把 `'5'` 当作 5）：没有 `.strict(false)` 时，3.x 的 schema 会拒绝它们（第 7 节）。
- 用 `=== null` 判断缓存未命中：未命中时返回的是 `undefined`（第 8 节）。
- `app.Logger.warning(…)`：3.x 的方法是 `warn`。
- 移植后仍在生产环境中开启 `synchronize: true`：实体一变化，启动时就会修改数据表。
- 在同一个进程中混用两个框架，或者让 1.x 服务调用 3.x 服务：它们的服务传输方式互不相通（第 2 节）。

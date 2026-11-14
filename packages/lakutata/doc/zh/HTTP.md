# Lakutata HTTP

HTTP 适配器通过 Express 或 Fastify 提供控制器的 HTTP 动作（`@GET`、`@POST`……）。本指南介绍 HTTP 特有的内容：两个适配器及其选项、路由、请求如何转换为动作的输入、响应、错误，以及 Web 框架自身的功能。控制器及其动作见[控制器与动作](Controllers.md)，中间件和访问控制见[中间件与访问控制](Middlewares.md)，适配器的启动和停止见[入口](Entrypoint.md)。

## 1. 第一个 HTTP API

```bash
npm install lakutata express
```

```typescript
import {Application, DTO, Exception} from 'lakutata'
import {buildEntrypoints, Controller, Result, type StatusResult} from 'lakutata/com/entrypoint'
import {DELETE, GET, POST} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class OrderIdDTO extends DTO {
    //路由参数是文本：strict(false) 把 '1' 转换成 1
    @Expect(DTO.Number().integer().strict(false).required())
    public id: number
}

class NewOrderDTO extends DTO {
    @Expect(DTO.String().required())
    public product: string

    @Expect(DTO.Number().integer().min(1).default(1))
    public quantity: number
}

class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'

    public statusCode: number = 404
}

type Order = { id: number, product: string, quantity: number }

const orders: Map<number, Order> = new Map()

class OrderController extends Controller {
    @POST('/orders', NewOrderDTO)
    public async create(input: NewOrderDTO): Promise<StatusResult> {
        const order: Order = {id: orders.size + 1, product: input.product, quantity: input.quantity}
        orders.set(order.id, order)
        return Result.status(201, order, {Location: `/orders/${order.id}`})
    }

    @GET('/orders/:id', OrderIdDTO)
    public async get(input: OrderIdDTO): Promise<Order> {
        const order: Order | undefined = orders.get(input.id)
        if (!order) throw new OrderNotFoundException('Order {id} not found', {id: input.id})
        return order
    }

    @DELETE('/orders/:id', OrderIdDTO)
    public async remove(input: OrderIdDTO): Promise<void> {
        orders.delete(input.id)
    }
}

Application.run(() => ({
    id: 'orders.app',
    name: 'Orders',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            http: expressHTTPEntrypoint({port: 8080})
        })
    },
    bootstrap: ['entrypoint']
}))
```

```text
$ curl -i -X POST localhost:8080/orders -H 'Content-Type: application/json' -d '{"product": "lamp"}'
HTTP/1.1 201 Created
Location: /orders/1

{"id":1,"product":"lamp","quantity":1}
$ curl localhost:8080/orders/1
{"id":1,"product":"lamp","quantity":1}
$ curl -i -X DELETE localhost:8080/orders/1
HTTP/1.1 204 No Content
$ curl -i localhost:8080/orders/1
HTTP/1.1 404 Not Found

{"errno":"E_ORDER_NOT_FOUND","errMsg":"Order 1 not found"}
$ curl -i -X POST localhost:8080/orders -H 'Content-Type: application/json' -d '{}'
HTTP/1.1 400 Bad Request

{"errno":"E_INVALID_VALUE","errMsg":"\"product\" is required"}
```

## 2. Express 还是 Fastify

两个适配器提供相同的动作，返回相同的结果：

| | Express | Fastify |
|---|---|---|
| 适配器 | `lakutata/adapter/express` 中的 `expressHTTPEntrypoint()` | `lakutata/adapter/fastify` 中的 `fastifyHTTPEntrypoint()` |
| 需要安装 | `express`（4 或 5） | `fastify`（5） |
| Node.js | 18.10 起 | 18.19、19.9、20 起（Fastify 5 需要 `diagnostics_channel.tracingChannel`） |

`expressHTTPEntrypoint()` 的选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `port` | `80` | 端口；`0` 表示任选一个空闲端口。端口已被占用时，应用启动失败 |
| `host` | 所有网络接口 | 监听的地址，例如 `'127.0.0.1'` 表示只接受本机的请求 |
| `name` | | 适配器的名称，用于区分多个适配器 |
| `body` | `{limit: '1mb'}` | 请求体的大小上限（`'5mb'` 或字节数）；`text`：按文本读取的内容类型（第 4 节）；`false` 表示不解析请求体 |
| `server` | | Node.js HTTP 服务器的选项：`keepAliveTimeout`、`headersTimeout`、`requestTimeout`…… |
| `app` | 新建的应用 | 一个已有的 Express 应用，动作将添加到该应用上 |
| `input` | 查询参数和请求体 | 从请求构造输入（第 4 节） |
| `respond` | `JSONResponder` | 写出结果和错误（第 6 节） |
| `middlewares` | | 该适配器上的动作所使用的中间件，在入口的中间件之后执行 |
| `before` | | `(app, context) => …`：添加应用自身的中间件和路由（第 7 节） |
| `fallback` | | 响应动作路径之外的请求，例如 Web 界面的页面（第 7 节） |
| `stop` | | 适配器停止、服务器关闭之后调用 |
| `heartbeat` | `15000` | 发送注释的间隔，用于保持事件流的连接，单位为毫秒（第 5 节） |
| `listening` | | `(server, listeners) => …`：服务器开始监听后调用；按网口监听时，在网口的监听器创建完成后调用（见下文） |
| `interface` | | 按网口而非按地址监听，可以再配合 `family`、`strict` 和 `onError` 使用（见下文） |

`fastifyHTTPEntrypoint()` 的选项相同，只是没有 `server` 和 `app`，而是改用 `fastify`。该选项可以是一个 Fastify 实例，也可以是待创建实例的选项（`bodyLimit`，默认 1 MiB；`trustProxy`；`connectionTimeout`、`keepAliveTimeout`、`requestTimeout`；`logger`……）。该适配器的 `body` 选项只有 `text`，因为大小上限由实例的 `bodyLimit` 决定。

两者的不同之处：

| | Express | Fastify |
|---|---|---|
| URL 编码的表单请求体 | 会解析 | 以 415 拒绝 |
| `this.context.request` | Express 的请求（`ip`、`get()`、`hostname`……） | Node.js 的请求 |
| 通配符路由 | `/files/*path`，输入包含 `path: ['docs', 'a.txt']` | `/files/*`，输入包含 `'*': 'docs/a.txt'` |
| `GET`、`HEAD`、`POST`、`PUT`、`PATCH`、`DELETE`、`OPTIONS`、`TRACE` 之外的 HTTP 方法 | 直接支持 | 需要在 `before` 中通过 `app.addHttpMethod()` 注册，否则启动失败 |
| 通过 `fallback` 提供 Web 界面 | `staticUI()`（第 7 节） | 自行编写处理函数 |
| Web 框架自身错误的 `errno` | `E_UNKNOWN` | Fastify 自身的错误码，例如 `FST_ERR_CTP_BODY_TOO_LARGE` |
| 应用停止时，传入的 Express 应用或 Fastify 实例 | 保持不变 | 被关闭 |

应用停止时（见[入口](Entrypoint.md)第 4 节），适配器不再接受新的连接，并结束事件流；对于已打开的连接上仍然到达的请求，Fastify 还会返回 503。正在处理的请求可以在入口的 `shutdownTimeout` 内完成（超时后以 503 响应），之后最多还有一秒用于发送响应，随后关闭剩余的连接，WebSocket 连接同样如此。

### 按网口监听

拥有多个网口的设备常常只在其中一个网口上提供页面，而该网口的地址来自 DHCP，可能发生变化。设置 `interface` 后，适配器监听的是该网口，而不是某个地址。无论网口当前的地址是什么，即使地址发生变化，或网口被拔出后重新插入，适配器都会继续监听。默认的实现是 `@lakutata/netif` 包，该包需要另行安装，并会编译一个原生插件（见[网口](Netif.md)）。

```typescript
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

//页面只在 eth1 上提供，不管它是什么地址
export const http = expressHTTPEntrypoint({
    port: 8080,
    interface: 'eth1',
    listening: (_server, listeners): void => console.log(listeners?.map(listener => listener.addresses))
})
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `interface` | | 网口的名称（`'eth1'`；Windows 上为网络连接的名称）、`{mac: '52:54:00:12:34:56'}` 或 `{index: 3}`；多个网口放在数组中，此时 `port` 不能为 `0`。不能与 `host` 同时设置 |
| `family` | `'both'` | `'IPv4'`、`'IPv6'` 或两者都监听 |
| `strict` | `false` | 如果系统无法拒绝从其他网口发往该网口地址的连接，则使启动失败，并在无法拒绝期间停止监听（见[网口](Netif.md)第 2 节） |
| `onError` | 应用的日志 | 接收应用运行期间重新监听时发生的错误，例如端口被其他程序占用；适配器会自动重试 |
| `interfaceListening` | `@lakutata/netif` | 换用另一种按网口监听的实现，即一个 `IInterfaceListening`，该接口由 Lakutata 定义、由 `@lakutata/netif` 实现 |

- 应用启动时网口可能尚不存在（例如 USB 网卡尚未插入），此时启动仍然成功，网口出现后，适配器随即开始监听。在此之前，监听器的 `addresses` 为空。
- 服务器本身不监听，其 `address()` 为 `null`，因此端口和地址需从监听器上读取。
- 如果未设置 `interface` 却设置了 `family`、`strict`、`onError` 或 `interfaceListening`，或者同时设置了 `interface` 和 `host`，创建适配器时便会报错。

## 3. 路由

| 装饰器 | 方法 |
|---|---|
| `@GET(route)`、`@POST`、`@PUT`、`@PATCH`、`@DELETE`、`@HEAD`、`@OPTIONS` | 与名称相同的方法 |
| `@HTTPAction(route, method)` | 一个方法（`'purge'`）或一组方法（`['get', 'post']`） |

这些装饰器后续的参数依次为输入的 DTO 和动作选项，两者均可省略（见[控制器与动作](Controllers.md)第 3 节）。

```typescript
import {DTO} from 'lakutata'
import {Controller} from 'lakutata/com/entrypoint'
import {GET, HTTPAction, Prefix} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'

class SearchDTO extends DTO {
    @Expect(DTO.String().required())
    public keyword: string
}

@Prefix({route: '/api'})
class LibraryController extends Controller {
    //GET /api/search?keyword=lamp，或者带请求体 {"keyword": "lamp"} 的 POST /api/search
    @HTTPAction('/search', ['get', 'post'], SearchDTO)
    public async search(input: SearchDTO): Promise<string[]> {
        return [input.keyword]
    }

    //使用 Express 时，GET /api/files/docs/guide.pdf：input.path 是 ['docs', 'guide.pdf']（使用 Fastify 时：'/files/*' 和 input['*']）
    @GET('/files/*path')
    public async file(input: { path: string[] }): Promise<string> {
        return input.path.join('/')
    }
}
```

- 路由使用 Web 框架的语法。在两个框架中，`:id` 都表示一个参数；通配符的写法则有所不同（第 2 节）。
- `@Prefix({route})` 为控制器的所有路由加上前缀（见[控制器与动作](Controllers.md)第 6 节）。
- `GET` 动作也会响应同一路由的 `HEAD` 请求（不带响应体），除非该路由另有 `HEAD` 动作。
- 如果请求的方法在其路由上没有对应的动作，请求以 404（`E_ROUTE_NOT_FOUND`）响应，而不是 405。没有任何机制会自动响应 `OPTIONS`，因此在添加处理 CORS 的中间件之前，浏览器的预检请求都会失败（第 7 节）。

## 4. 输入

默认情况下，动作的输入由查询参数、请求体的属性和路由参数依次合并而成，后者覆盖前者：

```text
POST /orders/7?id=1&note=a   请求体为 {"id": 5, "note": "b"}   →   {id: '7', note: 'b'}
```

随后由动作的 DTO 校验输入，并去除 DTO 未声明的键。`this.context.data` 是校验之前的输入，不包含路由参数。

- **文本。** 查询参数和路由参数的值均为字符串，因此数字或布尔值的校验规则需要 `.strict(false)` 才能接受 `'42'` 或 `'true'`。
- **查询参数。** 出现多次的键为数组（`?tag=a&tag=b` → `tag: ['a', 'b']`）。在 Express 5 和 Fastify 中，方括号不会形成嵌套，例如 `?filter[status]=open` 得到的键为 `'filter[status]'`。
- **JSON 请求体。** 数组无法作为输入使用（Express 将数组元素放在以序号命名的键下，Fastify 则忽略数组），因此列表需放在一个对象中发送（`{"items": [...]}`）。
- **表单。** Express 会解析 URL 编码的请求体，方括号会形成嵌套（`a[b]=1` → `a: {b: '1'}`）；Fastify 则以 415 拒绝此类请求体。两者都不解析 `multipart/form-data`，即文件上传（第 7 节）。
- **其他文本。** `body.text` 中列出的内容类型（`['application/sdp']`，或用 `'text/*'` 表示一整类）按文本读取，并放在输入的 `body` 属性中交给动作。Fastify 不解析的其他类型以 415 拒绝。
- **上限。** 请求体超过上限时以 413 拒绝，JSON 格式错误时以 400 拒绝。

`input` 选项从请求构造输入。例如，将客户端的地址和语言交给动作（只有声明了 `ip` 和 `language` 的 DTO 才会保留这两个值）：

```typescript
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import type {Request} from 'express'

export const http = expressHTTPEntrypoint({
    port: 8080,
    input: (request: Request): Record<string, unknown> => ({
        ...request.query,
        ...request.body,
        ip: request.ip,
        language: request.get('accept-language')
    })
})
```

路由参数始终会合并到该选项的结果上。使用 Express 时，动作也可以直接读取请求：`(this.context as HTTPContext).request as unknown as Request` 即为 Express 的请求，带有 `ip`、`get()` 以及中间件添加的属性。使用 Fastify 时，`this.context.request` 是 Node.js 的请求，因此需通过 `input` 将 `request.ip` 交给动作。

## 5. 响应

- 返回值以 JSON 发送；`undefined` 以 204 响应。
- `Result.status(status, data?, headers?)` 发送状态码和响应头，可以带数据，也可以不带。
- `Result.file(source, options?)` 发送一个文件，来源可以是文件路径（相对于工作目录）、`Buffer` 或流。`filename` 使文件作为下载发送；`contentType` 设置文件的类型，未设置时根据文件名的扩展名推断；`etag` 发送 `ETag` 响应头，请求的 `If-None-Match` 与之相同时以 304 响应。
- `Result.events(producer)` 发送 Server-Sent Events。

```typescript
import {Readable} from 'node:stream'
import {Controller, Result, type EventsResult, type FileResult, type StatusResult} from 'lakutata/com/entrypoint'
import {GET, POST} from 'lakutata/decorator/ctrl'

class ExportController extends Controller {
    //一个下载
    @GET('/exports/orders.csv')
    public async orders(): Promise<FileResult> {
        return Result.file(Readable.from(['id,product\n', '1,lamp\n']), {contentType: 'text/csv', filename: 'orders.csv'})
    }

    //一个任务的进度，直到任务结束或者客户端离开
    @GET('/exports/progress')
    public async progress(): Promise<EventsResult> {
        return Result.events(async (send, signal: AbortSignal): Promise<void> => {
            for (let percent: number = 0; percent <= 100 && !signal.aborted; percent += 25) {
                send({percent: percent}, 'progress')
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 1000))
            }
        })
    }

    //重定向
    @POST('/logout')
    public async logout(): Promise<StatusResult> {
        return Result.status(303, undefined, {Location: '/'})
    }
}
```

事件按标准格式写出。数据为 JSON（字符串按原样写出，每行一个 `data:`），给出事件名和 ID 时也一并写出：

```text
id: 1
event: tick
data: {"n":1}

data: line one
data: line two
```

- 每隔 `heartbeat` 毫秒发送一条注释（`: ping`），以免代理断开连接。
- 生产者函数返回或失败时，流随之结束；失败时不会再发送任何内容，因为响应头已经发出。客户端断开连接或应用停止时，`signal` 会被中止。
- 生产者函数在请求的作用域销毁之后运行，因此应使用组件，而不是属于请求的提供者。

动作也可以通过 `this.context.response`（Node.js 的响应）自行写出响应。动作发出响应头之后，适配器既不写出动作的结果，也不写出动作的错误。客户端在收到响应之前断开连接时，`this.signal` 会被中止，并且不会写出任何内容。

## 6. 错误

错误以一个状态码和 `{errno, errMsg}` 响应：

- 状态码取错误本身及其原因（`cause`）中第一个客户端错误（4xx）的 `statusCode` 或 `status`；没有时，取错误自身在 400 到 599 之间的状态码；否则为 500；
- `errno` 和 `errMsg` 来自错误本身。`errno` 取错误的 `errno`，没有时取 `code`，均没有时为 `E_UNKNOWN`；`errMsg` 取错误的 `errMsg`，没有时取 `message`。因此，`new Error('Lookup failed', {cause: notFound})` 以其原因的 404 响应，内容为 `{"errno": "E_UNKNOWN", "errMsg": "Lookup failed"}`。

| 状态码 | `errno` | 触发时机 |
|---|---|---|
| 400 | `E_INVALID_VALUE` | DTO 拒绝了输入 |
| 400 | `E_UNKNOWN`（Express）、`FST_ERR_CTP_INVALID_JSON_BODY`（Fastify） | 请求体的 JSON 格式错误 |
| 403 | `E_ACCESS_DENY` | 访问控制拒绝了请求（见[中间件与访问控制](Middlewares.md)） |
| 404 | `E_ROUTE_NOT_FOUND` | 没有与该路由和方法对应的动作 |
| 413 | `E_UNKNOWN`（Express）、`FST_ERR_CTP_BODY_TOO_LARGE`（Fastify） | 请求体超过上限 |
| 415 | `FST_ERR_CTP_INVALID_MEDIA_TYPE` | Fastify 不解析该类型的请求体 |
| 503 | `E_ENTRYPOINT_STOPPED` | 应用正在停止 |
| 500 | 错误自身的 | 其他所有错误 |

应用自定义的异常可以给出自身的 `errno` 和 `statusCode`，例如第 1 节的 `OrderNotFoundException`。

**封套。** `jsonEnvelope()`（Express）和 `fastifyJSONEnvelope()`（Fastify）将每个响应包装为 `{errno, errMsg, data}`：

```typescript
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'

export const http = expressHTTPEntrypoint({
    port: 8080,
    //{"errno": null, "errMsg": null, "data": {...}, "timestamp": 1792209357257}
    respond: jsonEnvelope({actionErrorStatus: 200, extra: (): Record<string, unknown> => ({timestamp: Date.now()})})
})
```

- 结果为 `{errno: null, errMsg: null, data}`；没有数据时，状态码为 200，`data` 为 `null`。
- 错误为 `{errno, errMsg, data: null}`，使用错误的状态码。`errorStatus` 设置所有错误的状态码，例如对于从封套中读取错误的客户端，可设为 200。`actionErrorStatus` 只设置动作错误（校验、访问控制、动作抛出的异常）的状态码，未找到路由和 Web 框架中间件的错误仍使用其自身的状态码。
- `extra(request)` 为每个响应添加字段，排在 `errno`、`errMsg` 和 `data` 之后，不会覆盖这三个字段。

**自定义响应器**是一个包含两个方法的对象，通过 `respond` 选项传入：`success(response, data, request)` 和 `error(response, error, request, origin)`。请求已到达动作时，`origin` 为 `'action'`；在此之前已失败时（Web 框架的中间件、未找到路由），`origin` 为 `'request'`。适配器子路径中的 `statusOfError()` 和 `describeError()` 按上述规则计算状态码和 `{errno, errMsg}`。文件和事件流不经过响应器。

## 7. Web 框架的功能

`before` 钩子在添加动作的路由之前接收 Express 应用或 Fastify 实例。钩子添加的中间件、插件和路由排在前面，因此钩子添加的路由优先于路径相同的动作。钩子的第二个参数提供以下属性：

| 属性 | 含义 |
|---|---|
| `module` | 入口所在的模块，用于获取对象，例如 `await module.getObject('db')` |
| `server` | HTTP 服务器，此时尚未开始监听，可以将 WebSocket 服务器挂载到该服务器上 |
| `routes` | 动作的路由，以及每个路由的方法 |
| `actionPrefixes`、`isActionPath(path)` | 动作路由的第一段，以及某个路径是否位于其下 |

`before` 失败会导致应用启动失败。使用 Express 时，请求体解析器在 `before` 之后才添加，因此 `before` 中的中间件无法获取解析后的请求体。

```typescript
import compression from 'compression'
import cors from 'cors'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import type {Express, Request, Response} from 'express'

export const http = expressHTTPEntrypoint({
    port: 8080,
    before: (app: Express): void => {
        //在同一台机器上的反向代理之后：request.ip 和 request.protocol 取自它的 X-Forwarded-* 请求头
        app.set('trust proxy', 'loopback')
        //响应浏览器的预检请求，并给响应加上 CORS 响应头
        app.use(cors({origin: 'https://app.example.com'}))
        app.use(compression())
        app.get('/health', (_request: Request, response: Response): void => void response.send('ok'))
    }
})
```

使用 Fastify 时，在 `async` 钩子中注册插件（`await app.register(fastifyCors, {origin: …})`，`fastifyCors` 来自 `@fastify/cors`），并通过 `fastify: {trustProxy: true}` 信任代理。

**HTTPS。** 适配器只提供 HTTP。如需提供 HTTPS，请在应用前部署反向代理（nginx、Caddy、负载均衡器），并按上文所述信任该代理。

### 上传

适配器不解析 `multipart/form-data`。使用 Express 时，在 `before` 中为该路由添加 `multer` 等解析器，再将解析器解析出的文件放入输入：

```typescript
import multer from 'multer'
import {DTO} from 'lakutata'
import {Controller} from 'lakutata/com/entrypoint'
import {POST} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import type {Express, Request} from 'express'

class AvatarDTO extends DTO {
    @Expect(DTO.String().required())
    public user: string

    //multer 的文件：{originalname, mimetype, size, buffer…}
    @Expect(DTO.Object().required())
    public file: Express.Multer.File
}

class AvatarController extends Controller {
    @POST('/avatars', AvatarDTO)
    public async upload(input: AvatarDTO): Promise<{ name: string, size: number }> {
        return {name: input.file.originalname, size: input.file.buffer.length}
    }
}

const upload: multer.Multer = multer({storage: multer.memoryStorage(), limits: {fileSize: 5 * 1024 * 1024}})

export const http = expressHTTPEntrypoint({
    port: 8080,
    before: (app: Express): void => {
        //先解析 POST /avatars 的表单，请求再继续交给动作
        app.post('/avatars', upload.single('file'))
    },
    input: (request: Request): Record<string, unknown> => ({...request.query, ...request.body, file: request.file})
})
```

multer 的错误（例如文件超过上限，`LIMIT_FILE_SIZE`）没有状态码，因此以 500 响应。

使用 Fastify 时，在 `before` 中以 `attachFieldsToBody: 'keyValues'` 注册 `@fastify/multipart`，表单的字段和文件随即成为请求体的属性，从而进入输入。文件为 `Buffer`（以 `DTO.Binary()` 声明），不带文件名；超过上限的文件以 413 拒绝。

### Web 界面

`fallback` 响应动作路径之外的请求（见上文的 `isActionPath()`）。使用 Express 时，`staticUI()` 提供一个已构建的单页应用，例如 Vite 构建生成的 `dist` 目录：

```typescript
import {expressHTTPEntrypoint, staticUI} from 'lakutata/adapter/express'

export const http = expressHTTPEntrypoint({
    port: 8080,
    fallback: staticUI('./ui/dist')
})
```

- 目录中的文件按原样发送。文件名中带有内容哈希的文件（`index-B2x9fQ1a.js`）由浏览器缓存一年（`assetsMaxAge`）；其他文件在每次请求时重新验证。
- 请求页面的 `GET` 请求（接受 HTML，路径没有扩展名）如果没有对应的文件，则以应用的 `index.html` 响应，由应用的路由处理该路径。`spa: false` 关闭此行为，`index` 可以指定另一个文件。
- 其他没有对应文件的请求，例如缺失的脚本，以 404 响应。
- 动作路由之下的路径（`/api/…`）永远不会交给 `fallback`，这些路径上没有对应动作的请求以 404 响应。

使用 Fastify 时，`fallback` 是自行编写的处理函数 `(request, reply) => …`，该函数接收动作路径之外的所有请求。

## 8. 从 lakutata 2.x 迁移

2.x 的 HTTP 入口函数（`buildHTTPEntrypoint`）仍然可以使用。该函数在入口的启动阶段被调用（此时其获取的对象均可用，例如注入了入口的鉴权组件），并且会被等待，因此应用在其服务器开始监听之后才算启动完成。迁移到 `expressHTTPEntrypoint` 时：

- 应用自身的中间件和路由（CORS、压缩、健康检查、鉴权、Web 界面）放入 `before` 钩子，在钩子中通过 `module.getObject()` 获取对象；请求体解析器改用 `body` 选项（`{limit: '100mb'}`）；服务器的 `keepAliveTimeout` 和 `headersTimeout` 改用 `server` 选项；
- 从请求构造的输入（查询参数、请求体、会话中的值）改用 `input` 选项；
- `{errno, errMsg, data}` 封套改用 `jsonEnvelope()`。2.x 的应用通常对动作的错误返回 200，而对 Express 中间件的错误（`next(error)`，例如鉴权的 401）使用错误自身的状态码，`jsonEnvelope({actionErrorStatus: 200})` 的行为与此相同。如果使用 `errorStatus: 200`，401 也会变为 200，此时遇到 401 便跳转到登录页的客户端将会失效；
- 应用封套中的其他字段（`timestamp`、`nonce`、请求 ID）通过 `extra` 选项给出，该选项在每次响应时调用，对结果和错误均适用。无需为保留这些字段而自行编写响应器。

```typescript
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'
import type {Express, NextFunction, Request, Response} from 'express'

class Unauthorized extends Error {
    public readonly errno: string = 'E_UNAUTHORIZED'

    public readonly statusCode: number = 401
}

export const entrypoint = buildEntrypoints({
    controllers: [],
    http: expressHTTPEntrypoint({
        port: 3000,
        body: {limit: '100mb'},
        before: async (app: Express): Promise<void> => {
            app.get('/health', (_request: Request, response: Response): unknown => response.json({status: 'ok'}))
            //请求的鉴权：它的错误保留自己的状态码（401）
            app.use((request: Request, _response: Response, next: NextFunction): void => request.headers.authorization ? next() : next(new Unauthorized('Not logged in')))
        },
        //动作的错误在封套中以 200 返回，与 2.x 相同，并带上时间戳
        respond: jsonEnvelope({actionErrorStatus: 200, extra: (): Record<string, unknown> => ({timestamp: Date.now()})})
    })
})
```

使用 Fastify 时，`fastifyJSONEnvelope()` 接受相同的选项，鉴权则写成 Fastify 的钩子。

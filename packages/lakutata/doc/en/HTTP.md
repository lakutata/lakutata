# Lakutata HTTP

The HTTP adapters serve the HTTP actions of the controllers (`@GET`, `@POST`…) with Express or Fastify. This guide
covers what is particular to HTTP: the two adapters and their options, the routes, how a request becomes the input of
an action, the responses, the errors, and the features of the web framework itself. The controllers and their actions
are described in [Controllers](Controllers.md), the middlewares and the access control in
[Middlewares](Middlewares.md), and the starting and stopping of the adapters in [Entrypoint](Entrypoint.md).

## 1. A first HTTP API

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
    //A route parameter is text: strict(false) converts '1' to 1
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

## 2. Express or Fastify

Both adapters serve the same actions, with the same results:

| | Express | Fastify |
|---|---|---|
| Adapter | `expressHTTPEntrypoint()`, from `lakutata/adapter/express` | `fastifyHTTPEntrypoint()`, from `lakutata/adapter/fastify` |
| Install | `express` (4 or 5) | `fastify` (5) |

The options of `expressHTTPEntrypoint()`:

| Option | Default | Meaning |
|---|---|---|
| `port` | `80` | The port; `0` picks a free port. A port already in use fails the application's start |
| `host` | all the interfaces | The address to listen on, such as `'127.0.0.1'` for the local machine only |
| `name` | | The name of the adapter, to tell several adapters apart |
| `body` | `{limit: '1mb'}` | The size limit of the JSON and URL-encoded bodies (`'5mb'`, or a number of bytes); `false` parses no body |
| `server` | | The options of the Node.js HTTP server: `keepAliveTimeout`, `headersTimeout`, `requestTimeout`… |
| `app` | a new application | An existing Express application to add the actions to |
| `input` | the query and the body | Builds the input from the request (section 4) |
| `respond` | `JSONResponder` | Writes the results and the errors (section 6) |
| `middlewares` | | The middlewares of the actions of this adapter, run after those of the entrypoint |
| `before` | | `(app, context) => …`: adds the application's own middlewares and routes (section 7) |
| `fallback` | | Answers the requests outside the paths of the actions, such as the pages of a web UI (section 7) |
| `stop` | | Called when the adapter stops, once its server is closed |
| `heartbeat` | `15000` | How often a comment keeps the event streams alive, in milliseconds (section 5) |

`fastifyHTTPEntrypoint()` takes the same options, except `body`, `server` and `app`, replaced by `fastify`: a Fastify
instance, or the options of the instance to create (`bodyLimit`, 1 MiB by default; `trustProxy`; `connectionTimeout`,
`keepAliveTimeout`, `requestTimeout`; `logger`…).

Where they differ:

| | Express | Fastify |
|---|---|---|
| URL-encoded form bodies | Parsed | Refused with 415 |
| `this.context.request` | The Express request (`ip`, `get()`, `hostname`…) | The Node.js request |
| A wildcard route | `/files/*path`: the input gets `path: ['docs', 'a.txt']` | `/files/*`: the input gets `'*': 'docs/a.txt'` |
| Other HTTP methods than `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `TRACE` | Accepted | Registered with `app.addHttpMethod()` in `before`; otherwise the start fails |
| A web UI as `fallback` | `staticUI()` (section 7) | A handler of your own |
| The `errno` of the errors of the framework | `E_UNKNOWN` | Its codes, such as `FST_ERR_CTP_BODY_TOO_LARGE` |
| A given application or instance, when the application stops | Left as it is | Closed |

When the application stops (see [Entrypoint](Entrypoint.md), section 4), the adapters stop accepting connections and end
the event streams; Fastify also answers 503 to the requests that still arrive on the open connections. The requests in
progress get the `shutdownTimeout` of the entrypoint (after it, they are answered with 503), then up to one second to
send their responses, before the remaining connections are closed, the WebSockets included.

## 3. Routes

| Decorator | Methods |
|---|---|
| `@GET(route)`, `@POST`, `@PUT`, `@PATCH`, `@DELETE`, `@HEAD`, `@OPTIONS` | The method of its name |
| `@HTTPAction(route, method)` | One method (`'purge'`), or a list (`['get', 'post']`) |

Each of them then takes the DTO of the input and the options of the action, both optional (see
[Controllers](Controllers.md), section 3).

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
    //GET /api/search?keyword=lamp, or POST /api/search with the body {"keyword": "lamp"}
    @HTTPAction('/search', ['get', 'post'], SearchDTO)
    public async search(input: SearchDTO): Promise<string[]> {
        return [input.keyword]
    }

    //GET /api/files/docs/guide.pdf with Express: input.path is ['docs', 'guide.pdf'] (with Fastify: '/files/*' and input['*'])
    @GET('/files/*path')
    public async file(input: { path: string[] }): Promise<string> {
        return input.path.join('/')
    }
}
```

- A route uses the syntax of the web framework: `:id` is a parameter with both; the wildcards differ (section 2).
- `@Prefix({route})` puts a prefix before the routes of a controller (see [Controllers](Controllers.md), section 6).
- A `GET` action also answers the `HEAD` requests of its route, without a body, unless the route has a `HEAD` action.
- A request whose method has no action on its route is answered with 404 (`E_ROUTE_NOT_FOUND`), not 405. Nothing
  answers `OPTIONS` by itself: the preflight requests of the browsers fail until a CORS middleware answers them
  (section 7).

## 4. The input

By default, the input of an action is the query, then the properties of the body over it, then the route parameters
over both:

```text
POST /orders/7?id=1&note=a   with the body {"id": 5, "note": "b"}   →   {id: '7', note: 'b'}
```

The DTO of the action then validates it, and removes the keys it does not declare. `this.context.data` is the input
before the validation, without the route parameters.

- **Text.** The values of the query and the route parameters are strings: a schema of a number or a boolean needs
  `.strict(false)` to accept `'42'` or `'true'`.
- **The query.** A key given several times is an array (`?tag=a&tag=b` → `tag: ['a', 'b']`). With Express 5 and
  Fastify, the brackets do not nest: `?filter[status]=open` gives the key `'filter[status]'`.
- **JSON bodies.** An array gives no usable input (Express spreads its items under numbered keys, Fastify ignores it):
  send a list inside an object (`{"items": [...]}`).
- **Forms.** Express parses the URL-encoded bodies, the brackets nested (`a[b]=1` → `a: {b: '1'}`); Fastify refuses them
  with 415. Neither parses `multipart/form-data`, the file uploads (section 7).
- **Limits.** A body over the limit is refused with 413, malformed JSON with 400.

The `input` option builds the input from the request. For example, to give the actions the address of the client and
its language (only the DTOs that declare `ip` and `language` keep them):

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

The route parameters are always merged over the result. With Express, an action can also read the request itself:
`(this.context as HTTPContext).request as unknown as Request` gives the Express request, with `ip`, `get()` and the
properties that its middlewares add. With Fastify, `this.context.request` is the Node.js request: give the action
`request.ip` through `input`.

## 5. The response

- A value is sent as JSON; `undefined` is answered with 204.
- `Result.status(status, data?, headers?)` sends a status and headers with the data, or without data.
- `Result.file(source, options?)` sends a file: its path (relative to the working directory), a `Buffer` or a stream.
  `filename` makes it a download; `contentType` sets its type, otherwise taken from the extension of its name; `etag`
  sends `ETag` and answers 304 when the `If-None-Match` of the request matches it.
- `Result.events(producer)` sends Server-Sent Events.

```typescript
import {Readable} from 'node:stream'
import {Controller, Result, type EventsResult, type FileResult, type StatusResult} from 'lakutata/com/entrypoint'
import {GET, POST} from 'lakutata/decorator/ctrl'

class ExportController extends Controller {
    //A download
    @GET('/exports/orders.csv')
    public async orders(): Promise<FileResult> {
        return Result.file(Readable.from(['id,product\n', '1,lamp\n']), {contentType: 'text/csv', filename: 'orders.csv'})
    }

    //The progress of a job, until it ends or the client leaves
    @GET('/exports/progress')
    public async progress(): Promise<EventsResult> {
        return Result.events(async (send, signal: AbortSignal): Promise<void> => {
            for (let percent: number = 0; percent <= 100 && !signal.aborted; percent += 25) {
                send({percent: percent}, 'progress')
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 1000))
            }
        })
    }

    //A redirection
    @POST('/logout')
    public async logout(): Promise<StatusResult> {
        return Result.status(303, undefined, {Location: '/'})
    }
}
```

The events are written as the standard defines them: the data as JSON (a string as it is, one `data:` line per line),
with the event's id and name before it when they are given:

```text
id: 1
event: tick
data: {"n":1}

data: line one
data: line two
```

- A comment (`: ping`) is sent every `heartbeat` milliseconds, so that the proxies keep the connection open.
- The stream ends when the producer returns or fails; a failure sends nothing more, the headers being already sent.
  `signal` is aborted when the client leaves or the application stops.
- The producer runs after the scope of the request is destroyed: it should use components, not the providers of the
  request.

An action can also write the response itself through `this.context.response`, the Node.js response. Once the action has
sent the headers, the adapter writes neither its result nor its error. When the client leaves before the response,
`this.signal` is aborted, and nothing is written.

## 6. Errors

An error is answered with a status and `{errno, errMsg}`:

- the status is the first client error (4xx) found in the `statusCode` or `status` of the error or of its causes
  (`cause`), otherwise its own status when it is between 400 and 599, otherwise 500;
- `errno` and `errMsg` come from the error itself: its `errno`, otherwise its `code`, otherwise `E_UNKNOWN`; its
  `errMsg`, otherwise its `message`. So `new Error('Lookup failed', {cause: notFound})` is answered with the 404 of its
  cause, and `{"errno": "E_UNKNOWN", "errMsg": "Lookup failed"}`.

| Status | `errno` | When |
|---|---|---|
| 400 | `E_INVALID_VALUE` | The DTO refused the input |
| 400 | `E_UNKNOWN` (Express), `FST_ERR_CTP_INVALID_JSON_BODY` (Fastify) | The JSON of the body is malformed |
| 403 | `E_ACCESS_DENY` | The access control refused the request (see [Middlewares](Middlewares.md)) |
| 404 | `E_ROUTE_NOT_FOUND` | No action has this route and method |
| 413 | `E_UNKNOWN` (Express), `FST_ERR_CTP_BODY_TOO_LARGE` (Fastify) | The body is over the limit |
| 415 | `FST_ERR_CTP_INVALID_MEDIA_TYPE` | Fastify does not parse this type of body |
| 503 | `E_ENTRYPOINT_STOPPED` | The application is stopping |
| 500 | The error's | Any other error |

An exception of the application gives its own `errno` and `statusCode`, as `OrderNotFoundException` in section 1.

**The envelope.** `jsonEnvelope()` (Express) and `fastifyJSONEnvelope()` (Fastify) wrap every response in
`{errno, errMsg, data}`:

```typescript
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'

export const http = expressHTTPEntrypoint({
    port: 8080,
    //{"errno": null, "errMsg": null, "data": {...}, "timestamp": 1792209357257}
    respond: jsonEnvelope({actionErrorStatus: 200, extra: (): Record<string, unknown> => ({timestamp: Date.now()})})
})
```

- A result is `{errno: null, errMsg: null, data}`, with the status 200 when there is no data (`data` is `null`).
- An error is `{errno, errMsg, data: null}`, with its status. `errorStatus` gives the status of every error, such as
  200 for the clients that read the errors from the envelope. `actionErrorStatus` gives the status of the errors of the
  actions only (their validation, their access control, their exceptions): a route not found and the errors of the
  middlewares of the web framework keep theirs.
- `extra(request)` adds fields to every response, after `errno`, `errMsg` and `data`, which they never replace.

**A responder of your own** is an object with two methods, given to `respond`: `success(response, data, request)` and
`error(response, error, request, origin)`. `origin` is `'action'` when the request reached an action, `'request'` when
it failed before (a middleware of the web framework, a route not found). `statusOfError()` and `describeError()`, from
the adapter's subpath, compute the status and the `{errno, errMsg}` described above. The files and the event streams do
not go through the responder.

## 7. The features of the web framework

The `before` hook receives the Express application or the Fastify instance before the routes of the actions are added.
Its middlewares, plugins and routes come first: a route of its own takes precedence over an action with the same path.
Its second argument gives:

| Property | What it is |
|---|---|
| `module` | The module of the entrypoint, to get objects: `await module.getObject('db')` |
| `server` | The HTTP server, not listening yet: a WebSocket server can be attached to it |
| `routes` | The routes of the actions, each with its methods |
| `actionPrefixes`, `isActionPath(path)` | The first segments of the routes of the actions, and whether a path is under one of them |

A failure of `before` fails the application's start. With Express, the body parsers are added after `before`: its
middlewares do not see a parsed body.

```typescript
import compression from 'compression'
import cors from 'cors'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import type {Express, Request, Response} from 'express'

export const http = expressHTTPEntrypoint({
    port: 8080,
    before: (app: Express): void => {
        //Behind a reverse proxy on the same machine: request.ip and request.protocol come from its X-Forwarded-* headers
        app.set('trust proxy', 'loopback')
        //Answers the preflight requests of the browsers, and adds the CORS headers to the responses
        app.use(cors({origin: 'https://app.example.com'}))
        app.use(compression())
        app.get('/health', (_request: Request, response: Response): void => void response.send('ok'))
    }
})
```

With Fastify, register the plugins in an `async` hook (`await app.register(fastifyCors, {origin: …})`, from
`@fastify/cors`), and trust the proxy with `fastify: {trustProxy: true}`.

**HTTPS.** The adapters serve HTTP. Put a reverse proxy in front of the application (nginx, Caddy, a load balancer) to
serve HTTPS, and trust it as above.

### Uploads

The adapters do not parse `multipart/form-data`. With Express, add a parser such as `multer` to the route in `before`,
and give its file to the input:

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

    //The file of multer: {originalname, mimetype, size, buffer…}
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
        //Parses the form of POST /avatars, then the request goes on to the action
        app.post('/avatars', upload.single('file'))
    },
    input: (request: Request): Record<string, unknown> => ({...request.query, ...request.body, file: request.file})
})
```

The errors of multer, such as a file over its limit (`LIMIT_FILE_SIZE`), have no status: they are answered with 500.

With Fastify, register `@fastify/multipart` with `attachFieldsToBody: 'keyValues'` in `before`: the fields and the
files are then properties of the body, and so of the input. A file is a `Buffer` (declare it `DTO.Binary()`), without
its name; a file over the limit is refused with 413.

### A web UI

`fallback` answers the requests outside the paths of the actions (`isActionPath()` above): with Express, `staticUI()`
serves a built single-page application, such as the `dist` directory of a Vite build:

```typescript
import {expressHTTPEntrypoint, staticUI} from 'lakutata/adapter/express'

export const http = expressHTTPEntrypoint({
    port: 8080,
    fallback: staticUI('./ui/dist')
})
```

- A file of the directory is sent as it is. The files with a content hash in their name (`index-B2x9fQ1a.js`) are
  cached by the browsers for a year (`assetsMaxAge`); the other files are checked again on each request.
- A `GET` request for a page (accepting HTML, its path without an extension) that matches no file is answered with the
  `index.html` of the application, whose router handles the path. `spa: false` turns this off, and `index` names
  another file.
- The other requests that match no file, such as a missing script, are answered with 404.
- The paths under the routes of the actions (`/api/…`) never reach the fallback: a request there that matches no action
  is answered with 404.

With Fastify, `fallback` is a handler of your own, `(request, reply) => …`, which receives every request outside the
paths of the actions.

## 8. From lakutata 2.x

An HTTP entrypoint function of 2.x (`buildHTTPEntrypoint`) keeps working: it is called in the startup of the entrypoint
(the objects it gets, such as an authenticator injecting the entrypoint, are available) and awaited, so the application
launches once its server listens. To move it to `expressHTTPEntrypoint`:

- the middlewares and the routes of the application (CORS, compression, a health check, the authenticator, a web UI) go
  into its `before` hook, which gets the objects with `module.getObject()`; the body parsers are its `body` option
  (`{limit: '100mb'}`); the `keepAliveTimeout` and `headersTimeout` of the server are its `server` option;
- the input built from the request (the query, the body, a value of the session) is its `input` option;
- the `{errno, errMsg, data}` envelope is `jsonEnvelope()`. The applications of 2.x usually answered the errors of the
  actions with 200, and the errors of their Express middlewares (`next(error)`: the 401 of an authenticator) with their
  status: `jsonEnvelope({actionErrorStatus: 200})` does the same. `errorStatus: 200` would answer the 401 with 200 too,
  and the clients that go to the login page on a 401 would miss it;
- the other fields of the envelope of the application (`timestamp`, `nonce`, a request id) come from its `extra` option,
  called for each response, results and errors alike. No responder of your own is needed to keep them.

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
            //The authenticator of the requests: its errors keep their status (401)
            app.use((request: Request, _response: Response, next: NextFunction): void => request.headers.authorization ? next() : next(new Unauthorized('Not logged in')))
        },
        //The errors of the actions answered with 200 in the envelope, as in 2.x, with its timestamp
        respond: jsonEnvelope({actionErrorStatus: 200, extra: (): Record<string, unknown> => ({timestamp: Date.now()})})
    })
})
```

With Fastify, `fastifyJSONEnvelope()` takes the same options, and the authenticator is a hook of Fastify.

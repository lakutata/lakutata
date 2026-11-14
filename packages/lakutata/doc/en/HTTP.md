# Lakutata HTTP

The HTTP adapters serve the HTTP actions of the controllers (`@GET`, `@POST`…) with Express or Fastify. This guide
describes what is specific to HTTP: the two adapters and their options, routes, how a request becomes an action's input,
responses, errors, and the web framework's own features. Controllers and their actions are described in [Controllers and
Actions](Controllers.md), middlewares and access control in [Middlewares and Access Control](Middlewares.md), and how
the adapters start and stop in [Entrypoint](Entrypoint.md).

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
| Node.js | 18.10 and later | 18.19, 19.9, 20 and later (Fastify 5 needs `diagnostics_channel.tracingChannel`) |

The options of `expressHTTPEntrypoint()`:

| Option | Default | Meaning |
|---|---|---|
| `port` | `80` | The port; `0` picks a free port. The launch fails when the port is already in use |
| `host` | all interfaces | The address to listen on, such as `'127.0.0.1'` for the local machine only |
| `name` | | The adapter's name, to distinguish several adapters |
| `body` | `{limit: '1mb'}` | The body size limit (`'5mb'`, or a number of bytes); `text`: the content types read as text (section 4); `false` parses no body |
| `server` | | Options for the Node.js HTTP server: `keepAliveTimeout`, `headersTimeout`, `requestTimeout`… |
| `app` | a new application | An existing Express application to add the actions to |
| `input` | the query and the body | Builds the input from the request (section 4) |
| `respond` | `JSONResponder` | Writes results and errors (section 6) |
| `middlewares` | | Middlewares for this adapter's actions, run after the entrypoint's |
| `before` | | `(app, context) => …`: adds the application's own middlewares and routes (section 7) |
| `fallback` | | Responds to requests outside the action paths, such as the pages of a web UI (section 7) |
| `stop` | | Called when the adapter stops, once its server is closed |
| `heartbeat` | `15000` | How often, in milliseconds, a comment keeps event streams alive (section 5) |
| `listening` | | `(server, listeners) => …`: called once the server listens, or once the interface's listeners are created (see below) |
| `interface` | | The network interface to listen on instead of an address, with `family`, `strict` and `onError` (see below) |

`fastifyHTTPEntrypoint()` takes the same options, except `server` and `app`, which are replaced by `fastify`: a Fastify
instance, or options for the instance to create (`bodyLimit`, 1 MiB by default; `trustProxy`; `connectionTimeout`,
`keepAliveTimeout`, `requestTimeout`; `logger`…). Its `body` option has only `text`, because the size limit is the
instance's `bodyLimit`.

Where they differ:

| | Express | Fastify |
|---|---|---|
| URL-encoded form bodies | Parsed | Refused with 415 |
| `this.context.request` | The Express request (`ip`, `get()`, `hostname`…) | The Node.js request |
| A wildcard route | `/files/*path`: the input contains `path: ['docs', 'a.txt']` | `/files/*`: the input contains `'*': 'docs/a.txt'` |
| HTTP methods other than `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `TRACE` | Accepted | Registered with `app.addHttpMethod()` in `before`; otherwise the adapter fails to start |
| A web UI as `fallback` | `staticUI()` (section 7) | Your own handler |
| The `errno` of framework errors | `E_UNKNOWN` | Its codes, such as `FST_ERR_CTP_BODY_TOO_LARGE` |
| A supplied application or instance, when the application stops | Left unchanged | Closed |

When the application stops (see [Entrypoint](Entrypoint.md), section 4), the adapters stop accepting connections and end
the event streams; Fastify also responds with 503 to requests that still arrive on open connections. Requests in
progress are given the entrypoint's `shutdownTimeout` (after which they receive a 503 response), then up to one second
to send their responses, before the remaining connections, including WebSockets, are closed.

### On a network interface

A device with several network interfaces often serves its pages on only one of them, and that interface's address comes
from DHCP and changes. With `interface`, the adapter listens on the interface instead of an address, whatever its
addresses, and continues listening when they change and when the interface is unplugged and plugged back in. By default
it uses the `@lakutata/netif` package, installed separately, which compiles a native addon (see [Netif](Netif.md)).

```typescript
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

//The pages on eth1 only, whatever its address
export const http = expressHTTPEntrypoint({
    port: 8080,
    interface: 'eth1',
    listening: (_server, listeners): void => console.log(listeners?.map(listener => listener.addresses))
})
```

| Option | Default | Meaning |
|---|---|---|
| `interface` | | The interface's name (`'eth1'`; on Windows, the network connection's name), `{mac: '52:54:00:12:34:56'}` or `{index: 3}`; several in an array, in which case `port` cannot be `0`. It cannot be specified with `host` |
| `family` | `'both'` | `'IPv4'`, `'IPv6'` or both |
| `strict` | `false` | Makes the adapter fail to start where the system cannot refuse connections that reach the interface's addresses through another interface, and stop listening while it cannot (see [Netif](Netif.md), section 2) |
| `onError` | the application's log | Receives the errors of listening again while the application runs, such as a port taken by another program; the adapter retries automatically |
| `interfaceListening` | `@lakutata/netif` | Another implementation of interface listening: an `IInterfaceListening`, the Lakutata contract that `@lakutata/netif` implements |

- The interface may not exist yet when the application launches (a USB network adapter not plugged in): the launch
  succeeds, and the adapter listens once the interface appears. Until then, the listeners' `addresses` are empty.
- The server itself does not listen, and its `address()` is `null`: the listeners provide the port and the addresses.
- Creating the adapter fails when `family`, `strict`, `onError` or `interfaceListening` is specified without
  `interface`, and when `interface` and `host` are specified together.

## 3. Routes

| Decorator | Methods |
|---|---|
| `@GET(route)`, `@POST`, `@PUT`, `@PATCH`, `@DELETE`, `@HEAD`, `@OPTIONS` | The method it is named after |
| `@HTTPAction(route, method)` | One method (`'purge'`), or a list (`['get', 'post']`) |

Each of them then takes the input's DTO and the action options, both optional (see [Controllers and
Actions](Controllers.md), section 3).

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

- A route uses the web framework's syntax: `:id` is a parameter in both; the wildcards differ (section 2).
- `@Prefix({route})` prepends a prefix to a controller's routes (see [Controllers and Actions](Controllers.md), section
  6).
- A `GET` action also responds to `HEAD` requests on its route, without a body, unless the route has a `HEAD` action.
- A request whose method has no action on its route receives a 404 response (`E_ROUTE_NOT_FOUND`), not 405. Nothing
  responds to `OPTIONS` automatically: browser preflight requests fail until a CORS middleware responds to them (section
  7).

## 4. The input

By default, an action's input is the query, with the body's properties merged over it, then the route parameters over
both:

```text
POST /orders/7?id=1&note=a   with the body {"id": 5, "note": "b"}   →   {id: '7', note: 'b'}
```

The action's DTO then validates it, and removes the keys it does not declare. `this.context.data` is the input before
validation, without the route parameters.

- **Text.** Query values and route parameters are strings: a number or boolean schema needs `.strict(false)` to accept
  `'42'` or `'true'`.
- **The query.** A repeated key is an array (`?tag=a&tag=b` → `tag: ['a', 'b']`). With Express 5 and Fastify, brackets
  do not nest: `?filter[status]=open` produces the key `'filter[status]'`.
- **JSON bodies.** An array produces no usable input (Express spreads its items under numbered keys, Fastify ignores
  it): send a list inside an object (`{"items": [...]}`).
- **Forms.** Express parses URL-encoded bodies and nests their brackets (`a[b]=1` → `a: {b: '1'}`); Fastify refuses
  them with 415. Neither parses `multipart/form-data`, used for file uploads (section 7).
- **Other text.** The content types listed in `body.text` (`['application/sdp']`, or `'text/*'` for a whole type) are
  read as text and passed to the action in its input's `body` property. Fastify refuses other types that it does not
  parse with 415.
- **Limits.** A body over the limit is refused with 413, malformed JSON with 400.

The `input` option builds the input from the request. For example, to pass the client's address and language to the
actions (only DTOs that declare `ip` and `language` keep them):

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

The route parameters are always merged over the result. With Express, an action can also read the request directly:
`(this.context as HTTPContext).request as unknown as Request` returns the Express request, with `ip`, `get()` and the
properties its middlewares add. With Fastify, `this.context.request` is the Node.js request: pass `request.ip` to the
action through `input`.

## 5. The response

- A value is sent as JSON; `undefined` results in a 204 response.
- `Result.status(status, data?, headers?)` sends a status and headers with the data, or without data.
- `Result.file(source, options?)` sends a file: its path (relative to the working directory), a `Buffer` or a stream.
  `filename` makes it a download; `contentType` sets its type, otherwise taken from the extension of its name; `etag`
  sends `ETag` and responds with 304 when the request's `If-None-Match` matches it.
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

Events are written as the standard defines them. The data is written as JSON (a string unchanged, one `data:` line per
line), preceded by the event's ID and name when they are specified:

```text
id: 1
event: tick
data: {"n":1}

data: line one
data: line two
```

- A comment (`: ping`) is sent every `heartbeat` milliseconds, so that proxies keep the connection open.
- The stream ends when the producer returns or fails; a failure sends nothing more, because the headers have already
  been sent. `signal` is aborted when the client leaves or the application stops.
- The producer runs after the request's scope is destroyed: it should use components, not the request's providers.

An action can also write the response itself through `this.context.response`, the Node.js response. Once the action has
sent the headers, the adapter writes neither its result nor its error. When the client leaves before the response,
`this.signal` is aborted, and nothing is written.

## 6. Errors

The response to an error is a status and `{errno, errMsg}`:

- the status is the first client error (4xx) found in the `statusCode` or `status` of the error or its causes (`cause`),
  otherwise its own status when it is between 400 and 599, otherwise 500;
- `errno` and `errMsg` come from the error itself: its `errno`, otherwise its `code`, otherwise `E_UNKNOWN`; its
  `errMsg`, otherwise its `message`. The response to `new Error('Lookup failed', {cause: notFound})` therefore has its
  cause's 404 status and the body `{"errno": "E_UNKNOWN", "errMsg": "Lookup failed"}`.

| Status | `errno` | When |
|---|---|---|
| 400 | `E_INVALID_VALUE` | The DTO refused the input |
| 400 | `E_UNKNOWN` (Express), `FST_ERR_CTP_INVALID_JSON_BODY` (Fastify) | The body's JSON is malformed |
| 403 | `E_ACCESS_DENY` | Access control refused the request (see [Middlewares and Access Control](Middlewares.md)) |
| 404 | `E_ROUTE_NOT_FOUND` | No action has this route and method |
| 413 | `E_UNKNOWN` (Express), `FST_ERR_CTP_BODY_TOO_LARGE` (Fastify) | The body is over the limit |
| 415 | `FST_ERR_CTP_INVALID_MEDIA_TYPE` | Fastify does not parse this type of body |
| 503 | `E_ENTRYPOINT_STOPPED` | The application is stopping |
| 500 | The error's | Any other error |

An application exception provides its own `errno` and `statusCode`, as `OrderNotFoundException` does in section 1.

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

- A result is `{errno: null, errMsg: null, data}`, with status 200 when there is no data (`data` is `null`).
- An error is `{errno, errMsg, data: null}`, with its status. `errorStatus` sets the status of every error, such as 200
  for clients that read errors from the envelope. `actionErrorStatus` sets the status of action errors only (their
  validation, access control and exceptions): a route not found and errors from the web framework's middlewares keep
  their own status.
- `extra(request)` adds fields to every response, after `errno`, `errMsg` and `data`, which they never replace.

**A custom responder** is an object with two methods, passed to `respond`: `success(response, data, request)` and
`error(response, error, request, origin)`. `origin` is `'action'` when the request reached an action, and `'request'`
when it failed before that (in a web framework middleware, or a route not found). `statusOfError()` and
`describeError()`, from the adapter's subpath, compute the status and the `{errno, errMsg}` described above. Files and
event streams do not go through the responder.

## 7. The features of the web framework

The `before` hook receives the Express application or the Fastify instance before the action routes are added. Its
middlewares, plugins and routes come first: a route it adds takes precedence over an action with the same path. Its
second argument provides:

| Property | What it is |
|---|---|
| `module` | The entrypoint's module, to obtain objects: `await module.getObject('db')` |
| `server` | The HTTP server, not listening yet: a WebSocket server can be attached to it |
| `routes` | The action routes, each with its methods |
| `actionPrefixes`, `isActionPath(path)` | The first segments of the action routes, and whether a path is under one of them |

The launch fails when `before` fails. With Express, the body parsers are added after `before`: its middlewares do not
see a parsed body.

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
and pass its file to the input:

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

Multer's errors, such as a file over its limit (`LIMIT_FILE_SIZE`), have no status: they result in a 500 response.

With Fastify, register `@fastify/multipart` with `attachFieldsToBody: 'keyValues'` in `before`: the fields and files
then become properties of the body, and therefore of the input. A file is a `Buffer` (declare it `DTO.Binary()`),
without its name; a file over the limit is refused with 413.

### A web UI

`fallback` responds to requests outside the action paths (`isActionPath()` above). With Express, `staticUI()` serves a
built single-page application, such as a Vite build's `dist` directory:

```typescript
import {expressHTTPEntrypoint, staticUI} from 'lakutata/adapter/express'

export const http = expressHTTPEntrypoint({
    port: 8080,
    fallback: staticUI('./ui/dist')
})
```

- A file in the directory is sent unchanged. Files with a content hash in their name (`index-B2x9fQ1a.js`) are cached by
  browsers for a year (`assetsMaxAge`); other files are revalidated on each request.
- A `GET` request for a page (one that accepts HTML and whose path has no extension) that matches no file receives the
  application's `index.html`, whose router handles the path. `spa: false` turns this off, and `index` names another
  file.
- Other requests that match no file, such as a missing script, receive a 404 response.
- Paths under the action routes (`/api/…`) never reach the fallback: a request there that matches no action receives a
  404 response.

With Fastify, `fallback` is a custom handler, `(request, reply) => …`, which receives every request outside the action
paths.

## 8. From Lakutata 2.x

A 2.x HTTP entrypoint function (`buildHTTPEntrypoint`) keeps working: it is called during the entrypoint's startup (the
objects it obtains, such as an authenticator injecting the entrypoint, are available) and awaited, so the application
launches once its server listens. To migrate it to `expressHTTPEntrypoint`:

- the application's middlewares and routes (CORS, compression, a health check, the authenticator, a web UI) go into its
  `before` hook, which obtains objects with `module.getObject()`; the body parsers become its `body` option
  (`{limit: '100mb'}`); the server's `keepAliveTimeout` and `headersTimeout` become its `server` option;
- the input built from the request (the query, the body, a session value) becomes its `input` option;
- the `{errno, errMsg, data}` envelope becomes `jsonEnvelope()`. Applications written for 2.x usually responded to
  action errors with 200, and to errors from their Express middlewares (`next(error)`, such as an authenticator's 401)
  with their status; `jsonEnvelope({actionErrorStatus: 200})` does the same. `errorStatus: 200` would send the 401 with
  status 200 as well, and clients that go to the login page on a 401 would miss it;
- the application's other envelope fields (`timestamp`, `nonce`, a request ID) come from its `extra` option, called for
  each response, results and errors alike. No custom responder is needed to keep them.

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

With Fastify, `fastifyJSONEnvelope()` takes the same options, and the authenticator is a Fastify hook.

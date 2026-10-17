# A web application with a user interface

This example builds a shared shopping list: a web page that everyone in a household opens on a phone or a computer,
where they all see the same list, add what is missing and remove what they have bought. It starts from the `web-react`
template, a workspace of two packages: the application, which serves an HTTP API under `/api`, and a React page, built
by Vite, which calls it. The example shows how the page reaches the API: through the Vite dev server during
development, and directly once built, when the application serves the page itself. It also shows how a bundle carries
the page among its resources, and how to test the API.

| Method | Route | What it does |
|---|---|---|
| `GET` | `/api/items` | Lists the items |
| `POST` | `/api/items` | Adds an item, `{"name": "Milk"}`, and answers with the list |
| `DELETE` | `/api/items/:id` | Removes an item, and answers with the list |
| `GET` | `/`, and any other page | The list page: the built `ui` package |

## 1. Create the project

```bash
npx @lakutata/cli create --name shopping --template web-react --yes
cd shopping
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
rm packages/app/src/middlewares/Authenticate.ts
```

The project is a workspace ([ProjectStructure](../ProjectStructure.md)): `packages/app` is the application, and
`packages/ui` the React page. The example controller of the template is removed, and so is its middleware
`Authenticate.ts`, which asks for a token that a page in a browser cannot keep secret. Anyone who can reach the
application can use the list, which is fine on a home network; section 11 says what to do elsewhere.

## 2. The list

**`packages/app/src/components/ShoppingList.ts`**

```typescript
import {Component} from 'lakutata'

/**
 * An item of the list
 */
export interface Item {
    id: number
    name: string
}

/**
 * The shopping list, kept in memory: one instance, shared by all the requests
 */
export class ShoppingList extends Component {

    protected readonly items: Map<number, Item> = new Map()

    protected lastId: number = 0

    /**
     * The items, in the order they were added
     */
    public all(): Item[] {
        return [...this.items.values()]
    }

    /**
     * Add an item
     * @param name
     */
    public add(name: string): void {
        const item: Item = {id: ++this.lastId, name: name}
        this.items.set(item.id, item)
    }

    /**
     * Remove an item; nothing happens when it was already removed
     * @param id
     */
    public remove(id: number): void {
        this.items.delete(id)
    }
}
```

A controller lives for one request only ([Controllers](../Controllers.md)), so it cannot keep the list. A component
keeps it instead: it is created once and shared by the whole application ([Objects](../Objects.md)). The list is held
in memory, so it is lost when the application stops (section 11).

## 3. The input

**`packages/app/src/dtos/ItemDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * A new item, its name trimmed (strict(false) lets trim() remove the spaces around it)
 */
export class NewItemDTO extends DTO {
    @Expect(DTO.String().trim().strict(false).min(1).max(100).required())
    public name: string
}

/**
 * An item by its id (the :id of the route: text, converted by strict(false))
 */
export class ItemIdDTO extends DTO {
    @Expect(DTO.Number().integer().positive().strict(false).required())
    public id: number
}
```

Each action validates its input with a DTO, and refuses invalid input ([DTOValidation](../DTOValidation.md)):

- the schemas are strict: `.trim()` alone would refuse `'  Bread  '`. With `.strict(false)`, it removes the spaces, and
  a name made of spaces only is refused as empty;
- the `:id` of the route is text: `.strict(false)` converts `'1'` to the number 1.

## 4. The controller

**`packages/app/src/controllers/ItemController.ts`**

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {DELETE, GET, POST, Prefix} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {type Item, ShoppingList} from '../components/ShoppingList.js'
import {ItemIdDTO, NewItemDTO} from '../dtos/ItemDTO.js'

@Prefix({route: '/api/items'})
export class ItemController extends Controller {

    /**
     * The list (the component "list" of the options)
     */
    @Inject('list')
    protected readonly list: ShoppingList

    /**
     * GET /api/items
     */
    @GET('/')
    public async all(): Promise<Item[]> {
        return this.list.all()
    }

    /**
     * POST /api/items {"name": "Milk"}: the list with the new item
     * @param input
     */
    @POST('/', NewItemDTO)
    public async add(input: NewItemDTO): Promise<Item[]> {
        this.list.add(input.name)
        return this.list.all()
    }

    /**
     * DELETE /api/items/1: the list without the item
     * @param input
     */
    @DELETE('/:id', ItemIdDTO)
    public async remove(input: ItemIdDTO): Promise<Item[]> {
        this.list.remove(input.id)
        return this.list.all()
    }
}
```

- `@Prefix({route: '/api/items'})` puts the actions under `/api/items` ([HTTP](../HTTP.md)). Keeping the API under
  `/api` leaves the other paths to the pages of the application (section 5).
- `@Inject('list')` gives the controller the `list` component of the options.
- `POST` and `DELETE` answer with the whole list, so the page can show it at once, including the changes made by
  others.
- Removing an item that is already removed is not an error: two people may remove the same item at the same time.

## 5. The options of the application

**`packages/app/src/config/Config.ts`**

```typescript
import {resourcesPath, type ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint, jsonEnvelope, staticUI} from 'lakutata/adapter/express'
import compression from 'compression'
import {existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {ShoppingList} from '../components/ShoppingList.js'
import {HealthController} from '../controllers/HealthController.js'
import {ItemController} from '../controllers/ItemController.js'

/**
 * The directory of the built ui package, undefined before it is built (in development, Vite serves the page): among the
 * resources of a packed application (lakutata package bundle or lakutata package exe, from "lakutata.resources" in its
 * package.json), otherwise in the ui package
 */
function uiDirectory(): string | undefined {
    const resources: string | undefined = resourcesPath()
    try {
        const directory: string = resources ? path.join(resources, 'ui') : path.join(path.dirname(createRequire(import.meta.url).resolve('ui/package.json')), 'dist')
        return existsSync(path.join(directory, 'index.html')) ? directory : undefined
    } catch {
        return undefined
    }
}

/**
 * The options of the service
 * @param port the port of the HTTP server, the PORT environment variable or 8080 by default
 */
export function config(port: number = Number(process.env.PORT ?? 8080)): ApplicationOptions {
    return {
        id: 'shopping',
        name: 'shopping',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //The shopping list, created when a request first needs it
            list: {class: ShoppingList},
            entrypoint: buildEntrypoints({
                controllers: [HealthController, ItemController],
                http: expressHTTPEntrypoint({
                    port: port,
                    //The results and the errors are {errno, errMsg, data}, with the status 200
                    respond: jsonEnvelope({errorStatus: 200}),
                    body: {limit: '100mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    before: (app): void => void app.use(compression()),
                    //The paths that no action handles are the pages of the application
                    fallback: ((directory: string | undefined) => directory ? staticUI(directory) : undefined)(uiDirectory())
                })
            })
        },
        bootstrap: ['entrypoint']
    }
}
```

This is the `Config.ts` of the template, with the `list` component, the `ItemController` instead of the example
controller, and without the `authenticate` middleware. The code that serves the page comes from the template:

- `fallback` answers the requests that match no action route (`/api/…` and `/health`). `staticUI()` sends the files of
  the built page, and its `index.html` for any page path, which the page's own router then handles
  ([HTTP](../HTTP.md)).
- `uiDirectory()` finds the built page: among the resources of a packed application (`resourcesPath()`, section 11),
  otherwise in the `dist` directory of the `ui` package. Before the page is built, there is no fallback: in
  development, Vite serves the page.
- `jsonEnvelope({errorStatus: 200})` sends both the results and the errors as `{errno, errMsg, data}` with the status
  200: the page tells them apart by their `errno`.

## 6. The calls to the API

**`packages/ui/src/api.ts`**

```typescript
/**
 * An item of the list
 */
export type Item = {
    id: number
    name: string
}

/**
 * A request to the API of the application, on the page's own origin: returns the data of its {errno, errMsg, data}, or
 * throws its error
 * @param method
 * @param route
 * @param body
 */
async function request<T>(method: string, route: string, body?: unknown): Promise<T> {
    const response: Response = await fetch(`/api${route}`, {
        method: method,
        headers: {'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    const result = await response.json() as { errno: string | null, errMsg: string | null, data: T }
    if (result.errno) throw new Error(result.errMsg ?? result.errno)
    return result.data
}

export const listItems = (): Promise<Item[]> => request('GET', '/items')

export const addItem = (name: string): Promise<Item[]> => request('POST', '/items', {name: name})

export const removeItem = (id: number): Promise<Item[]> => request('DELETE', `/items/${id}`)
```

The page calls the API by its path only (`/api/items`), so the requests go to the origin the page came from: the Vite
dev server during development, the application once built. The address of the API is configured nowhere, and the
browser makes no cross-origin request, which would need CORS. `request()` returns the `data` of the envelope, or throws
its error, whose message the page shows, such as `"name" is not allowed to be empty`.

## 7. The page

**`packages/ui/src/App.tsx`**

```tsx
import {type FormEvent, useEffect, useState} from 'react'
import {addItem, type Item, listItems, removeItem} from './api'

export function App() {
    const [items, setItems] = useState<Item[]>([])
    const [name, setName] = useState<string>('')
    const [error, setError] = useState<string>('')

    /**
     * Show the list that the API returns, or its error
     * @param answer
     */
    async function show(answer: Promise<Item[]>): Promise<boolean> {
        try {
            setItems(await answer)
            setError('')
            return true
        } catch (failure) {
            setError((failure as Error).message)
            return false
        }
    }

    //Load the list now, then every 5 seconds, so that the changes made by others appear
    useEffect((): (() => void) => {
        void show(listItems())
        const timer: number = window.setInterval((): void => void show(listItems()), 5000)
        return (): void => window.clearInterval(timer)
    }, [])

    async function add(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault()
        if (await show(addItem(name))) setName('')
    }

    return (
        <main>
            <h1>Shopping list</h1>
            <form onSubmit={add}>
                <input value={name} onChange={(event): void => setName(event.target.value)} placeholder="Milk, bread…" aria-label="Item"/>
                <button>Add</button>
            </form>
            {error && <p role="alert">{error}</p>}
            {items.length === 0 && <p>The list is empty.</p>}
            <ul>
                {items.map((item: Item) => (
                    <li key={item.id}>
                        {item.name} <button onClick={(): void => void show(removeItem(item.id))}>Remove</button>
                    </li>
                ))}
            </ul>
        </main>
    )
}
```

- `show()` shows the list that the API returns, or its error.
- The list is loaded when the page opens, then every 5 seconds, so the items added or removed on other phones appear.
- The `main.tsx` of the template, which renders `App`, does not change.

## 8. Run it

```bash
npm run dev
```

This runs the `dev` scripts of both packages at once ([Workspaces](../Workspaces.md)): the application is built and
listens on port 8080, and Vite serves the page from its sources on http://localhost:5173, reloading it in the browser
when they change. Open http://localhost:5173. The `vite.config.ts` of the template forwards the requests under `/api`
to the application:

```typescript
server: {
    proxy: {
        '/api': `http://127.0.0.1:${process.env.PORT ?? 8080}`
    }
}
```

So the API can also be called through Vite, the way the page calls it:

```bash
curl -X POST localhost:5173/api/items -H 'Content-Type: application/json' -d '{"name": "Milk"}'
# {"errno":null,"errMsg":null,"data":[{"id":1,"name":"Milk"}]}

curl -X POST localhost:5173/api/items -H 'Content-Type: application/json' -d '{"name": "  Bread  "}'
# {"errno":null,"errMsg":null,"data":[{"id":1,"name":"Milk"},{"id":2,"name":"Bread"}]}

curl -X DELETE localhost:5173/api/items/1
# {"errno":null,"errMsg":null,"data":[{"id":2,"name":"Bread"}]}

curl -i -X POST localhost:5173/api/items -H 'Content-Type: application/json' -d '{"name": ""}'
# HTTP/1.1 200 OK
# {"errno":"E_INVALID_VALUE","errMsg":"\"name\" is not allowed to be empty","data":null}
```

Changes to the page show at once. Changes to the application need `npm run dev` again, as its `dev` script builds it,
then starts it. If `npm run build` has run before, the application also serves the page of that build on port 8080;
during development, use the page from Vite, which is up to date.

## 9. Test it

The test of the template is replaced by a test of the list. It starts the application on its own port, calls the API,
then requests the page:

**`packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Application} from 'lakutata'
import {config} from '../config/Config.js'

const PORT: number = Number(process.env.TEST_PORT ?? 18083)

/**
 * A request to the API: its {errno, errMsg, data}
 * @param method
 * @param route
 * @param body
 */
async function request(method: string, route: string, body?: unknown): Promise<{ errno: string | null, errMsg: string | null, data: any }> {
    const response: Response = await fetch(`http://127.0.0.1:${PORT}${route}`, {
        method: method,
        headers: {'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    return await response.json() as { errno: string | null, errMsg: string | null, data: any }
}

describe('shopping', (): void => {

    let app: Application

    before(async (): Promise<void> => {
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config(PORT)).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
    })

    it('adds, lists and removes the items', async (): Promise<void> => {
        assert.deepStrictEqual((await request('GET', '/api/items')).data, [])
        await request('POST', '/api/items', {name: 'Milk'})
        const added = await request('POST', '/api/items', {name: '  Bread  '})
        assert.deepStrictEqual(added.data, [{id: 1, name: 'Milk'}, {id: 2, name: 'Bread'}])
        assert.deepStrictEqual((await request('DELETE', '/api/items/1')).data, [{id: 2, name: 'Bread'}])
        //Removing it again changes nothing: someone else may have removed it first
        assert.deepStrictEqual((await request('DELETE', '/api/items/1')).data, [{id: 2, name: 'Bread'}])
        assert.deepStrictEqual((await request('GET', '/api/items')).data, [{id: 2, name: 'Bread'}])
    })

    it('refuses an item without a name', async (): Promise<void> => {
        assert.deepStrictEqual(await request('POST', '/api/items', {name: ' '}), {errno: 'E_INVALID_VALUE', errMsg: '"name" is not allowed to be empty', data: null})
    })

    it('serves the page of the list', async (): Promise<void> => {
        const response: Response = await fetch(`http://127.0.0.1:${PORT}/`, {headers: {Accept: 'text/html'}})
        assert.strictEqual(response.status, 200)
        assert.match(await response.text(), /<div id="root"><\/div>/)
    })
})
```

```bash
npm test
```

```
app │   ✔ adds, lists and removes the items
app │   ✔ refuses an item without a name
app │   ✔ serves the page of the list
app │ ℹ pass 3
✔ test ran in app
```

`npm test` builds the packages first, so the built page is there for the last test. The tests cover the API, not the
React code; `npm run typecheck -w ui` checks the types of the page, which the Vite build does not.

## 10. Build it

```bash
npm run build
```

```
ui  │ dist/index.html                  0.31 kB │ gzip:  0.22 kB
ui  │ dist/assets/index-D0SES_81.js  220.75 kB │ gzip: 69.11 kB
ui  │ ✓ built in 49ms
app │ > tsc
✔ rebuild ran in ui, app
```

The `ui` package is built first, as the application depends on it (`"ui": "^0.0.1"` in its `package.json`): Vite
writes the page into `packages/ui/dist`, then `tsc` compiles the application into `packages/app/build`.

```bash
npm start
```

The application now serves both the API and the page, from one process and one port: http://localhost:8080. It
listens on all interfaces, so the phones on the network open the page at the computer's address, on port 8080.

```bash
curl -i localhost:8080/ -H 'Accept: text/html'
# HTTP/1.1 200 OK
# Cache-Control: no-cache
# Content-Type: text/html; charset=utf-8
#
# <!doctype html>
# ...
#     <script type="module" crossorigin src="/assets/index-D0SES_81.js"></script>
# ...

curl -I localhost:8080/assets/index-D0SES_81.js
# HTTP/1.1 200 OK
# Cache-Control: public, max-age=31536000, immutable
# Content-Type: text/javascript; charset=utf-8
```

Browsers check `index.html` again on each request, and keep the scripts for a year, as their names hold a hash of
their content: a new build shows up at once.

## 11. Package it

The `package.json` of the application, from the template, declares the built page as a resource:

```json
"lakutata": {
  "resources": [
    {
      "from": "../ui/dist",
      "to": "ui"
    }
  ]
}
```

A packed application carries its resources, and `resourcesPath()` gives their directory, where `uiDirectory()`
(section 5) finds the page ([Packaging](../Packaging.md)). A bundle, for example:

```bash
npm install --save-dev @lakutata/builder
npm run build
cd packages/app
npx lakutata package bundle
```

```
✔ dist/app.cjs (1.7 MB): node dist/app.cjs
✔ dist/app.resources: the resources (ui), distributed with the bundle
```

`dist/app.cjs` and `dist/app.resources` are the whole application: copy them together to a machine with Node.js, and
`node app.cjs` serves the API and the page, without `node_modules`.

- `npm run docker:build` builds the image of the application with the `Dockerfile` of the template, page included.
- The list is lost when the application stops: keep it in a database, as in
  [A REST API with a database](RestAPI.md).
- Anyone who can reach the application can change the list. Outside a home network, put it behind a reverse proxy
  that asks for a login, or authenticate the users in a middleware ([Middlewares](../Middlewares.md)).

<!--
check:
  create: shopping web-react
  remove: packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
  remove: packages/app/src/middlewares/Authenticate.ts
  run: npm test
  run: npm run typecheck -w ui
  run: cd packages/app && npx lakutata package bundle && test -f dist/app.resources/ui/index.html
-->

# 带界面的 Web 应用

这个示例构建一个共享的购物清单：家里每个人都可以在手机或电脑上打开同一个网页，看到同一份清单，把缺的东西加进去，把买到的删掉。它从 `web-react` 模板开始，项目是一个包含两个包的工作区：应用在 `/api` 下提供 HTTP API，由 Vite 构建的 React 页面调用这个 API。示例展示页面如何访问 API：开发时经由 Vite 的开发服务器，构建之后则由应用自己提供页面；还展示单文件包如何把页面作为资源带上，以及如何测试 API。

| 方法 | 路由 | 作用 |
|---|---|---|
| `GET` | `/api/items` | 列出所有条目 |
| `POST` | `/api/items` | 添加一项：`{"name": "Milk"}`，返回整个清单 |
| `DELETE` | `/api/items/:id` | 删除一项，返回整个清单 |
| `GET` | `/` 以及其他页面 | 清单页面，即构建好的 `ui` 包 |

## 1. 创建项目

```bash
npx @lakutata/cli create --name shopping --template web-react --yes
cd shopping
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
rm packages/app/src/middlewares/Authenticate.ts
```

项目是一个工作区（见 [ProjectStructure](../ProjectStructure.md)）：`packages/app` 是应用，`packages/ui` 是 React 页面。这里删掉了模板中的示例控制器，也删掉了中间件 `Authenticate.ts`：它要求请求带上一个令牌，而浏览器中的页面无法保管这样的秘密。任何能访问到应用的人都能使用这份清单，在家庭网络中这没有问题；其他场合的做法见第 11 节。

## 2. 清单

**`packages/app/src/components/ShoppingList.ts`**

```typescript
import {Component} from 'lakutata'

/**
 * 清单中的一项
 */
export interface Item {
    id: number
    name: string
}

/**
 * 购物清单，保存在内存中：只有一个实例，所有请求共用
 */
export class ShoppingList extends Component {

    protected readonly items: Map<number, Item> = new Map()

    protected lastId: number = 0

    /**
     * 所有条目，按添加的先后排列
     */
    public all(): Item[] {
        return [...this.items.values()]
    }

    /**
     * 添加一项
     * @param name
     */
    public add(name: string): void {
        const item: Item = {id: ++this.lastId, name: name}
        this.items.set(item.id, item)
    }

    /**
     * 删除一项；这一项已经删除时什么也不做
     * @param id
     */
    public remove(id: number): void {
        this.items.delete(id)
    }
}
```

控制器只在一个请求期间存在（见 [Controllers](../Controllers.md)），所以清单不能放在控制器里，而是放在组件中：组件只创建一次，由整个应用共用（见 [Objects](../Objects.md)）。清单保存在内存中，应用停止后就会丢失（见第 11 节）。

## 3. 输入

**`packages/app/src/dtos/ItemDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * 新条目，名称去掉首尾的空格（有了 strict(false)，trim() 才会去掉空格）
 */
export class NewItemDTO extends DTO {
    @Expect(DTO.String().trim().strict(false).min(1).max(100).required())
    public name: string
}

/**
 * 按 id 指定的条目（路由中的 :id 是文本，由 strict(false) 转换）
 */
export class ItemIdDTO extends DTO {
    @Expect(DTO.Number().integer().positive().strict(false).required())
    public id: number
}
```

每个动作在运行前都会用 DTO 校验输入，拒绝不合法的输入（见 [DTOValidation](../DTOValidation.md)）：

- 规则默认是严格的：只写 `.trim()` 时，`'  Bread  '` 会被拒绝；加上 `.strict(false)` 后，它会去掉两端的空格，只含空格的名称去掉空格后为空，会被拒绝；
- 路由中的 `:id` 是文本：`.strict(false)` 把 `'1'` 转换为数字 1。

## 4. 控制器

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
     * 购物清单（选项中的 "list" 组件）
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
     * POST /api/items {"name": "Milk"}：返回加入新条目后的清单
     * @param input
     */
    @POST('/', NewItemDTO)
    public async add(input: NewItemDTO): Promise<Item[]> {
        this.list.add(input.name)
        return this.list.all()
    }

    /**
     * DELETE /api/items/1：返回删除这一项后的清单
     * @param input
     */
    @DELETE('/:id', ItemIdDTO)
    public async remove(input: ItemIdDTO): Promise<Item[]> {
        this.list.remove(input.id)
        return this.list.all()
    }
}
```

- `@Prefix({route: '/api/items'})` 把这些动作放在 `/api/items` 之下（见 [HTTP](../HTTP.md)）。API 都放在 `/api` 下，其他路径就可以留给应用的页面（见第 5 节）。
- `@Inject('list')` 把选项中的 `list` 组件交给控制器。
- `POST` 和 `DELETE` 返回整个清单，页面可以立即显示它，其中也包括别人做的修改。
- 删除已经删除的条目不算错误：两个人可能同时删掉同一项。

## 5. 应用的选项

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
 * 构建好的 ui 包所在的目录，构建之前为 undefined（开发时由 Vite 提供页面）：打包后的应用（lakutata package bundle 或
 * lakutata package exe）在资源中找（来自 package.json 中的 "lakutata.resources"），否则在 ui 包中找
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
 * 服务的选项
 * @param port HTTP 服务器的端口，默认取环境变量 PORT，没有时为 8080
 */
export function config(port: number = Number(process.env.PORT ?? 8080)): ApplicationOptions {
    return {
        id: 'shopping',
        name: 'shopping',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //购物清单，第一个用到它的请求到来时创建
            list: {class: ShoppingList},
            entrypoint: buildEntrypoints({
                controllers: [HealthController, ItemController],
                http: expressHTTPEntrypoint({
                    port: port,
                    //结果和错误都是 {errno, errMsg, data}，状态码都是 200
                    respond: jsonEnvelope({errorStatus: 200}),
                    body: {limit: '100mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    before: (app): void => void app.use(compression()),
                    //没有动作处理的路径都是应用的页面
                    fallback: ((directory: string | undefined) => directory ? staticUI(directory) : undefined)(uiDirectory())
                })
            })
        },
        bootstrap: ['entrypoint']
    }
}
```

这是模板中的 `Config.ts`，加入了 `list` 组件，用 `ItemController` 替换了示例控制器，并去掉了 `authenticate` 中间件。提供页面的代码沿用模板：

- `fallback` 响应动作路由（`/api/…` 和 `/health`）之外的请求。`staticUI()` 发送构建好的页面中的文件；对于页面的路径，它返回页面的 `index.html`，由页面自己的路由处理（见 [HTTP](../HTTP.md)）。
- `uiDirectory()` 查找构建好的页面：打包后的应用在资源中找（`resourcesPath()`，见第 11 节），否则在 `ui` 包的 `dist` 目录中找。页面构建之前没有 `fallback`：开发时由 Vite 提供页面。
- `jsonEnvelope({errorStatus: 200})` 让结果和错误都以 `{errno, errMsg, data}` 返回，状态码都是 200：页面根据 `errno` 区分两者。

## 6. 调用 API

**`packages/ui/src/api.ts`**

```typescript
/**
 * 清单中的一项
 */
export type Item = {
    id: number
    name: string
}

/**
 * 向应用的 API 发一个请求（与页面同源）：返回 {errno, errMsg, data} 中的 data，出错时抛出错误
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

页面只用路径调用 API（`/api/items`），所以请求发往页面所在的源：开发时是 Vite 的开发服务器，构建之后是应用本身。不需要在任何地方配置 API 的地址，浏览器也不会发出需要 CORS 的跨域请求。`request()` 返回封套中的 `data`，出错时抛出错误，页面会显示错误消息，例如 `"name" is not allowed to be empty`。

## 7. 页面

**`packages/ui/src/App.tsx`**

```tsx
import {type FormEvent, useEffect, useState} from 'react'
import {addItem, type Item, listItems, removeItem} from './api'

export function App() {
    const [items, setItems] = useState<Item[]>([])
    const [name, setName] = useState<string>('')
    const [error, setError] = useState<string>('')

    /**
     * 显示 API 返回的清单，出错时显示错误
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

    //先加载一次清单，之后每 5 秒加载一次，这样别人做的修改也会显示出来
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

- `show()` 把 API 返回的清单显示在页面上，出错时显示错误。
- 页面打开时加载清单，之后每 5 秒重新加载一次：其他手机上添加或删除的条目也会显示出来。
- 模板中的 `main.tsx` 负责渲染 `App`，保持不变。

## 8. 运行

```bash
npm run dev
```

这条命令同时运行两个包的 `dev` 脚本（见 [Workspaces](../Workspaces.md)）：应用先构建，再在 8080 端口监听；Vite 在 http://localhost:5173 上直接用源码提供页面，源码改动后浏览器中的页面会随之更新。打开 http://localhost:5173 即可。模板中的 `vite.config.ts` 把 `/api` 下的请求转发给应用：

```typescript
server: {
    proxy: {
        '/api': `http://127.0.0.1:${process.env.PORT ?? 8080}`
    }
}
```

所以经由 Vite 也能访问 API，和页面的调用方式相同：

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

页面的改动会立即生效。应用的改动则要重新运行 `npm run dev`，因为应用的 `dev` 脚本是先构建再启动。如果之前运行过 `npm run build`，应用也会在 8080 端口提供那次构建出的页面：开发时请使用 Vite 提供的页面，它才是最新的。

## 9. 测试

模板中的测试换成了针对清单的测试。它在自己的端口上启动应用，调用 API，然后请求页面：

**`packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Application} from 'lakutata'
import {config} from '../config/Config.js'

const PORT: number = Number(process.env.TEST_PORT ?? 18083)

/**
 * 向 API 发一个请求，返回它的 {errno, errMsg, data}
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
        //再删除一次不会有任何变化：别人可能已经先删掉了它
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

`npm test` 会先构建所有包，所以运行最后一个测试时，构建好的页面已经就绪。这些测试覆盖的是 API，而不是 React 代码；页面的类型由 `npm run typecheck -w ui` 检查，Vite 构建时并不检查类型。

## 10. 构建

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

`ui` 包先构建，因为应用依赖它（应用的 `package.json` 中有 `"ui": "^0.0.1"`）：Vite 把页面写到 `packages/ui/dist`，然后 `tsc` 把应用编译到 `packages/app/build`。

```bash
npm start
```

现在应用在同一个进程、同一个端口上提供 API 和页面：<http://localhost:8080>。它在所有网络接口上监听，所以局域网中的手机用这台电脑的地址和 8080 端口就能打开页面。

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

浏览器每次请求都会重新验证 `index.html`；脚本的文件名中带有内容的哈希，浏览器会把它们缓存一年，因此新的构建会立即生效。

## 11. 打包

模板中应用的 `package.json` 把构建好的页面声明为资源：

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

打包后的应用会带上它的资源，`resourcesPath()` 给出资源所在的目录，`uiDirectory()`（见第 5 节）就在那里找到页面（见 [Packaging](../Packaging.md)）。以单文件包为例：

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

`dist/app.cjs` 和 `dist/app.resources` 就是整个应用：把它们一起复制到装有 Node.js 的机器上，运行 `node app.cjs` 就能提供 API 和页面，不需要 `node_modules`。

- `npm run docker:build` 用模板中的 `Dockerfile` 构建应用的镜像，页面也包含在内。
- 应用停止后清单就会丢失：可以像 [带数据库的 REST API](RestAPI.md) 那样把它保存到数据库中。
- 任何能访问到应用的人都能修改清单。在家庭网络之外，请把它放在要求登录的反向代理后面，或者在中间件中验证用户身份（见 [Middlewares](../Middlewares.md)）。

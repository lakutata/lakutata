# Lakutata 中间件与访问控制

中间件在动作前后运行，在动作之前接收每个请求，在动作之后获得结果。访问控制决定请求能否到达对应的动作。两者在所有传输方式中的工作方式相同。

## 1. 中间件

中间件是一个函数 `(invocation, next) => Promise<unknown>`，它调用 `next()` 使请求继续，并返回请求的结果：

```typescript
import {type ActionInvocation, Controller, type Next} from 'lakutata/com/entrypoint'
import {GET, UseMiddlewares} from 'lakutata/decorator/ctrl'

async function timing(invocation: ActionInvocation, next: Next): Promise<unknown> {
    const started: number = Date.now()
    try {
        return await next()
    } finally {
        console.log(`${invocation.action.name} took ${Date.now() - started} ms`)
    }
}

@UseMiddlewares(timing)
class HealthController extends Controller {
    @GET('/health')
    public async health(): Promise<string> {
        return 'ok'
    }
}
```

中间件也可以是继承 `Middleware` 并实现 `handle(invocation, next)` 的类。该类在每个请求的作用域中创建，因此可以注入其他对象：

```typescript
import {Component} from 'lakutata'
import {type ActionInvocation, Middleware, type Next} from 'lakutata/com/entrypoint'
import {Inject} from 'lakutata/decorator/di'

class Metrics extends Component {
    public record(name: string, milliseconds: number): void {
        console.log(name, milliseconds)
    }
}

export class Timing extends Middleware {
    //在应用的 components 中声明为 metrics 的组件
    @Inject('metrics')
    protected readonly metrics: Metrics

    public async handle(invocation: ActionInvocation, next: Next): Promise<unknown> {
        const started: number = Date.now()
        try {
            return await next()
        } finally {
            this.metrics.record(invocation.action.name, Date.now() - started)
        }
    }
}
```

`invocation` 描述当前请求：

| 属性 | 含义 |
|---|---|
| `context` | 请求的上下文（动作中的 `this.context`）。其 `data`（校验之前的输入）可以修改 |
| `action` | 动作：`name`、`description`、`groups` 和地址（`route`、`command`、`pattern`） |
| `container` | 请求作用域的容器，用于获取该请求的对象 |
| `signal` | 请求的 `AbortSignal` |

- 不调用 `next()` 而直接返回的中间件会自行答复该请求，动作不会执行。缓存即可通过这种方式实现。
- 抛出错误的中间件会导致请求失败，效果与动作抛出错误相同。
- `next()` 只能调用一次，第二次调用会抛出 `MiddlewareNextCalledException`。
- 中间件对所有传输方式都会执行，包括定时任务。可以通过 `invocation.context.type` 区分传输方式。

## 2. 在哪里声明

| 位置 | 作用于 |
|---|---|
| `buildEntrypoints({middlewares})` | 所有动作 |
| 适配器的 `middlewares` 选项 | 通过该适配器到达的动作 |
| 控制器类上的 `@UseMiddlewares(...)` | 该类及其子类的动作 |
| 动作选项 `middlewares` | 该动作 |
| 方法上的 `@UseMiddlewares(...)` | 该方法 |

这些中间件按表中的顺序执行，从第一行（最外层）到最后一行依次为：入口、适配器、控制器类、动作选项、方法。在控制器上，父类的中间件先于子类的中间件执行。最后一个中间件之后，依次执行输入校验、访问控制和动作本身。

## 3. 向动作传递数据

中间件常常会获得动作所需的数据，例如发送请求的用户。不要将这些数据放入输入，因为 DTO 在中间件之后才校验输入，并且会去除未声明的键。应改用请求的提供者。`@Scoped` 提供者在每个请求中只有一个实例，中间件为其赋值后，动作注入的正是同一个实例。

```typescript
import {Exception, Provider} from 'lakutata'
import {type ActionInvocation, Controller, type HTTPContext, Middleware, type Next} from 'lakutata/com/entrypoint'
import {GET, UseMiddlewares} from 'lakutata/decorator/ctrl'
import {Autoload, Inject, Scoped} from 'lakutata/decorator/di'

class UnauthorizedException extends Exception {
    public errno: string = 'E_UNAUTHORIZED'

    public statusCode: number = 401
}

//每个请求一个实例，第一次使用时自动注册
@Autoload()
@Scoped()
export class CurrentUser extends Provider {
    public name: string

    public role: string
}

class Authenticate extends Middleware {
    public async handle(invocation: ActionInvocation, next: Next): Promise<unknown> {
        const token: string | undefined = (invocation.context as HTTPContext).request.headers.authorization
        if (!token) throw new UnauthorizedException('Not logged in')
        const user: CurrentUser = await invocation.container.get(CurrentUser)
        //实际应用中要根据令牌查出用户
        user.name = token
        user.role = token === 'ada' ? 'admin' : 'user'
        return await next()
    }
}

@UseMiddlewares(Authenticate)
class ProfileController extends Controller {
    @Inject(CurrentUser)
    protected readonly user: CurrentUser

    @GET('/me')
    public async me(): Promise<{ name: string, role: string }> {
        return {name: this.user.name, role: this.user.role}
    }
}
```

```text
$ curl localhost:8080/me -H 'Authorization: ada'
{"name":"ada","role":"admin"}
$ curl localhost:8080/me
{"errno":"E_UNAUTHORIZED","errMsg":"Not logged in"}
```

## 4. 访问控制

声明了 `acl: true` 的动作由入口的访问规则检查。访问规则是继承 `AccessControlRule` 的类，列在 `buildEntrypoints({rules})` 中：

```typescript
import {Provider} from 'lakutata'
import {AccessControlRule, ContextType, Controller, type HTTPContext} from 'lakutata/com/entrypoint'
import {DELETE, GET} from 'lakutata/decorator/ctrl'
import {Autoload, Inject, Scoped} from 'lakutata/decorator/di'

//第 3 节的提供者，由中间件 Authenticate 赋值
@Autoload()
@Scoped()
class CurrentUser extends Provider {
    public name: string

    public role: string
}

//admin 分组的动作只允许管理员访问
export class AdminRule extends AccessControlRule<HTTPContext> {
    @Inject(CurrentUser)
    protected readonly user: CurrentUser

    public get supportContextTypes(): ContextType[] {
        return [ContextType.HTTP]
    }

    public async rule(): Promise<boolean> {
        if (!this.targetAction.groups.includes('admin')) return true
        return this.user.role === 'admin'
    }
}

export class StatsController extends Controller {
    @GET('/admin/stats', {acl: true, groups: ['admin']})
    public async stats(): Promise<string> {
        return 'stats'
    }

    //只属于这个动作的规则，不需要 acl
    @DELETE('/drafts/:id', {rule: async (context): Promise<boolean> => (context as HTTPContext).request.headers['x-owner'] === 'yes'})
    public async removeDraft(): Promise<void> {
    }
}

//buildEntrypoints({controllers: [StatsController], rules: [AdminRule], httpActionGroups: {admin: 'Administration'}})
```

- 访问规则在每个请求的作用域中创建，因此可以注入该请求的对象，例如由中间件赋值的 `CurrentUser`。
- 在规则中，`this.context` 是请求的上下文，`this.input` 是校验后的输入，`this.targetAction` 是目标动作（包括其 `name`、`groups`），`this.actions` 是该传输方式的全部动作。
- `supportContextTypes` 列出规则要检查的传输方式，其他传输方式将跳过该规则。
- 先按 `rules` 选项的顺序执行各条规则，再执行动作的 `rule` 选项。第一个返回 `false` 的规则以 `AccessDeniedException` 拒绝请求（errno 为 `E_ACCESS_DENY`，HTTP 上为状态码 403）；抛出错误的规则则以其自身的错误拒绝请求（例如 401）。
- 动作的 `rule` 选项可以单独使用，没有 `acl` 时只检查这一条规则。
- 既没有 `acl` 也没有 `rule` 的动作不受检查。对于 `acl: true` 的动作，只要没有规则拒绝，便允许访问。

访问控制在中间件和输入校验之后、动作之前执行。如需改变整个应用的判断方式，见[入口](Entrypoint.md)第 7 节。

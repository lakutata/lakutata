# Lakutata Middlewares and Access Control

A middleware runs around actions: it sees each request before the action runs, and its result afterwards. Access control
decides whether a request may reach its action. Both work the same way for every transport.

## 1. Middlewares

A middleware is a function `(invocation, next) => Promise<unknown>`. It calls `next()` to continue with the request, and
returns what the request returns:

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

A middleware can also be a class that extends `Middleware` and implements `handle(invocation, next)`. The class is
created for each request, in the request's scope, so it can inject other objects:

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
    //The component declared as metrics in the components of the application
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

`invocation` describes the request:

| Property | Meaning |
|---|---|
| `context` | The request's context (`this.context` in the action). Its `data`, the input before validation, can be changed |
| `action` | The action: its `name`, `description`, `groups` and address (`route`, `command`, `pattern`) |
| `container` | The container of the request's scope, to obtain the request's objects |
| `signal` | The request's `AbortSignal` |

- A middleware that returns without calling `next()` responds to the request itself: the action does not run. A cache
  can work this way.
- When a middleware throws, the request fails with its error, as when an action throws.
- `next()` can be called only once: a second call throws a `MiddlewareNextCalledException`.
- Middlewares run for every transport, including scheduled jobs. `invocation.context.type` identifies the transport.

## 2. Where to declare them

| Where | Applies to |
|---|---|
| `buildEntrypoints({middlewares})` | Every action |
| An adapter's `middlewares` option | The actions reached through that adapter |
| `@UseMiddlewares(...)` on a controller class | The actions of the class and its subclasses |
| The `middlewares` action option | That action |
| `@UseMiddlewares(...)` on a method | That method |

They run in the order of this table, from the first row (the outermost) to the last: entrypoint, adapter, controller
class, action option, method. On a controller, the middlewares of the parent classes run before those of the subclass.
After the last middleware come input validation, access control, then the action.

## 3. Passing data to the action

A middleware often finds something the action needs, such as the user who sent the request. The input is the wrong place
for it: the DTO validates the input after the middlewares run, and removes the keys it does not declare. Use a
request-scoped provider instead. A `@Scoped` provider has one instance per request: the middleware fills it, and the
action injects the same instance.

```typescript
import {Exception, Provider} from 'lakutata'
import {type ActionInvocation, Controller, type HTTPContext, Middleware, type Next} from 'lakutata/com/entrypoint'
import {GET, UseMiddlewares} from 'lakutata/decorator/ctrl'
import {Autoload, Inject, Scoped} from 'lakutata/decorator/di'

class UnauthorizedException extends Exception {
    public errno: string = 'E_UNAUTHORIZED'

    public statusCode: number = 401
}

//One instance per request, registered the first time it is used
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
        //Look the token up in a real application
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

## 4. Access control

An action declared with `acl: true` is checked by the entrypoint's access rules. A rule is a class that extends
`AccessControlRule` and is listed in `buildEntrypoints({rules})`:

```typescript
import {Provider} from 'lakutata'
import {AccessControlRule, ContextType, Controller, type HTTPContext} from 'lakutata/com/entrypoint'
import {DELETE, GET} from 'lakutata/decorator/ctrl'
import {Autoload, Inject, Scoped} from 'lakutata/decorator/di'

//The provider of section 3, filled by the middleware Authenticate
@Autoload()
@Scoped()
class CurrentUser extends Provider {
    public name: string

    public role: string
}

//The actions of the "admin" group are for the administrators
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

    //A rule of this action only; no acl needed
    @DELETE('/drafts/:id', {rule: async (context): Promise<boolean> => (context as HTTPContext).request.headers['x-owner'] === 'yes'})
    public async removeDraft(): Promise<void> {
    }
}

//buildEntrypoints({controllers: [StatsController], rules: [AdminRule], httpActionGroups: {admin: 'Administration'}})
```

- A rule is created for each request, in the request's scope: it can inject the request's objects, such as the
  `CurrentUser` filled by a middleware.
- In a rule, `this.context` is the request's context, `this.input` the validated input, `this.targetAction` the action
  (its `name` and `groups`), and `this.actions` all the transport's actions.
- `supportContextTypes` lists the transports the rule checks; it is skipped for the others.
- The rules run in the order of the `rules` option, followed by the action's `rule` option. The first one that resolves
  `false` denies the request with an `AccessDeniedException` (errno `E_ACCESS_DENY`, status 403 over HTTP); one that
  throws denies it with its own error (such as a 401).
- An action's `rule` option works independently: without `acl`, only that rule is checked.
- An action with neither `acl` nor `rule` is not checked. An `acl: true` action is allowed when no rule denies it.

Access control runs after the middlewares and input validation, just before the action. To change how
it decides for the whole application, see [Entrypoint](Entrypoint.md), section 7.

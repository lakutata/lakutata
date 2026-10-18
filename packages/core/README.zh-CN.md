# @lakutata/core

[English](README.md) | 中文

lakutata 框架的核心：IoC 容器和依赖注入，对象模型（`BaseObject`、`Component`、`Provider`、`Application`）及其异步的创建与销毁，以及 `@Configurable`、`@Expect`、`@Accept` 和 `@Return` 装饰器所用的数据校验（`DTO`，一个 API 和 joi 一样的校验引擎）。

大多数应用安装的是 `lakutata` 包：它重新导出这个包（`lakutata`、`lakutata/decorator/di`、`lakutata/decorator/dto`、`lakutata/decorator/asst`、`lakutata/dtos`），并预置 `log` 和 `entrypoint` 组件。对于库，或者这两个组件都不需要的应用，只用 `@lakutata/core` 就够了（此时日志输出到控制台）。

## 安装

```shell
npm install lakutata          # 框架
npm install @lakutata/core    # 或者只安装核心
```

这个包需要 Node.js `^22.13.0 || >=24.11.0`。项目使用 ES 模块（`"type": "module"`）；包里也带有 CommonJS 构建。装饰器需要以下 TypeScript 选项：

```json
{
  "compilerOptions": {
    "module": "Node16",
    "moduleResolution": "Node16",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## 用法

### 一个应用

应用是一棵由它的容器创建的对象树。`Application.run()` 校验应用的选项，注册它的组件和提供者，创建 `bootstrap` 中列出的对象，然后调用 `onLaunched`。

```typescript
import {Application, Component, DTO, type ILogger} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'

//组件：应用中的单例，在第一次被需要时创建（或者由 bootstrap 创建）
class Mailer extends Component {
    //一个选项，在组件创建时校验；它的值来自下面的应用选项
    @Configurable(DTO.String().required())
    protected readonly host: string

    @Inject('log')
    protected readonly log: ILogger

    //注入的对象和选项都设置好之后调用
    protected async init(): Promise<void> {
        this.log.info('Mailer connected to %s', this.host)
    }

    public async send(to: string, text: string): Promise<void> {
        this.log.info('Mail to %s: %s', to, text)
    }

    //应用停止时调用
    protected async destroy(): Promise<void> {
    }
}

Application
    .run(() => ({
        id: 'com.example.app',
        name: 'Example',
        components: {
            mailer: {class: Mailer, host: 'smtp.example.com'}
        },
        bootstrap: ['mailer']
    }))
    .onLaunched(async (app: Application, log: ILogger): Promise<void> => {
        const mailer: Mailer = await app.getObject('mailer')
        await mailer.send('someone@example.com', 'Hello')
        log.info('%s started', app.appName)
    })
    .onFatalException((error: Error, log: ILogger): void => log.error(error.message))
```

### 生命周期

| 装饰器 | 实例数量 | 默认用于 |
|---|---|---|
| `@Singleton()` | 每个容器一个 | `Component` |
| `@Scoped()` | 每个作用域一个（`container.createScope()`，例如一次请求） | `Provider`（包括控制器） |
| `@Transient()` | 每次解析一个 | `BaseObject` |

### 依赖注入

`@Inject()` 注入以属性名注册的对象，`@Inject('name')` 注入以另一个名称注册的对象，`@Inject(SomeClass)` 注入一个类的实例（类标记了 `@Autoload()` 时会自动注册）。注入的对象在 `init()` 执行之前就已设置好。

### 校验

`DTO` 的子类用 `@Expect(schema)` 声明它的字段。校验规则由 `DTO` 的静态方法构建（`DTO.String()`、`DTO.Number()`、`DTO.Object()`、`DTO.Array()`、`DTO.Alternatives()`……），API 与 joi 相同：

```typescript
import {DTO} from 'lakutata'
import {Accept, Expect} from 'lakutata/decorator/dto'

class CreateUserDTO extends DTO {
    @Expect(DTO.String().email().required())
    public email: string

    @Expect(DTO.Number().integer().min(0).default(0))
    public credit: number
}

class Users {
    //方法执行之前校验参数（并填充默认值）
    @Accept(CreateUserDTO.required())
    public async create(input: CreateUserDTO): Promise<void> {
    }
}

//直接校验：得到补上默认值后的对象（{email: 'a@example.com', credit: 0}）；值不合法时
//以 InvalidValueException 拒绝
const input = await CreateUserDTO.validateAsync({email: 'a@example.com'})
```

### 测试与库：不使用应用的容器

```typescript
import {Component, Container, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'

class Mailer extends Component {
    @Configurable(DTO.String().required())
    protected readonly host: string

    public async send(to: string, text: string): Promise<string> {
        return `${this.host} -> ${to}: ${text}`
    }
}

//按选项创建；set() 会等到它的 init() 完成
const container: Container = new Container()
const mailer: Mailer = await container.set(Mailer, {host: 'localhost'})
await mailer.send('someone@example.com', 'Hello')
//销毁它创建的对象
await container.destroy()
```

## API

| 导出 | 子路径 | 说明 |
|---|---|---|
| `Application` | `lakutata` | 应用：`run()`、`env()`、`alias()`、`onLaunched()`、`onDone()`、`onFatalException()`、`getObject()`、`exit()` |
| `Module` | `lakutata` | `Application` 的基类：容器和声明的对象都在这里 |
| `Component` | `lakutata` | 带事件（`emit`、`on`……）的单例服务 |
| `Provider` | `lakutata` | 作用域对象（每个作用域一个） |
| `BaseObject` | `lakutata` | 根类：异步构造（`init`）、销毁（`destroy`）、`getObject` |
| `Container` | `lakutata` | IoC 容器：`set`、`get`、`getShared`、`register`、`createScope`、`destroy` |
| `DTO` | `lakutata` | 带校验的数据类，以及构建校验规则的方法 |
| `Exception` | `lakutata` | 框架中各种异常的基类（`errno`、`statusCode`） |
| `isPackaged`、`resourcesPath` | `lakutata` | 应用是否以打包形式运行，以及它的资源目录 |
| `registerValidationMessages`、`runInValidationLanguage`…… | `lakutata` | 校验消息的语言 |
| `Inject`、`Configurable`、`Autoload`、`Singleton`、`Scoped`、`Transient`、`Lifetime` | `lakutata/decorator/di` | 依赖注入与生命周期 |
| `Expect`、`Accept`、`Return`、`IndexSignature` | `lakutata/decorator/dto` | DTO 字段，以及方法参数和返回值的校验 |
| `Before`、`After` | `lakutata/decorator/asst` | 在方法之前和之后执行的函数 |
| `PaginationSearchDTO`、`PaginationResultDTO`、`paginator`、`FlexibleDTO`、`toJsonSchema`、`fromJsonSchema` | `lakutata/dtos` | 分页、接受任意字段的 DTO、JSON Schema 转换 |
| `ConsoleLogger`、`ILogger` | `@lakutata/core/com/logger` | 日志记录器接口及其控制台实现 |

类型声明中的每一项都附有说明和示例。

## 错误

| 异常 | 什么时候抛出 |
|---|---|
| `InvalidValueException` | 值不符合它的校验规则（`DTO.validate`、`@Configurable`、`@Expect`） |
| `InvalidMethodAcceptException`、`InvalidMethodReturnException` | 方法的参数（`@Accept`）或返回值（`@Return`）不合法 |
| `DependencyInjectionException` | 要注入的对象无法解析 |
| `InvalidObjectOptionsException`、`InvalidObjectTypeException` | 所声明对象的选项或类不合法 |
| `LifetimeLockedException` | 类的生命周期锁定之后又被修改 |
| `ObjectDestroyedException` | 使用了已销毁的对象 |
| `AliasExistsException`、`AliasNotFoundException`、`InvalidAliasNameException` | 路径别名重复声明、不存在或不合法 |
| `MethodNotFoundException` | 按名称调用的方法不存在 |

## 另见

- 网站上的指南：[对象与生命周期](https://lakutata.com/zh/guide/Objects)、[依赖注入](https://lakutata.com/zh/guide/Injection)、[DTO 与数据校验](https://lakutata.com/zh/guide/DTOValidation)。
- `lakutata` 包中的指南 `doc/zh/Application.md`、`doc/zh/Objects.md`、`doc/zh/Injection.md`、`doc/zh/DTOValidation.md` 和 `doc/zh/Decorator.md`。
- `@lakutata/entrypoint`：控制器，以及它们的 HTTP、命令行和服务调用传输方式。
- `@lakutata/logger`：`lakutata` 预置为 `log` 的日志记录器（与 pino 兼容的 JSON 行）。

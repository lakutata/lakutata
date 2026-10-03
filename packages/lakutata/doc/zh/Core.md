# Lakutata 核心功能

**Lakutata** 是一个基于 IoC（控制反转）的通用应用框架，专为 TypeScript 和 Node.js 开发者设计。其核心功能为依赖管理、应用结构组织和生命周期定义提供了基础机制。本文档详细阐述了 Lakutata 的核心功能，包括 IoC 容器、依赖注入（DI）和应用入口点。

## 1. IoC 容器

**IoC 容器** 是 Lakutata 框架的中心组件，负责实现控制反转原则以解耦模块并管理对象生命周期。它作为应用组件、提供者和模块的注册中心和工厂，确保在运行时动态解析依赖关系。

### 主要特性
- **对象生命周期管理**：IoC 容器支持多种生命周期范围，通过装饰器定义（如 `@Transient()`）：
  - **单例（默认）**：整个应用中仅创建一个实例并在所有地方共享。
  - **瞬态**：每次请求对象时创建一个新实例，如 `TestProvider.ts` 中的 `@Transient()`。
  - 其他自定义范围：通过配置或装饰器进一步定义。
- **依赖解析**：基于注册的组件、提供者或模块自动解析依赖关系，减少手动实例化的工作。
- **提供者注册**：支持将类或服务注册为提供者（`Provider`），在应用配置中指定路径或类，如 `TestProvider`。
- **组件管理**：支持注册和初始化组件（`Component`），可以是日志记录等基础设施服务或自定义功能模块。
- **模块化支持**：允许将功能组织成模块（`Module`），以实现更好的代码组织和重用。

### 使用示例
以下是基于提供的测试代码的一个示例，展示了如何在 Lakutata 中注册和使用组件和提供者：

```typescript
import { Application } from '../lib/core/Application.js';
import { TestComponent } from './components/TestComponent.js';
import { TestProvider } from './providers/TestProvider.js';
import path from 'node:path';

// 配置应用并注册组件和提供者
Application.run(() => ({
  id: 'test.app',
  name: 'TestApp',
  timezone: 'auto',
  components: {
    testComponent: {
      class: TestComponent
    }
  },
  providers: {
    testProvider: {
      class: TestProvider,
      path: path.resolve('@test2', './hahahaha')
    }
  },
  bootstrap: ['testComponent']
}));
```

### 优势
- 通过容器管理对象创建，减少模块之间的耦合。
- 支持灵活的生命周期配置，用于资源管理和性能优化。
- 提供统一的依赖解析机制，简化复杂应用的开发。

## 2. 依赖注入（DI）

**依赖注入（DI）** 是 Lakutata 中用于解耦组件的关键设计模式。通过 IoC 容器，Lakutata 允许开发者声明组件或控制器所需的依赖，而无需手动实例化它们。依赖注入主要通过装饰器实现。

### 主要特性
- **装饰器注入**：使用 `@Inject()` 装饰器声明要注入的依赖，支持按类型或按名称注入。
- **自定义配置**：使用 `@Configurable()` 装饰器将配置值注入到提供者或组件中，如 `TestProvider.ts` 中的 `path` 属性。
- **多级依赖**：支持组件、控制器和提供者之间的嵌套依赖注入，IoC 容器自动解析依赖链。
- **应用实例注入**：允许直接注入 `Application` 实例以访问全局配置或控制应用生命周期，如 `TestController1.ts` 中所示。

### 使用示例
以下是基于 `TestComponent.ts` 和 `TestController1.ts` 的依赖注入实际示例：

```typescript
import { Component } from '../../lib/core/Component.js';
import { Inject } from '../../decorators/di/Inject.js';
import type { Logger } from '../../components/Logger.js';
import { Application } from '../../lib/core/Application.js';
import { Controller } from '../../components/entrypoint/lib/Controller.js';

// 在组件中使用依赖注入
export class TestComponent extends Component {
  @Inject()
  protected readonly log: Logger;

  protected async init(): Promise<void> {
    this.log.info('TestComponent initialized');
  }
}

// 在控制器中使用依赖注入
export class TestController1 extends Controller {
  @Inject()
  protected readonly log: Logger;

  @Inject(Application)
  protected readonly app: Application;

  protected async init(): Promise<void> {
    this.log.info('TestController initialized');
  }
}
```

### 优势
- 通过 `@Inject()` 装饰器简化依赖声明，避免手动实例化。
- 支持注入 `Application` 实例，以便轻松访问全局配置或应用控制。
- 增强代码可维护性，并通过允许依赖替换来便于测试。

## 3. 应用入口点

**应用入口点** 是 Lakutata 中用于启动和管理应用生命周期的核心机制。通过 `Application` 类，它们为应用配置、组件注册和引导初始化提供了统一的方法。Lakutata 支持多种入口点类型，包括 HTTP、CLI 和服务入口点，以适应不同的应用场景。

### 主要特性
- **应用配置**：通过 `Application.run()` 方法定义应用的 ID、名称、时区、组件、提供者、模块和引导项（`bootstrap`）。
- **多入口点支持**：Lakutata 将入口点设计为抽象层，允许开发者自由选择特定的实现框架或库，只要它们能与框架的入口点机制集成即可。框架提供了 `BuildEntrypoints` 及相关辅助方法（如 `BuildHTTPEntrypoint`、`BuildCLIEntrypoint`、`BuildServiceEntrypoint`）来帮助开发者定义入口点：
  - **HTTP 入口点**：用于处理 HTTP 请求，开发者可以选择使用 Fastify 或其他 HTTP 框架，只需实现请求处理逻辑并与 Lakutata 的 `HTTPContext` 集成。
  - **CLI 入口点**：用于命令行交互，开发者可以选择 Commander.js 或其他 CLI 工具，只需将命令处理逻辑与 Lakutata 的 `CLIContext` 连接。
  - **服务入口点**：用于实时通信或其他服务场景，开发者可以选择 Socket.IO 或其他通信库，与 Lakutata 的 `ServiceContext` 集成。
- **生命周期管理**：提供 `onLaunched`、`onDone` 和 `onFatalException` 等钩子，用于在应用启动、完成或错误场景下执行自定义逻辑。
- **退出信号**：收到 `SIGTERM`（`docker stop`、Kubernetes 滚动更新、systemd 停止服务）或 `SIGINT`（Ctrl+C）时，应用会优雅退出：先执行 `onDone`，此时应用仍然完全可用（它的第三个参数说明退出原因：收到信号时是 `{code: 0, signal: 'SIGTERM'}`，调用 `app.exit(code)` 时是 `{code}`）；然后各入口停止接收新请求并等待正在处理的请求完成，各对象被销毁，最后以退出码 0 退出。如果再次收到信号（比如退出过程卡住了），或者信号是在应用启动期间收到的，进程会立即以 128 + 信号编号退出（`SIGTERM` 为 143，`SIGINT` 为 130）。应用选项 `shutdownSignals` 可以指定其他信号（如 `['SIGTERM', 'SIGINT', 'SIGHUP']`），设为 `false` 则由应用自己处理信号。
- **启动失败**：应用无法启动时（对象初始化失败、选项不合法等），由 `onFatalException` 的处理函数决定退出码（没有返回退出码时为 1）。没有注册处理函数时，框架记录错误后以退出码 1 退出，和 Node.js 处理未捕获异常的方式一致，这样运行它的工具（Docker 的重启策略、Kubernetes、systemd、CI）都能知道启动失败了；已经创建的对象（正在监听的服务、数据库连接等）也不会让进程继续挂着。
- **环境变量支持**：通过 `Application.env()` 方法设置环境变量，可在整个应用中访问。
- **运行模式**：`app.mode()` 返回 `'development'` 或 `'production'`。环境变量会覆盖代码里的配置，同一份构建产物可以在不同模式下运行：依次看环境变量 `MODE`（lakutata 自己的变量）、`NODE_ENV`，然后是应用选项 `mode`，都没有时为 `development`。不是这两个值的 `MODE` 会发出警告并被忽略，不是这两个值的 `NODE_ENV`（如测试工具设置的 `test`）会被跳过。确定的模式会同时写回 `MODE` 和 `NODE_ENV`，所以第三方库读到的也是同一个模式。环境变量可以来自系统、`Application.env({MODE: 'production'})`，或者 Bun 自动读取的 `.env` 文件（指 `bun App.js` 这种运行方式；Bun 打包出的可执行文件不会读取它）。
- **打包后的应用**：`IsPackaged()` 表示应用是否以打包形式运行（`lakutata package bundle` 的打包产物或 `lakutata package exe` 的可执行文件）。应用运行时要读取的资源文件（Web 应用构建好的前端页面、模板、数据等）在 `package.json` 的 `lakutata.resources` 里声明，写法和 electron-builder 的 `extraResources` 一样：`[{"from": "../ui/dist", "to": "ui"}]`。打包后，`ResourcesPath()` 返回资源所在的目录（在打包产物或可执行文件旁边，单文件可执行程序则是和原生插件一起解压出来的目录）；未打包时返回 `undefined`，由应用自己到构建目录里找：`const ui = ResourcesPath() ? path.join(ResourcesPath()!, 'ui') : uiBuildDirectory`。

### 使用示例
以下是基于 `App.spec.ts` 的应用入口点配置和启动示例：

```typescript
import { Application } from '../lib/core/Application.js';
import { TestComponent } from './components/TestComponent.js';
import { TestController1 } from './controllers/TestController1.js';
import { BuildEntrypoints, BuildHTTPEntrypoint } from '../components/entrypoint/Entrypoint.js';

// 配置并启动应用
Application
  .env({ TEST: '123' }) // 设置环境变量
  .run(() => ({
    id: 'test.app',
    name: 'TestApp',
    timezone: 'auto',
    components: {
      testComponent: {
        class: TestComponent
      },
      entrypoint: BuildEntrypoints({
        controllers: [TestController1],
        http: BuildHTTPEntrypoint((module, routeMap, handler, onDestroy) => {
          // 开发者可以自由选择 HTTP 框架进行实现
          // 具体实现代码省略，参见 App.spec.ts
        }),
        // CLI 和服务入口点配置省略
      })
    },
    bootstrap: ['entrypoint']
  }))
  .onLaunched(async (app, log) => {
    log.info('Application %s launched', app.appName);
  })
  .onDone(async (app, log, reason) => {
    log.info('Application %s done (exit code %d%s)', app.appName, reason.code, reason.signal ? `, ${reason.signal}` : '');
  })
  .onFatalException((error, log) => {
    log.error('Application error: %s', error.message);
    return 100;
  });
```

### 优势
- 提供统一的 `Application` 类用于应用配置和启动，简化复杂应用的初始化。
- 抽象的入口点设计赋予开发者高度灵活性，可选择适合特定功能的框架或库。
- 通过生命周期钩子支持自定义逻辑，便于调试和扩展。

## 总结

Lakutata 的核心功能——包括 IoC 容器、依赖注入和应用入口点——为开发者提供了构建模块化和可扩展应用的强大框架。通过 IoC 容器管理依赖和对象生命周期，通过依赖注入简化组件间关系，以及通过应用入口点提供灵活的启动和管理，Lakutata 有效满足了从简单脚本到复杂企业应用的各种需求。

有关控制器行为定义、数据传输对象（DTO）或其他模块的详细信息，请参阅相关文档章节。
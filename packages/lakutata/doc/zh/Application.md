# Lakutata 应用

**应用**是 Lakutata 程序的根对象。`Application.run()` 在一个新的根容器中创建它，注册它声明的对象，依次执行 bootstrap 步骤，并在收到退出信号时优雅地结束。本页介绍应用的选项、链式 API、生命周期、运行模式和打包后的应用。应用创建的对象见 [Objects](Objects.md)，对象之间如何获取彼此见 [Injection](Injection.md)。

## 1. 选项

`Application.run(options)`（或 `run(() => options)`，在启动时调用该函数，可以是异步的）接受以下选项：

| 选项 | 含义 |
|---|---|
| `id`、`name` | 必填。应用的 ID（同时作为 `process.title`）和名称（`app.appId`、`app.appName`） |
| `timezone` | IANA 时区名，或 `'auto'`（默认）表示使用系统时区；写入 `TZ` |
| `mode` | `'development'` 或 `'production'`，在环境变量未指定时生效（见第 4 节） |
| `shutdownSignals` | 使应用优雅退出的信号（默认 `['SIGTERM', 'SIGINT']`），或 `false` |
| `components`、`providers` | 按名称声明的组件和提供者：`{class, ...options}` |
| `objects` | 其他对象：`{named: {...}, anonymous: [...]}` |
| `bootstrap` | 启动时依次执行的步骤：名称、symbol 或类（创建该对象），或以应用为参数调用的异步函数 |
| `checkOptions` | 启动时检查所声明对象的选项（默认 `true`） |

不带 `class` 的声明会补充框架预置的同名对象的选项：`lakutata` 包预置了 `log`（`Logger`）和 `entrypoint`（`Entrypoint`），因此 `log: {level: 'debug'}` 会设置预置日志组件的级别。`Application.preset(options)` 为进程中的所有应用预置对象。

## 2. 链式 API

```typescript
import {Application, type ApplicationExitReason, type ILogger} from 'lakutata'

Application
    //环境变量，在启动时、调用选项函数之前设置
    .env({TZ_NAME: 'Asia/Shanghai'})
    //路径别名：传给 path.resolve() 或 app.alias.resolve() 的路径中的 '@data'；目录不存在时创建
    .alias({'@data': './data'}, true)
    .run(() => ({
        id: 'com.example.app',
        name: 'Example',
        components: {}
    }))
    //bootstrap 完成后调用（不会被等待）
    .onLaunched((app: Application, log: ILogger): void => log.info('%s launched in %s mode', app.appName, app.mode()))
    //应用退出时、对象销毁之前调用，会被等待
    .onDone(async (app: Application, log: ILogger, reason: ApplicationExitReason): Promise<void> => {
        log.info('%s done (exit code %d%s)', app.appName, reason.code, reason.signal ? `, ${reason.signal}` : '')
    })
    //进程中未捕获的异常，应用继续运行
    .onUncaughtException((error: Error, log: ILogger): void => log.warn(error.message))
    //启动失败：返回的数字作为退出码（未返回时为 1）
    .onFatalException((error: Error, log: ILogger): number => {
        log.error('Launch failed: %s', error.message)
        return 100
    })
```

`app.exit(code)` 以指定退出码优雅地结束应用；`app.exit(true)` 立即以退出码 2 结束进程，不执行 `onDone` 处理函数，也不销毁对象。

## 3. 生命周期

1. 设置环境变量，注册路径别名（`@runtime` 为当前工作目录）。
2. 读取并校验选项；应用 ID、时区和运行模式。
3. 在新的根容器中创建应用：注册它的对象，并依次执行 `bootstrap`。
4. 执行各对象的 `launched()` 钩子和 `onLaunched` 处理函数。

- **启动失败**：应用无法启动时（选项不合法、对象初始化失败、bootstrap 步骤失败），由 `onFatalException` 的处理函数决定退出码（没有返回时为 1）。没有注册处理函数时，框架记录错误后以退出码 1 退出，和 Node.js 处理未捕获异常的方式一致，这样运行它的工具（Docker 的重启策略、Kubernetes、systemd、CI）都能知道启动失败了；已经创建的对象（正在监听的服务、数据库连接等）也不会让进程继续挂着。
- **退出信号**：收到 `SIGTERM`（`docker stop`、Kubernetes 滚动更新、systemd 停止服务）或 `SIGINT`（Ctrl+C）时，应用会优雅退出：先执行 `onDone` 处理函数，此时应用仍然完全可用（第三个参数说明退出原因：收到信号时是 `{code: 0, signal: 'SIGTERM'}`，调用 `app.exit(code)` 时是 `{code}`）；然后各入口停止接收新请求并等待正在处理的请求完成，各对象被销毁，最后以退出码 0 退出。如果再次收到信号（比如退出过程卡住了），或者信号是在应用启动期间收到的，进程会立即以 128 + 信号编号退出（`SIGTERM` 为 143，`SIGINT` 为 130）。选项 `shutdownSignals` 可以指定其他信号（如 `['SIGTERM', 'SIGINT', 'SIGHUP']`），设为 `false` 则交由 Node.js 处理。
- **没有事情可做时**：和所有 Node.js 程序一样，如果没有任何东西让进程保持运行（没有服务、连接或定时器），工作做完后进程就会结束；这种情况下不会执行 `onDone` 处理函数，也不会销毁对象。执行完一项任务就结束的应用（比如脚本），应在任务完成时调用 `app.exit(0)`。

## 4. 运行模式

`app.mode()` 返回 `'development'` 或 `'production'`。环境变量会覆盖代码里的配置，同一份构建产物可以在不同模式下运行：依次看环境变量 `MODE`、`NODE_ENV`，然后是选项 `mode`，都没有时为 `'development'`。不是这两个值的 `MODE` 会发出警告并被忽略，不是这两个值的 `NODE_ENV`（如 `test`）会被跳过。确定的模式会写回 `MODE` 和 `NODE_ENV`，第三方库读到的也是同一个模式。环境变量可以来自系统、`Application.env({MODE: 'production'})`，或者 Bun 读取的 `.env` 文件（指 `bun App.js` 这种运行方式；Bun 构建的可执行文件不会读取它）。

## 5. 打包后的应用

`lakutata package bundle`、`package exe` 和 `package installer` 把编译好的应用打包成单文件包、可执行文件或安装包。以打包形式运行时，`isPackaged()`（来自 `lakutata`）返回 `true`，`resourcesPath()` 返回资源所在的目录，资源就是 `package.json` 的 `lakutata.resources` 中声明的文件；未打包时，它返回 `undefined`，应用从这些文件的构建位置读取它们。详见 [Packaging](Packaging.md)。

## 6. 入口

`entrypoint` 组件（`lakutata/com/entrypoint`）通过 HTTP、CLI、服务传输、定时任务和消息队列对外提供控制器。用 `buildEntrypoints({controllers, http, cli, service, schedule, queue})` 配置它，并把它列入 `bootstrap`；详见 [Entrypoint](Entrypoint.md)。

# 从 Lakutata 2.x 升级

本页说明如何把项目从 Lakutata 2.x（最后一个版本是 2.0.126）升级到 3.x：怎样区分两个版本、升级步骤、改名和移动了的 API、编译器不会报告的行为变化，以及如何检查升级结果。

本页只适用于依赖 `lakutata` 包 2.x 版本的项目。Lakutata 1.x 的项目依赖的是 1.x 版本的 `@lakutata/core`，以及 `@lakutata-component/*` 或 `@lakutata-module/*` 包：这类项目请看 [UpgradingFrom1](UpgradingFrom1.md)，不要按本页升级。

## 1. 区分 2.x 和 3.x

| 特征 | 2.x | 3.x |
|---|---|---|
| `package.json` 中的 `lakutata` | `^2.…` | `^3.…` |
| `node_modules/lakutata/package.json` | 没有 `dependencies`（全部打包在内） | 依赖与它同一版本的 `@lakutata/core`、`@lakutata/entrypoint` 等包 |
| 辅助函数 | `import {Delay} from 'lakutata/helper'` | `import {delay} from 'lakutata/utils'` |
| 导出的函数 | 大驼峰：`BuildEntrypoints`、`BuildDatabaseOptions`、`MD5` | 小驼峰：`buildEntrypoints`、`buildDatabaseOptions`、`md5` |
| 传输方式 | 手写：`BuildHTTPEntrypoint((module, routeMap, handler, registerDestroy) => …)` | 适配器：`lakutata/adapter/express` 中的 `expressHTTPEntrypoint()` 等 |
| 只有 3.x 才有的子路径 | | `lakutata/utils`、`lakutata/security`、`lakutata/adapter/*`、`lakutata/com/{containerd,mutex,queue,i18n}` |
| Node.js | `>=20` | `^22.13.0 \|\| >=24.11.0` |

`npx @lakutata/cli info` 会显示命令行工具、框架和 Node.js 的版本，以及项目声明的和实际安装的 `lakutata` 版本。没有升级命令：下面的步骤需要手动完成。

## 2. 升级步骤

- **Node.js** `^22.13.0 || >=24.11.0`（22.13 或更高的 22.x，或者 24.11 及以上；不包括 23）。同时更新 `engines`、CI 的版本矩阵，以及 Dockerfile 的基础镜像。
- **支持 `"module": "Node20"` 的 TypeScript**（模板使用 TypeScript 6）：`lakutata/tsconfig.json` 现在设置了这个选项（2.x 中是 `Node16`），更旧的编译器不认识它。
- **`package.json`**：`"type": "module"`，`lakutata` 为 `^3.0.0`，`@lakutata/*` 包也写 `^3.0.0`，`@lakutata/cli` 放在 `devDependencies` 中。不要把 `lakutata` 的版本号照抄给其他包：补丁版只发布改动过的包，各包的最新版本可能不同（比如 `lakutata` 是 3.1.4，`@lakutata/ffi` 是 3.1.2）。
- **全新安装**：删除 `node_modules` 和锁文件，再重新安装。原地升级可能留下多份 `@lakutata/core`，它们的类和装饰器元数据互不相通（跨副本的 `instanceof` 和注入都会失败）。`npm ls @lakutata/core` 必须只显示一个版本。
- **`tsconfig.json`** 继承 `lakutata/tsconfig.json`，并设置自己的 `rootDir`、`outDir` 和 `include`。要保留 `include`：发布的选项设置了 `allowJs`，没有它的话，项目根目录下的配置文件（`eslint.config.js`）也会被编译。保留自己选项的项目需要 `experimentalDecorators`、`emitDecoratorMetadata` 和 `useDefineForClassFields: false`。

```json
{
  "extends": "lakutata/tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "build"
  },
  "include": ["src"]
}
```

- **相对导入**以 `.js` 结尾（`import {config} from './config/Config.js'`），和 2.x 的 ES 模块项目一样。
- **所用功能的库**是 `lakutata` 的可选对等依赖，需要项目自己安装（2.x 项目已经装了自己的传输方式所导入的那些）；见 [GettingStarted](GettingStarted.md) 第 3 节：

| 使用了 | 安装 |
|---|---|
| `lakutata/adapter/express` | `express`（4.21+ 或 5）、`@types/express` |
| `lakutata/adapter/fastify` | `fastify` 5 |
| `lakutata/adapter/commander` | `commander`（12 到 15）；提示输入需要 `@inquirer/prompts`（7 或 8） |
| `lakutata/adapter/socket.io` | `socket.io` 4 |
| 通过 WebSocket 的 `lakutata/adapter/jsonrpc` | `ws` 8 |
| 某种数据库 `type` | `pg`、`mysql2`（3.15.3+）、`better-sqlite3` 12（取代 `sqlite3`）、`mongodb` 7、`mssql` 12、`oracledb`、`sql.js` 等 |
| 某种缓存存储 | `redis`（4 或 5）或 `@redis/client`、`memjs`、`mongodb`、`mysql2`、`pg`、`better-sqlite3`（2.x 中 SQLite 存储使用的是 `sqlite3`） |
| NATS、D-Bus | `@lakutata/nats`、`@lakutata/dbus`，版本与 `lakutata` 相同 |

- **按第 3 节的表格改名**，然后构建：改名的函数都没有别名，所以编译器会报告每一个遗留的导入。之后再逐条检查第 4 节，这些变化编译器不会报告。

## 3. 改名和移动

| 2.x | 3.x |
|---|---|
| `lakutata/helper` | `lakutata/utils`（同样的辅助函数，按下文改名，另外新增 `Time`、`cloneDeep`、`isSubclassOf`） |
| `lakutata/helper` 中的 `Paginator`、`PaginatorHandlerResult` | `lakutata/dtos` 中的 `paginator`、`PaginatorHandlerResult` |
| `lakutata` 中的 `IPatRun` | 已移除：模式匹配属于内部实现 |

2.x 的其他子路径保持原名：`lakutata`、`lakutata/orm`、`lakutata/dtos`、`lakutata/com/{entrypoint,database,cacher,docker,monitor,logger}`、`lakutata/provider/{database,passwordHash}`、`lakutata/decorator/{di,dto,ctrl,asst,orm}` 和 `lakutata/tsconfig.json`。

所有导出的函数都改用小驼峰命名，2.x 的名字没有别名。其中大多数只是把首字母改成小写（`ArrayToSet` 变成 `arrayToSet`）：

- `lakutata/utils`：`arrayToSet`、`convertArrayLikeToIterable`、`convertArrayLikeToStream`、`delay`、`getObjectNestingDepth`、`getObjectPropertyPaths`、`hexToIEEE754`、`hexToSigned`、`hexToUnsigned`、`isAbortError`、`isEmptyObject`、`isGlobString`、`isNativeFunction`、`isPath`、`isPromise`、`isPromiseLike`、`isSymbol`、`isXML`、`mergeArray`、`mergeMap`、`mergeSet`、`noCase`、`objectConstructor`、`objectHash`、`objectParentConstructor`、`objectParentConstructors`、`objectPrototype`、`objectToMap`、`randomString`、`setToArray`、`signedToHex`、`sortArray`、`sortKeys`、`sortObject`、`templating`、`uniqueArray`、`unsignedToHex`；
- `lakutata/com/entrypoint`：`buildEntrypoints`、`buildHTTPEntrypoint`、`buildCLIEntrypoint`、`buildServiceEntrypoint`；
- `lakutata/com/cacher`：`buildCacherOptions`；`lakutata/com/database` 和 `lakutata/provider/database`：`buildDatabaseOptions`；
- `lakutata/com/docker`：`buildDockerConnectionOptions`、`buildDockerSocketConnectionOptions`、`buildDockerHttpConnectionOptions`、`buildDockerHttpsConnectionOptions`、`buildDockerSSHConnectionOptions`、`parseEnvToRecord`、`parseRepositoryTag`。

`As`、`DevNull` 和 `Glob`（以及新增的 `GlobSync`）仍是大驼峰，类（`Time`、`URLBuilder`、`UUID`、`ObjectPath`、`MessagePack`、`Statistics`、`IP`、`IPv4`、`IPv6`）和装饰器也一样。其他改名：

| 2.x | 3.x |
|---|---|
| `GraceExit` | `gracefulExit` |
| `IsExists` | `pathExists` |
| `IsHtml` | `isHTML` |
| `NonceStr` | `nonceString` |
| `MD5`、`SHA1`、`SHA256` | `md5`、`sha1`、`sha256` |
| `IEEE754ToHex` | `ieee754ToHex` |
| `Split`、`ToLower`、`ToUpper` | 已移除：`noCase(input).split(' ')` 得到小写的单词（输入中没有单词时为 `['']`） |
| 类型 `SortOptions` | `SortArrayOptions` |
| 类型 `IPv4SubNet`、`IPv6SubNet` | `IPv4Subnet`、`IPv6Subnet` |
| `IPv6Result` 的字段 `comperssed` | `compressed` |
| `AccessDenyException` | `AccessDeniedException`：`errno` 仍为 `E_ACCESS_DENY`，`err`（类名）改变了 |
| 类型 `OnDelEventData`（`lakutata/com/cacher`） | `OnDeleteEventData`；事件名仍为 `'del'` |
| `@Lifetime('APPLICATION_SINGLETON')`、`'MODULE_SINGLETON'` | `@Singleton()`：生命周期只有 `SINGLETON`、`SCOPED` 和 `TRANSIENT` |
| `Database` 的静态属性 `databaseSymbol` | 已移除 |

ORM 从 TypeORM 0.3.24 升级到 TypeORM 1.1.2，其源码已并入 `@lakutata/orm`（不再有 `typeorm` 包）：

| 2.x | 3.x |
|---|---|
| `type: 'sqlite'`（驱动 `sqlite3`） | `type: 'better-sqlite3'`（驱动 `better-sqlite3`） |
| `PostgresConnectionOptions`、`MysqlConnectionOptions` 等 | `PostgresDataSourceOptions`、`MysqlDataSourceOptions` 等（旧名字是已弃用的别名） |
| `SqliteConnectionOptions` | `BetterSqlite3DataSourceOptions` |
| `AbstractRepository` | 已移除：使用 `Repository`，或者 `repository.extend({...})` |
| `relations: ['author']`、`select: ['id']` | `relations: {author: true}`、`select: {id: true}` |
| `import {In} from 'typeorm'` | `import {In} from 'lakutata/orm'`：再装一个 `typeorm` 包会成为另一份副本 |

2.x 时期在 `lakutata` 之外单独发布的包也按同样的方式改名：

| 2.x | 3.x |
|---|---|
| `SetupNatsServiceEntrypoint`（`@lakutata/nats`） | `natsServiceEntrypoint` |
| `BuildServiceProxy`、`JSONCodec`、`MessagePackCodec` | `buildServiceProxy`、`jsonCodec`、`messagePackCodec` |
| `CreateDBusError`（`@lakutata/dbus`） | `createDBusError` |
| D-Bus 客户端的事件 `online`、`offline`、`replaced`、`NameOwnerChanged`、`NameAcquired`、`NameLost` | `serviceOnline`、`serviceOffline`、`serviceReplaced`、`nameOwnerChanged`、`nameAcquired`、`nameLost`（监听旧名字的监听器永远不会被调用） |
| D-Bus 客户端的选项 `advancedResponse`、`convertBigIntToNumber` | `decode`：`{types: 'all'}` 保留 D-Bus 类型，`{int64: 'bigint'}` 保留 bigint |

## 4. 编译器不会报告的行为变化

### 应用及其对象

见 [Application](Application.md) 和 [Objects](Objects.md)。

- **运行模式**（`app.mode()`）依次取环境变量 `MODE`、`NODE_ENV`、`mode` 选项，都没有时为 `development`，并写回这两个环境变量。2.x 使用的是 `mode` 选项（默认为 `development`），并用它覆盖 `NODE_ENV`：现在设置了 `NODE_ENV=production` 的部署环境会以生产模式运行，不论选项怎么写。
- **SIGTERM 和 SIGINT** 会让应用平稳退出（运行 `onDone`，入口停止，对象被销毁，退出码为 0）；2.x 把它们交给 Node.js 处理。请删除应用自己的 `process.on('SIGTERM', …)`，或者设置 `shutdownSignals: false`。`onDone` 处理函数会收到第三个参数 `{code, signal?}`。
- **进程无事可做时**（没有服务器、连接或定时器），应用会平稳退出：此时 `onDone` 处理函数和 `destroy()` 钩子也会运行。在 2.x 中，进程直接结束。
- **启动失败**时，如果没有 `onFatalException` 处理函数，进程以退出码 1 结束。2.x 只记录错误，进程继续运行，或者以退出码 0 结束。
- **启动时检查选项**（`checkOptions`，默认开启）：`@Configurable` 属性的值不合法时，启动失败并抛出 `InvalidObjectOptionsException`（`E_INVALID_OBJECT_OPTIONS`），它列出所有不合法的选项，即使对象从未被创建；不是 `@Configurable` 属性的选项会产生一条警告。`''` 不满足必填的字符串：请写 `process.env.X || undefined`，不要写 `|| ''`。接受其他选项的类可以声明静态方法 `acceptsOption(name, value)`。
- **`@Configurable` 属性的初始值就是它的默认值**（`protected readonly port: number = 8080`），并且和配置的值一样会被校验。2.x 会用 schema 的默认值或 `undefined` 替换它。
- **新的生命周期钩子**：`startup()`（在 `init()` 之后、对象交给使用者之前）、`launched()`（应用启动完成之后）、`beforeDestroy()`（销毁开始时），以及静态方法 `acceptsOption()`。2.x 的类如果有同名的成员，现在会被框架调用：请给这个成员改名。
- **`Component` 的生命周期锁定为单例**：子类上的 `@Transient()` 或 `@Scoped()` 会在类定义时抛出 `LifetimeLockedException`（2.x 接受这种写法）。请把它改成 `Provider`：默认是作用域生命周期，也可以是 `@Singleton()` 或 `@Transient()`。
- **用 `class` 声明的内置组件**（`components: {log: {class: MyLogger}}`）会替换预设的组件；2.x 会悄悄保留预设的组件。不带 `class` 的声明仍然只是配置预设的 `log` 或 `entrypoint`。
- **用 glob 声明的对象**（`objects.anonymous`、`container.load()`）会注册每个文件导出的所有 `BaseObject` 子类（2.x 只注册第一个导出），导入失败的文件会让启动失败（2.x 会跳过它）。

### 错误和值

- **状态码**：`AccessDeniedException` 的 `statusCode` 为 403，`ControllerActionNotFoundException` 为 404，`InvalidValueException` 为 400。在 2.x 中这三者都是 500，所以检查 500 的客户端和测试需要修改。
- **消息**：不带参数创建的异常，以类名中的单词为消息（`Order not found exception`；2.x 是 `Ordernotfoundexception`）；单个参数会填入 `{0}`（`new OrderException('Order {0}', 7)`）；`%` 占位符遵循 `util.format()`（`%s %d %i %f %j %o %O %c %%`），`%` 后面跟其他字符时保持原样。
- **DTO 和 2.x 一样是严格的**：HTTP 适配器给出的查询参数和路由参数都是字符串，所以从中读取数字或布尔值需要 `.strict(false)`。`PaginationSearchDTO` 现在会转换它的 `limit` 和 `offset`。
- **`Time`**：没有时间部分的日期（`new Time('2024-03-01')`）是默认时区的零点（2.x 是 UTC 的零点）。
- **`PasswordHash`**：超过 72 字节 UTF-8 的密码，`hash()` 会抛出 `PasswordTooLongException`，`validate()` 返回 `false`。2.x 只对前 72 字节做哈希，所以这些用户将无法再登录。`saltRounds` 的取值范围是 4 到 31。
- **`Glob`** 只接受 `cwd`、`absolute`、`dot`、`nodir`、`follow`、`ignore` 和 `nocase`，返回排好序、没有重复的 `string[]`：`withFileTypes` 和扩展模式（`+(a|b)`）都已移除。

### 入口

见 [HTTP](HTTP.md) 第 8 节和 [ServiceCalls](ServiceCalls.md)。

- **2.x 的传输方式函数仍然可用**，放在 `http`、`cli` 和 `service` 下（改名为 `buildHTTPEntrypoint` 等）。入口启动时调用它们，并等待它们返回的 promise：启动会等待服务器就绪，promise 被拒绝（例如端口被占用）时启动失败，而等待一个长时间运行的命令（`await program.parseAsync()`）的函数会让启动一直等到命令结束。请不要 `await` 这个调用，或者改用 `commanderCLIEntrypoint()`。
- **改用适配器**：手写的 Express 服务器的中间件和路由放进 `expressHTTPEntrypoint()` 的 `before` 钩子，请求体的大小限制放进 `body`，它构造的输入放进 `input`。响应会变化：HTTP 适配器用错误的状态码和 `{errno, errMsg}` 响应错误，而 `jsonEnvelope({actionErrorStatus: 200, extra})` 能给出 2.x 应用常常自己写的 `{errno, errMsg, data}` 封套（见下面的例子）。服务适配器（HTTP 服务、Socket.IO、JSON-RPC、Electron）以 `{success, error, payload}` 响应。
- **嵌套的服务模式按键逐个比较**：`@ServiceAction({res: {name: 'user'}, act: 'get'})` 只匹配这个嵌套的值。2.x 把任何对象都当作 `[object Object]` 比较，所以仅在嵌套值上不同的两个动作会互相覆盖。
- **`Controller.context`** 的类型是 `CLIContext | HTTPContext | ServiceContext | BaseContext`：参数类型是 2.x 那个联合类型的函数不再接受 `this.context`。请加上 `BaseContext`，或者用 `instanceof` 收窄类型。
- **Electron**：Lakutata 2.x 没有 Electron 传输方式。3.x 在主进程中用 `lakutata/adapter/electron` 的 `electronIPCServiceEntrypoint()` 提供动作：预加载脚本调用 `ipcRenderer.invoke('lakutata:service', message, clientId)`，得到 `{success, error, payload}` 响应；事件来自 `entrypoint.notify(clientId, event, ...args)` 和 `entrypoint.broadcast(event, ...args)`，客户端 id 在 `this.context.clientId` 中。Electron 模板带有预加载脚本和 `window.ipc`，它的 `invoke()` 返回 payload 或者抛出错误；读取自己的 IPC 层原始响应的代码需要修改。

### 组件

见 [Database](Database.md)、[DockerIntegration](DockerIntegration.md) 和 [Logger](Logger.md)。

- **数据库**：where 条件中值为 `null` 或 `undefined` 的字段仍然会被忽略（`invalidWhereValuesBehavior`），所以 `findOneBy({id: undefined})` 会返回第一行：请检查从请求中取得的值。表名或列名含有非 ASCII 字符时，TypeORM 1 生成索引和约束名称的方式不同：`namingStrategy: new NamingStrategyV03()`（来自 `lakutata/orm`）保留 TypeORM 0.3 的名称。
- **Docker**：`exec()` 的结果是 `{exitCode, stdout, stderr}`（2.x 是字符串形式的输出）；`exec()` 和 `createTTY()` 中字符串形式的 `cmd` 通过 `/bin/sh -c` 运行，`createTTY()` 默认运行 `/bin/sh`（2.x 是 `bash`）。
- **日志**：只有标准输出是终端、且没有设置 `NO_COLOR` 时才输出颜色（2.x 总是输出颜色）；记录请求时会隐去 `Authorization`、`Cookie`、`Set-Cookie` 和 `Proxy-Authorization` 请求头（`redactedHeaders: []` 保留它们）；不是合法级别的 `level` 会让启动失败。

```typescript
import {Application, type ApplicationExitReason, type ApplicationOptions, type ILogger} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'
import {delay, md5} from 'lakutata/utils'

class HashController extends Controller {
    //2.x 中是 'lakutata/helper' 的 Delay() 和 MD5()
    @GET('/hash')
    public async hash(): Promise<{ hash: string }> {
        await delay(10)
        return {hash: md5('text').toString('hex')}
    }
}

Application
    .run((): ApplicationOptions => ({
        id: 'com.example.app',
        name: 'Example',
        //只有环境中既没有 MODE 也没有 NODE_ENV 时才使用
        mode: 'production',
        components: {
            entrypoint: buildEntrypoints({
                controllers: [HashController],
                http: expressHTTPEntrypoint({
                    port: 8080,
                    //动作的错误以 200 响应，格式为 {errno, errMsg, data, timestamp}
                    respond: jsonEnvelope({
                        actionErrorStatus: 200,
                        extra: (): Record<string, unknown> => ({timestamp: Date.now()})
                    })
                })
            })
        },
        bootstrap: ['entrypoint']
    }))
    .onDone((app: Application, log: ILogger, reason: ApplicationExitReason): void => {
        log.info('%s stopped with code %d', app.appName, reason.code)
    })
```

## 5. 有用的工具

- `lakutata create --name probe --template <模板> --path <一个临时目录>` 创建一个同类的全新 3.x 项目，用来对照它的 `package.json`、`tsconfig.json` 和脚本，Electron 项目还可以对照它的预加载脚本。`--init` 在已有的目录中创建项目，保留目录中已有的文件，并列出没有复制的文件。
- `lakutata migration generate|create|run|revert|show` 运行数据库迁移（2.x 的 `MIGRATION_*` 环境变量仍然有效）；`lakutata package bundle|exe|installer` 打包应用。见 [Command](Command.md)。

## 6. 检查升级结果

```bash
node --version                      # ^22.13.0 || >=24.11.0
npm ls lakutata @lakutata/core      # 每个包只有一个版本
npm run build                       # tsc 没有错误：没有遗留的 2.x 导入
grep -rnE "process\.on\('SIG|\|\| ''|(startup|launched|beforeDestroy|acceptsOption)\(|AccessDenyException|=== 500" src
npm test
MODE=production npm start           # 查看启动日志，然后按 Ctrl+C：onDone 运行，退出码为 0
```

- `grep` 列出能编译、但行为已经变化的代码：信号处理函数、传给选项的空字符串、与新钩子同名的成员、与 2.x 的错误名或状态码的比较。请逐行检查它找到的结果。
- 启动日志显示预期的运行模式，没有 `InvalidObjectOptionsException`，也没有以 `is not a configurable property, it is ignored` 结尾的警告。
- 不合法的输入以 400 `E_INVALID_VALUE` 响应，被拒绝的访问以 403 `E_ACCESS_DENY` 响应，未知的路由以 404 响应，并且使用客户端期望的封套。
- 配置错误时，进程以退出码 1 结束。
- 对生产数据库的副本运行 `lakutata migration generate` 不应生成任何变更：如果生成了，说明命名或实体有差异（见第 4 节的 `NamingStrategyV03`），而不是有迁移需要运行。

## 7. 常见错误

- 用查找替换给函数改名时，也会改掉包含这个名字的字符串、日志消息、对象的键和更长的名字（`RequestDelay` 中的 `Delay`）：请按整词匹配，并检查改动。新的小驼峰名字也可能与局部变量或参数重名（`delay`、`paginator`、`md5`）。
- 一个进程只能加载一份框架。`lakutata` 的 ES 模块构建和 CommonJS 构建是不同的文件：ES 模块应用加载一个只有 CommonJS 版本、并且 require 了 `lakutata` 的库时，会得到两份副本，它们的类和元数据互不相同。请让这些库同时提供两种模块系统的构建，或者让整个进程只用其中一种。
- 必填选项写成 `process.env.X || ''` 会让启动失败；写成 `|| undefined` 才会使用默认值。
- 名为 `startup`、`launched`、`beforeDestroy` 或 `acceptsOption` 的成员现在会被框架调用。
- 决定运行模式的是部署环境的 `NODE_ENV`，而不是 `mode` 选项。
- 2.x 的 SQLite 文件用 `type: 'better-sqlite3'` 打开。`better-sqlite3` 是针对某个 Node.js 版本构建的原生插件：Electron 应用需要为它的 Electron 构建的版本。
- 2.x 为超过 72 字节的密码生成的哈希不再能通过校验：请为这些用户安排重置密码。
- 用 `statusCode === 500` 判断访问被拒绝、或者比较 `err === 'AccessDenyException'` 的代码不再匹配：请比较 `errno`。

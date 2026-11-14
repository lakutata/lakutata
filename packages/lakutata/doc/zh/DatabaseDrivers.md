# Lakutata 数据库驱动

数据库的 `type` 选项决定所使用的驱动。安装 `lakutata` 时不会安装驱动包，请根据所用的数据库另行安装对应的驱动。

| 数据库 | `type` | 需要安装 |
|---|---|---|
| PostgreSQL | `postgres` | `pg`（8.5 或更高） |
| CockroachDB | `cockroachdb` | `pg` |
| MySQL、MariaDB | `mysql`、`mariadb` | `mysql2`（3.15.3 或更高） |
| SQLite | `better-sqlite3` | `better-sqlite3`（12） |
| WebAssembly 版的 SQLite | `sqljs` | `sql.js`（1.4 或更高） |
| Microsoft SQL Server | `mssql` | `mssql`（12） |
| Oracle | `oracle` | `oracledb`（6.3 或更高，或 7） |
| MongoDB | `mongodb` | `mongodb`（7） |
| 嵌入应用内的 MongoDB | `mongo-embedded` | `@lakutata/mongo-embedded`，安装时编译（需要 Python 3 和支持 C++17 的编译器）；见[嵌入式 MongoDB](MongoEmbedded.md) |
| SAP HANA | `sap` | `@sap/hana-client`（2.14 或更高） |
| Google Cloud Spanner | `spanner` | `@google-cloud/spanner`（8） |
| 通过 Data API 访问的 Amazon Aurora | `aurora-mysql`、`aurora-postgres` | `typeorm-aurora-data-api-driver`（3） |

```bash
npm install lakutata pg
```

没有名为 `sqlite` 的类型。SQLite 文件使用 `better-sqlite3`；在无法运行原生插件的环境中使用 `sqljs`。TypeORM 还提供面向移动平台 JavaScript 环境的驱动（`capacitor`、`cordova`、`expo`、`nativescript`、`react-native`），Lakutata 不使用这些驱动。`mobile-react` 模板的手机应用在 Node.js 中运行 Lakutata 应用，使用的是本页介绍的驱动（见[手机应用](#手机应用)）。

## 所有驱动通用的规则

- 连接选项会原样传给 TypeORM，TypeORM 不检查这些选项；缺少主机或密码时，由驱动在连接数据库时报错。
- `extra` 会传给驱动的客户端（连接池、连接），位于其他选项之后，可用于设置 TypeORM 未提供选项的配置。
- `driver` 直接给出驱动模块本身（`driver: require('pg')`），此时 Lakutata 不再加载驱动包。
- 以下每个示例都声明一个 `Database` 组件。`Database` 提供者的选项与之相同（见[数据库](Database.md)）。

## PostgreSQL

```typescript
import {buildDatabaseOptions} from 'lakutata/com/database'

export const db = buildDatabaseOptions({
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    username: 'app',
    password: process.env.DB_PASSWORD,
    database: 'app',
    //或者一次给出全部：url: 'postgres://app:secret@localhost:5432/app'
    entities: []
})
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `url` | | 连接 URL，用于代替下列选项 |
| `host`、`port`、`username`、`password`、`database` | | 服务器和数据库；`password` 可以是函数（同步或异步），用于读取会轮换的密钥 |
| `ssl` | | `true`，或 Node.js 的 TLS 选项（`{ca, rejectUnauthorized}`） |
| `schema` | 服务器的 `search_path`（通常是 `public`） | 表所在的 schema |
| `poolSize` | 10（`pg` 的默认值） | 连接池的最大连接数 |
| `connectTimeoutMS` | 不限 | 连接的超时时间 |
| `applicationName` | | 在服务器活动列表中显示的名称 |
| `uuidExtension` | `'uuid-ossp'` | UUID 列使用的扩展：`'uuid-ossp'` 或 `'pgcrypto'` |
| `replication` | | `{master, slaves}`：读操作发往副本 |

- **`bigint` 和 `numeric` 列以字符串返回**，以保持精度（`'9007199254740993'`、`'12.50'`）。如果数字类型已能满足需要，可以通过列的 `transformer` 转换。`parseInt8: true` 会让 `bigint` 列返回数字，但该选项修改的是 `pg` 在整个进程范围内的设置。
- 安装 `pg-native` 后，将使用 `pg` 的原生客户端。流式查询（查询构造器的 `stream()`）需要 `pg-query-stream`。

**CockroachDB** 使用同一个驱动（`type: 'cockroachdb'`），连接选项相同。必须指定其 `timeTravelQueries` 选项（读操作是否使用 follower reads）；因冲突而失败的事务会重试 5 次（`maxTransactionRetries`）。

## MySQL 与 MariaDB

```typescript
import {buildDatabaseOptions} from 'lakutata/com/database'

export const db = buildDatabaseOptions({
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    username: 'app',
    password: process.env.DB_PASSWORD,
    database: 'app',
    charset: 'utf8mb4',
    entities: []
})
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `url`、`host`、`port`、`username`、`password` | | 服务器 |
| `database` | | 数据库。必填，除非每个实体都指定了各自的数据库 |
| `socketPath` | | 使用 Unix socket 代替主机和端口 |
| `ssl` | | TLS 选项，或 TLS 配置文件的名称 |
| `charset` | `'UTF8_GENERAL_CI'` | 字符集和排序规则；如需支持完整的 Unicode（包括 emoji），请使用 `'utf8mb4'` |
| `timezone` | `'local'` | 日期的读写方式：`'local'`、`'Z'` 或偏移量（`'+08:00'`） |
| `poolSize` | 10（`mysql2` 的默认值） | 连接池的最大连接数 |
| `connectTimeout`、`acquireTimeout` | `10000` | 连接的超时时间，以及从连接池获取连接的超时时间 |
| `replication` | | `{master, slaves}`：读操作发往副本 |

- MariaDB 使用 `type: 'mariadb'`，选项相同。MariaDB 自 10.7 起支持 `uuid` 列类型。
- **`bigint` 和 `decimal` 列以字符串返回**，与 PostgreSQL 相同。
- 一张表最多只能有一个自增列。在 TypeORM 的表结构同步中，MySQL 不支持 check 约束。
- 仅支持 `mysql2`，不支持旧的 `mysql` 包。

## SQLite：better-sqlite3

```typescript
import {buildDatabaseOptions} from 'lakutata/com/database'

export const db = buildDatabaseOptions({
    type: 'better-sqlite3',
    //一个文件（会自动创建它所在的目录），或 ':memory:'
    database: 'data/app.sqlite',
    enableWAL: true,
    entities: []
})
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `database` | 必填 | 数据库文件，或 `':memory:'` |
| `enableWAL` | `false` | 预写日志（WAL）：读操作不再等待写操作 |
| `timeout` | `5000` | 数据库被其他连接锁定时，语句的等待时间，单位毫秒 |
| `readonly`、`fileMustExist` | `false` | 以只读方式打开文件；文件不存在时报错 |
| `key` | | 加密密钥，用于带 SQLCipher 的 SQLite |
| `prepareDatabase` | | `(db) => …`，连接打开后以 better-sqlite3 的连接为参数调用，可用于设置 pragma、注册函数 |
| `nativeBinding` | | 已编译模块 `better_sqlite3.node` 的路径 |

- 外键约束处于启用状态（`PRAGMA foreign_keys = ON`）。驱动只使用一个连接，因此不支持 `poolSize`。
- **`bigint` 列以数字返回**，超过 2^53 的值会丢失精度。这类值请保存在文本列中。
- `better-sqlite3` 是原生插件，针对特定的 Node.js 版本编译。Electron 应用需要针对所用 Electron 版本的构建（`electron-rebuild`，或 better-sqlite3 为 Electron 提供的预编译文件）。NW.js 应用会用 NW.js 的头文件重新构建该插件（需要 0.111.3 及以后的版本，更早的版本请使用 `sqljs`）。Bun 无法加载该插件（在 Bun 上请使用 `sqljs`）。
- 使用 Node.js 24.19 及以后版本的头文件从源码编译时，垃圾回收器释放该插件的对象会导致进程中止（`RemoveEnvironmentCleanupHook` 中的 `Assertion failed: (env) != nullptr`，见 [nodejs/node#65446](https://github.com/nodejs/node/issues/65446)）。所有基于 `node::ObjectWrap` 的插件都存在这一问题。better-sqlite3 的预编译文件使用更早的头文件编译，因此不受影响；`lakutata mobile stage` 为手机系统编译插件时，会去除 `node::ObjectWrap` 中引发该问题的清理钩子。

## SQLite：sql.js

`sql.js` 是编译为 WebAssembly 的 SQLite，不含原生插件，因此在 Node.js、Bun、Electron 和浏览器中的表现相同。整个数据库保存在内存中，发生变化时写入文件。

```typescript
import {buildDatabaseOptions} from 'lakutata/com/database'

export const db = buildDatabaseOptions({
    type: 'sqljs',
    //连接时加载（如果文件存在），每次变化后写入
    location: 'data/app.sqlite',
    autoSave: true,
    entities: []
})
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `location` | | 加载和保存的文件（在浏览器中为 `localStorage` 的键） |
| `autoSave` | `false` | 每次变化后保存。需要 `location` 或 `autoSaveCallback` |
| `autoSaveCallback` | | `(data: Uint8Array) => …`，用于代替写入 `location` |
| `database` | | 待加载的数据库内容（`Uint8Array`），用于代替 `location` |
| `useLocalForage` | `false` | 在浏览器中保存到 IndexedDB（通过 `localforage`），而不是 `localStorage` |
| `sqlJsConfig` | | sql.js 的初始化选项（用 `locateFile` 指定其 `.wasm` 文件） |
| `driver` | | 代替 `sql.js` 包自带版本的 sql.js 版本；sql.js 的 asm.js 版本（`sql.js/dist/sql-asm.js`）不需要 WebAssembly |

- 未设置 `autoSave` 时，在调用实体管理器（`SqljsEntityManager`）的 `saveDatabase()` 之前，不会向磁盘写入任何内容。设置 `autoSave` 时，事务中的变化在事务提交后保存。
- 每次保存都会写入整个文件，因此 sql.js 适合小型数据库。
- 与 better-sqlite3 相同，外键约束处于启用状态，`bigint` 列以数字返回。

## Microsoft SQL Server

```typescript
import {buildDatabaseOptions} from 'lakutata/com/database'

export const db = buildDatabaseOptions({
    type: 'mssql',
    host: 'localhost',
    port: 1433,
    username: 'sa',
    password: process.env.DB_PASSWORD,
    database: 'app',
    options: {
        //服务器使用自签名证书，比如开发环境
        trustServerCertificate: true
    },
    entities: []
})
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `url`、`host`、`port`、`username`、`password`、`database` | | 服务器和数据库 |
| `authentication` | | 用户名和密码以外的认证方式：`{type: 'ntlm', ...}`、`{type: 'azure-active-directory-default', ...}`…… |
| `schema` | 用户的默认 schema | 表所在的 schema |
| `options.encrypt` | `true` | 加密连接 |
| `options.trustServerCertificate` | `false` | 接受非受信任机构签发的证书 |
| `options.instanceName` | | 命名实例 |
| `pool` | | 连接池：`max`、`min`、`idleTimeoutMillis`（默认 30000）……（不支持 `poolSize`） |
| `connectionTimeout`、`requestTimeout` | `15000` | 连接的超时时间，以及查询的超时时间 |

- 由于 `encrypt` 默认开启，连接使用自签名证书的服务器（本地服务器、容器）时，驱动会拒绝该证书，导致连接失败，除非将 `trustServerCertificate` 设为 `true`。
- 不支持嵌套事务。

## Oracle

```typescript
import {buildDatabaseOptions} from 'lakutata/com/database'

export const db = buildDatabaseOptions({
    type: 'oracle',
    host: 'localhost',
    port: 1521,
    serviceName: 'FREEPDB1',
    username: 'app',
    password: process.env.DB_PASSWORD,
    entities: []
})
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `host`、`port`、`username`、`password` | | 服务器 |
| `serviceName` 或 `sid` | | 数据库服务 |
| `connectString` | 由上述选项生成 | 连接字符串（`'localhost:1521/FREEPDB1'`、TNS 条目），用于代替上述选项 |
| `thickMode` | `false` | `oracledb` 的 thick 模式（使用 Oracle Client 库）：`true`，或 `{libDir, configDir}` |
| `useUTC` | `false` | 以 UTC 读写日期 |
| `poolSize` | | 连接池的最大连接数 |

- `oracledb` 6 及以后的版本默认运行在 thin 模式下，不需要 Oracle Client。仅在需要 thick 模式的功能时设置 `thickMode`。
- 表位于用户自身的 schema 中。`useUTC` 会设置整个进程中所有会话的时区（环境变量 `ORA_SDTZ`）。

## MongoDB

```typescript
import {buildDatabaseOptions} from 'lakutata/com/database'
import {Column, Entity, ObjectIdColumn} from 'lakutata/decorator/orm'
import type {ObjectId} from 'lakutata/orm'

@Entity('users')
export class User {
    @ObjectIdColumn()
    public id: ObjectId

    @Column()
    public name: string
}

export const db = buildDatabaseOptions({
    type: 'mongodb',
    url: 'mongodb://localhost:27017/app',
    entities: [User]
})
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `url` | | 连接 URL |
| `host`、`port`、`username`、`password`、`database` | `127.0.0.1`、`27017` | 未提供 `url` 时使用的服务器 |
| `authSource`、`replicaSet`、`tls`、`readPreference`、`writeConcern`…… | | MongoDB 客户端的选项 |
| `poolSize` | | 最大连接数（`maxPoolSize`） |

- 实体需要有一个 `@ObjectIdColumn()`，即实体的 `_id`。该列的类型是 `lakutata/orm` 中的 `ObjectId`。在 ES 模块中，`import {ObjectId} from 'bson'` 得到的是另一个类，实体的 ID 并不是该类的实例。
- `getRepository()` 返回 `MongoRepository`，该仓储提供 MongoDB 的方法（使用 MongoDB 操作符的 `find`、`aggregate`、`createCursor`……）。
- 对于 MongoDB，TypeORM 不支持以下功能：查询构造器、`query()`、关系和级联、树形仓储、流式查询。**`transaction()` 会在没有事务的情况下执行其函数**，因此函数失败时，已写入的内容不会撤销。
- `synchronize` 仅创建索引。迁移需要手动编写（见[迁移](Migrations.md)）。

## SAP HANA、Google Cloud Spanner 与 Amazon Aurora

这些驱动直接沿用 TypeORM 的实现：

- **SAP HANA**（`sap`）：`host`、`port`、`username`、`password`、`database`、`schema`，用于加密连接的 `encrypt` 以及 `key`、`cert`、`ca`，此外还有 `pool`（`maxConnectedOrPooled`，默认 10）。
- **Google Cloud Spanner**（`spanner`）：`projectId`、`instanceId`、`databaseId`，以及 `credentials`（`client_email`、`private_key`），未提供时使用运行环境中的凭据。该驱动的类型中从 MySQL 复制而来的其他选项不会被读取。
- **通过 Data API 访问的 Amazon Aurora**（`aurora-mysql`、`aurora-postgres`）：`region`、`secretArn`、`resourceArn` 和 `database` 为必填；查询通过 AWS 的 HTTP API 发送，而不是通过数据库连接。

## 手机应用

`mobile-react` 模板的手机应用在其内嵌的 Node.js（Node.js 24.20）中运行 Lakutata 应用。下表中的驱动在其中与在电脑上同样可用，表中注明的情况除外：

| 驱动 | Android | iOS | 鸿蒙 |
|---|---|---|---|
| `better-sqlite3` | 可用 | 可用 | 可用 |
| `sqljs` 的 asm.js 版本 | 可用 | 可用 | 可用 |
| `sqljs` 的 WebAssembly 版本 | 可用 | 可用，但慢得多（使用 polyfill） | 不可用：`ReferenceError: WebAssembly is not defined` |
| `mongo-embedded` | 可用 | 可用 | 可用 |
| `postgres`、`mysql`、`mongodb`（网络上的服务器） | 可用 | 可用 | 可用 |

- `lakutata mobile stage` 使用 NDK、Xcode 或 DevEco Studio 为每个系统从源码编译 `better-sqlite3` 和 `@lakutata/mongo-embedded`（见 `@lakutata/cli` README 中的 `lakutata mobile` 命令）。
- 数据库文件需要长期保存，而 `os.tmpdir()` 是应用的缓存目录，可能被系统清空。模板的 `App.ts` 将应用的数据目录声明为别名 `@data`。该目录在 Android 上是应用的 files 目录，在 iOS 上是 `Library/Application Support`，在鸿蒙上是 `/data/storage/el2/base/files`，在开发用的电脑上是 `packages/app/data`。数据库选项可以直接使用该目录中的文件 `@data/app.sqlite`，数据库连接时会解析该别名。
- sql.js 的 asm.js 版本是编译为 JavaScript 的 SQLite，不需要 WebAssembly，也不依赖其他文件，因此在三个系统上都能同样运行。鸿蒙的 Node.js 不提供 WebAssembly，iOS 的 Node.js 只有 nodejs-mobile 的 polyfill，速度慢得多：

```typescript
import type {ApplicationOptions} from 'lakutata'
import {buildDatabaseOptions} from 'lakutata/com/database'
import {createRequire} from 'node:module'

/**
 * 应用的选项
 */
export function config(): ApplicationOptions {
    return {
        id: 'app',
        name: 'app',
        components: {
            db: buildDatabaseOptions({
                type: 'sqljs',
                location: '@data/app.sqlite',
                autoSave: true,
                //用 sql.js 的 asm.js 版本代替它的 WebAssembly 版本
                driver: createRequire(import.meta.url)('sql.js/dist/sql-asm.js'),
                entities: []
            })
        }
    }
}
```

- sql.js 1.15 将其 asm.js 版本标记为已弃用，每次加载都会打印一条警告；作者请无法放弃该版本的用户到 [sql-js/sql.js#635](https://github.com/sql-js/sql.js/issues/635) 说明情况。作者推荐的替代版本 `sql-wasm-inline.js` 需要 WebAssembly，而鸿蒙的 Node.js 不提供 WebAssembly。对于应用需要长期保存的数据库，建议使用 `better-sqlite3`，该驱动在三个系统上均可用。
- sql.js 的 WebAssembly 版本从其模块旁边的 `sql-wasm.wasm` 读取，而应用的单文件包中不包含该文件。请在 `lakutata.resources` 中将该文件声明为资源（`from` 是 npm 在工作区中安装 `sql.js` 的位置），再将其在资源中的路径传给 `sqlJsConfig.locateFile`（见[打包](Packaging.md)第 6 节）。
- 通过设备的网络连接数据库服务器；在模拟器上，使用 `adb reverse`（Android）或 `hdc rport`（鸿蒙）连接到电脑。

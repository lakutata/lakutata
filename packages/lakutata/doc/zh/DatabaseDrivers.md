# Lakutata 数据库驱动

数据库的 `type` 选项决定使用哪个驱动。安装 `lakutata` 时不会安装驱动包：根据你的数据库，另外安装对应的驱动。

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
| 嵌入应用内的 MongoDB | `mongo-embedded` | `mingo`（7.2 或更高）和 `bson`（7）；见 [MongoEmbedded](MongoEmbedded.md) |
| SAP HANA | `sap` | `@sap/hana-client`（2.14 或更高） |
| Google Cloud Spanner | `spanner` | `@google-cloud/spanner`（8） |
| 通过 Data API 访问的 Amazon Aurora | `aurora-mysql`、`aurora-postgres` | `typeorm-aurora-data-api-driver`（3） |

```bash
npm install lakutata pg
```

没有 `sqlite` 这个类型：SQLite 文件使用 `better-sqlite3`；在无法运行原生模块的环境中使用 `sqljs`。TypeORM 还有面向移动平台的驱动（`capacitor`、`cordova`、`expo`、`nativescript`、`react-native`），lakutata 不以这些平台为目标。

## 所有驱动通用的规则

- 连接选项会原样交给 TypeORM，TypeORM 不会检查它们：缺少主机或密码时，由驱动在连接数据库时报错。
- `extra` 会传给驱动的客户端（连接池、连接），放在其他选项之后：用它设置 TypeORM 没有提供选项的配置。
- `driver` 直接给出驱动模块本身（`driver: require('pg')`），不由 lakutata 去加载驱动包。
- 下面的每个示例都声明一个 `Database` 组件。`Database` 提供者的选项相同（见 [Database](Database.md)）。

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
| `url` | | 连接 URL，代替下面这些选项 |
| `host`、`port`、`username`、`password`、`database` | | 服务器和数据库；`password` 可以是函数（同步或异步），用于读取会轮换的密钥 |
| `ssl` | | `true`，或 Node.js 的 TLS 选项（`{ca, rejectUnauthorized}`） |
| `schema` | 服务器的 `search_path`（通常是 `public`） | 表所在的 schema |
| `poolSize` | 10（`pg` 的默认值） | 连接池的连接数 |
| `connectTimeoutMS` | 不限 | 连接的超时时间 |
| `applicationName` | | 在服务器活动列表中显示的名字 |
| `uuidExtension` | `'uuid-ossp'` | UUID 列使用的扩展：`'uuid-ossp'` 或 `'pgcrypto'` |
| `replication` | | `{master, slaves}`：读操作发往副本 |

- **`bigint` 和 `numeric` 列以字符串返回**，以保持精度（`'9007199254740993'`、`'12.50'`）。如果数字就够用，可以用列的 `transformer` 转换。`parseInt8: true` 会让 `bigint` 列返回数字，但它修改的是 `pg` 在整个进程中的设置。
- 安装了 `pg-native` 时会使用 `pg` 的原生客户端。流式查询（查询构造器的 `stream()`）需要 `pg-query-stream`。

**CockroachDB** 使用同一个驱动，`type: 'cockroachdb'`，连接选项相同。必须给出它的 `timeTravelQueries` 选项（读操作是否使用 follower reads）；因冲突失败的事务会重试 5 次（`maxTransactionRetries`）。

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
| `database` | | 数据库。必填，除非每个实体都指定了自己的数据库 |
| `socketPath` | | 用 unix socket 代替主机和端口 |
| `ssl` | | TLS 选项，或 TLS 配置文件的名字 |
| `charset` | `'UTF8_GENERAL_CI'` | 字符集和排序规则：要支持完整的 Unicode（包括 emoji），用 `'utf8mb4'` |
| `timezone` | `'local'` | 日期如何读写：`'local'`、`'Z'` 或偏移量（`'+08:00'`） |
| `poolSize` | 10（`mysql2` 的默认值） | 连接池的连接数 |
| `connectTimeout`、`acquireTimeout` | `10000` | 连接的超时时间，以及从连接池获取连接的超时时间 |
| `replication` | | `{master, slaves}`：读操作发往副本 |

- MariaDB 使用 `type: 'mariadb'`，选项相同。MariaDB 从 10.7 开始支持 `uuid` 列类型。
- **`bigint` 和 `decimal` 列以字符串返回**，与 PostgreSQL 相同。
- 一张表最多有一个自增列。在 TypeORM 的表结构同步中，MySQL 不支持 check 约束。
- 只支持 `mysql2`，不支持旧的 `mysql` 包。

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
| `timeout` | `5000` | 语句等待被其他连接锁住的数据库的时间，单位毫秒 |
| `readonly`、`fileMustExist` | `false` | 以只读方式打开文件；文件不存在时报错 |
| `key` | | 加密密钥，用于带 SQLCipher 的 SQLite |
| `prepareDatabase` | | `(db) => …`，连接打开后用 better-sqlite3 的连接调用它：设置 pragma、注册函数 |
| `nativeBinding` | | 编译好的模块 `better_sqlite3.node` 的路径 |

- 外键约束是生效的（`PRAGMA foreign_keys = ON`）。只有一个连接：不支持 `poolSize`。
- **`bigint` 列以数字返回**：超过 2^53 的值会丢失精度。这类值请存在文本列中。
- `better-sqlite3` 是原生模块，针对某个 Node.js 版本编译。Electron 应用需要针对它的 Electron 版本的构建（`electron-rebuild`，或 better-sqlite3 为 Electron 提供的预编译文件）；NW.js 应用会用 NW.js 的头文件重新构建它（需要 0.111.3 及以后的版本：更早的版本请使用 `sqljs`）；Bun 无法加载它（在 Bun 上使用 `sqljs`）。

## SQLite：sql.js

`sql.js` 是编译成 WebAssembly 的 SQLite：没有原生模块，所以在 Node.js、Bun、Electron 和浏览器中的表现都一样。整个数据库保存在内存中，发生变化时写入文件。

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
| `location` | | 加载和保存的文件（在浏览器中是 `localStorage` 的键） |
| `autoSave` | `false` | 每次变化后保存。需要 `location` 或 `autoSaveCallback` |
| `autoSaveCallback` | | `(data: Uint8Array) => …`，代替写入 `location` |
| `database` | | 要加载的数据库内容（`Uint8Array`），代替 `location` |
| `useLocalForage` | `false` | 在浏览器中保存到 IndexedDB（通过 `localforage`），而不是 `localStorage` |
| `sqlJsConfig` | | sql.js 初始化的选项（用 `locateFile` 指定它的 `.wasm` 文件） |

- 没有 `autoSave` 时，在调用实体管理器（`SqljsEntityManager`）的 `saveDatabase()` 之前，什么都不会写到磁盘。有 `autoSave` 时，事务中的变化在事务提交后保存。
- 每次保存都会写入整个文件：sql.js 适合小型数据库。
- 与 better-sqlite3 相同，外键约束生效，`bigint` 列以数字返回。

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
| `authentication` | | 用户名密码以外的认证方式：`{type: 'ntlm', ...}`、`{type: 'azure-active-directory-default', ...}`…… |
| `schema` | 用户的默认 schema | 表所在的 schema |
| `options.encrypt` | `true` | 加密连接 |
| `options.trustServerCertificate` | `false` | 接受不是由受信任机构签发的证书 |
| `options.instanceName` | | 命名实例 |
| `pool` | | 连接池：`max`、`min`、`idleTimeoutMillis`（默认 30000）……（不支持 `poolSize`） |
| `connectionTimeout`、`requestTimeout` | `15000` | 连接的超时时间，以及查询的超时时间 |

- 由于 `encrypt` 默认开启，使用自签名证书的服务器（本地服务器、容器）会拒绝连接，除非 `trustServerCertificate` 为 `true`。
- 事务不能嵌套。

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
| `connectString` | 由上面的选项生成 | 连接字符串（`'localhost:1521/FREEPDB1'`、TNS 条目），代替上面的选项 |
| `thickMode` | `false` | `oracledb` 的 thick 模式（使用 Oracle Client 库）：`true`，或 `{libDir, configDir}` |
| `useUTC` | `false` | 以 UTC 读写日期 |
| `poolSize` | | 连接池的连接数 |

- `oracledb` 6 及以后的版本默认运行在 thin 模式下，不需要 Oracle Client。需要 thick 模式的功能时再设置 `thickMode`。
- 表在用户自己的 schema 中。`useUTC` 会设置整个进程所有会话的时区（环境变量 `ORA_SDTZ`）。

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
| `host`、`port`、`username`、`password`、`database` | `127.0.0.1`、`27017` | 没有 `url` 时的服务器 |
| `authSource`、`replicaSet`、`tls`、`readPreference`、`writeConcern`…… | | MongoDB 客户端的选项 |
| `poolSize` | | 最大连接数（`maxPoolSize`） |

- 实体要有一个 `@ObjectIdColumn()`，即它的 `_id`。它的类型是 `lakutata/orm` 中的 `ObjectId`：在 ES 模块中 `import {ObjectId} from 'bson'` 得到的是另一个类，实体的 id 不是它的实例。
- `getRepository()` 返回 `MongoRepository`，它带有 MongoDB 的方法（使用 MongoDB 操作符的 `find`、`aggregate`、`createCursor`……）。
- TypeORM 对 MongoDB 不支持：查询构造器、`query()`、关系和级联、树形仓储、流式查询。**`transaction()` 会在没有事务的情况下执行它的函数**：函数失败时，已经写入的内容不会撤销。
- `synchronize` 只创建索引。迁移需要手写（见 [Migrations](Migrations.md)）。

## SAP HANA、Google Cloud Spanner 与 Amazon Aurora

这些驱动原样来自 TypeORM：

- **SAP HANA**（`sap`）：`host`、`port`、`username`、`password`、`database`、`schema`，加密连接的 `encrypt` 以及 `key`、`cert`、`ca`，还有 `pool`（`maxConnectedOrPooled`，默认 10）。
- **Google Cloud Spanner**（`spanner`）：`projectId`、`instanceId`、`databaseId`，以及 `credentials`（`client_email`、`private_key`），不给出时使用运行环境中的凭据。它的类型中从 MySQL 复制来的其他选项不会被读取。
- **通过 Data API 访问的 Amazon Aurora**（`aurora-mysql`、`aurora-postgres`）：`region`、`secretArn`、`resourceArn` 和 `database` 为必填；查询通过 AWS 的 HTTP API 发送，而不是通过数据库连接。

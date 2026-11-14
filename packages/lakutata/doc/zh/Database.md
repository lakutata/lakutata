# Lakutata 数据库

Lakutata 的数据库层是 `@lakutata/orm` 包，基于 [TypeORM](https://typeorm.io) 1 构建。TypeORM 的源码已包含在该包中，因此不会另行安装 `typeorm` 包。`lakutata` 通过以下四个子路径重新导出 `@lakutata/orm`：

| 子路径 | 提供的内容 |
|---|---|
| `lakutata/com/database` | `Database` 组件（整个应用共享的连接）和 `buildDatabaseOptions` |
| `lakutata/provider/database` | `Database` 提供者（每次解析都使用独立的连接） |
| `lakutata/decorator/orm` | 实体装饰器（`@Entity`、`@Column`、各类关系……） |
| `lakutata/orm` | TypeORM 的 API：仓储、实体管理器、查询操作符、迁移、错误 |

数据库驱动需要单独安装，见[数据库驱动](DatabaseDrivers.md)。实体、查询和事务见[实体、查询与事务](Entities.md)，表结构变更见[迁移](Migrations.md)。

## 1. Database 组件

`buildDatabaseOptions` 以 TypeORM 的连接选项声明一个 `Database` 组件：

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildDatabaseOptions, Database} from 'lakutata/com/database'
import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

@Entity('users')
class User {
    @PrimaryGeneratedColumn()
    public id: number

    @Column({type: 'varchar', length: 100})
    public name: string

    @Column({unique: true})
    public email: string
}

class Users extends Component {
    //声明为 "db" 的组件
    @Inject('db')
    protected readonly db: Database

    public async register(name: string, email: string): Promise<User> {
        return await this.db.getRepository(User).save({name: name, email: email})
    }

    public async find(id: number): Promise<User | null> {
        return await this.db.getRepository(User).findOneBy({id: id})
    }
}

Application
    .run(() => ({
        id: 'users.app',
        name: 'Users',
        components: {
            db: buildDatabaseOptions({
                type: 'postgres',
                url: process.env.DATABASE_URL,
                entities: [User],
                //只用于开发：表结构跟随实体变化。生产环境请使用迁移
                synchronize: true
            }),
            users: {class: Users}
        },
        bootstrap: ['db']
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const users: Users = await app.getObject<Users>('users')
        await users.register('Ada', 'ada@example.com')
    })
```

- 组件在创建时连接数据库。若组件列在 `bootstrap` 中，则在应用启动过程中连接，连接失败会导致启动失败；否则在首次使用时才连接。
- 应用停止时，组件会断开连接。
- 其他对象按名称注入该组件（`@Inject('db')`），或者通过 `getObject('db')` 获取。

## 2. 连接选项

这些选项即 TypeORM 的选项，会原样传给 TypeORM。各驱动特有的选项见[数据库驱动](DatabaseDrivers.md)，通用选项如下：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `type` | 必填 | 驱动：`'postgres'`、`'mysql'`、`'better-sqlite3'`…… |
| `entities` | | 实体类、`EntitySchema`，或者编译后文件的 glob（`'build/entities/*.js'`） |
| `synchronize` | `false` | 每次连接时按实体更新表结构。仅用于开发 |
| `logging` | `false` | TypeORM 记录的内容：`true`，或者由 `'query'`、`'error'`、`'schema'`、`'warn'`、`'info'`、`'log'` 组成的列表 |
| `logger` | | TypeORM 日志的输出位置：`'advanced-console'`、`'simple-console'`、`'file'`、`'debug'`，或者自定义的日志记录器 |
| `maxQueryExecutionTime` | | 记录执行时间超过该值（毫秒）的查询 |
| `poolSize` | | 连接池的最大连接数 |
| `extra` | | 传给驱动客户端的选项 |
| `migrations`、`migrationsRun`、`migrationsTableName`、`migrationsTransactionMode` | | 迁移（见[迁移](Migrations.md)） |
| `subscribers` | | 实体订阅者 |
| `namingStrategy` | | 表、列和索引的命名方式 |
| `cache` | | 查询结果缓存：`true`（保存在数据库的一张表中），或者 `{type: 'redis', options}` |
| `invalidWhereValuesBehavior` | `{null: 'ignore', undefined: 'ignore'}` | where 条件中 `null` 和 `undefined` 的处理方式（见下文） |

**条件中的 `null` 和 `undefined`。** 默认情况下，where 条件中值为 `null` 或 `undefined` 的属性会被忽略，这与 TypeORM 0.3 相同；TypeORM 1 的默认行为则是抛出错误。因此 `findOneBy({id: undefined})` 会查到表中的第一行。使用请求中的值查询之前，应先检查这些值；也可以设置 `invalidWhereValuesBehavior: {undefined: 'throw'}`，让这类值抛出错误（所给出的每个键会替换该键的默认值）。

**带别名的路径。** 以应用别名书写的路径（`@data/app.sqlite`、`@app/migrations/*.js`）会在数据库连接时解析：数据库文件（`database`，sql.js 的 `location`），以及实体、迁移和订阅者的 glob。别名由 `.alias()` 声明（见[应用](Application.md)第 2 节）。

**用 TypeORM 0.3 创建的数据库。** 如果表名或列名中包含非 ASCII 字符，TypeORM 1 为其索引和约束生成的名称会有所不同，因此生成的迁移会重命名这些索引和约束。`namingStrategy: new NamingStrategyV03()`（来自 `lakutata/orm`）可以保持 TypeORM 0.3 的命名。

**保存在 Redis 中的查询缓存**（`cache: {type: 'redis'}` 或 `'ioredis'`）需要安装 `redis` 或 `ioredis` 包。

## 3. 组件提供的功能

组件提供 TypeORM 数据源的 API：

| 方法或属性 | 作用 |
|---|---|
| `getRepository(Entity)` | 实体的仓储（在 MongoDB 上是 `MongoRepository`） |
| `getMongoRepository(Entity)`、`getTreeRepository(Entity)` | MongoDB 的仓储、树形实体的仓储 |
| `manager` | 实体管理器 |
| `transaction(fn)`、`transaction(isolationLevel, fn)` | 在事务中执行一个函数 |
| `query(sql, parameters)` | 执行 SQL；占位符在 PostgreSQL 上是 `$1, $2…`，在 MySQL 和 SQLite 上是 `?` |
| `createQueryBuilder(Entity, alias)` | 查询构造器 |
| `createQueryRunner(mode)` | 连接池中的一个连接，用于手动控制事务；`'slave'` 从副本读取 |
| `synchronize()` | 按实体更新表结构 |
| `runMigrations()`、`undoLastMigration()`、`showMigrations()` | 执行、回退和列出迁移 |
| `hasMetadata(Entity)`、`getMetadata(Entity)` | 是否已知某个实体，以及该实体的元数据 |

## 4. Database 提供者

`lakutata/provider/database` 中的 `Database` 具有相同的 API，但它是**瞬态**的：每次解析（`@Inject`、`getObject()`）都会创建一个新实例，并打开独立的连接池；该实例随创建它的对象或容器一起销毁时，连接池也随之关闭。提供者适合短时任务（一个作业、一个脚本、每个客户一个数据库），而应用中的请求共享组件。

```typescript
import {Application} from 'lakutata'
import {buildDatabaseOptions, Database} from 'lakutata/provider/database'
import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

@Entity('reports')
class Report {
    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public title: string
}

Application
    .run(() => ({
        id: 'reports.app',
        name: 'Reports',
        providers: {
            reports: {
                ...buildDatabaseOptions({type: 'postgres', url: process.env.REPORTS_URL}),
                //加到连接选项的实体中
                entities: [Report]
            }
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        //在这里打开连接，随应用一起关闭
        const database: Database = await app.getObject<Database>('reports')
        console.log(await database.getRepository(Report).count())
    })
```

## 5. 多个数据库

每个数据库都是一个独立的组件，按各自的名称注入：

```typescript
import {Application} from 'lakutata'
import {buildDatabaseOptions} from 'lakutata/com/database'

Application.run(() => ({
    id: 'shop.app',
    name: 'Shop',
    components: {
        db: buildDatabaseOptions({type: 'postgres', url: process.env.DATABASE_URL, entities: []}),
        analytics: buildDatabaseOptions({type: 'mysql', url: process.env.ANALYTICS_URL, entities: []})
    },
    bootstrap: ['db', 'analytics']
}))
```

一个实体可以属于多个数据库，其仓储来自调用 `getRepository()` 的数据库。

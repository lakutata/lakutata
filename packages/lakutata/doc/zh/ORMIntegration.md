# Lakutata ORM 集成

框架的 ORM（`@lakutata/orm` 包）基于 [TypeORM](https://typeorm.io) 0.3。`lakutata` 包通过四个子路径重新导出它：

| 子路径 | 内容 |
|---|---|
| `lakutata/com/database` | `Database` 组件（整个应用共享一个连接）和 `buildDatabaseOptions` |
| `lakutata/provider/database` | `Database` 提供者（每次解析都有自己的连接）和 `buildDatabaseOptions` |
| `lakutata/decorator/orm` | TypeORM 的实体装饰器（`@Entity`、`@Column`、关系等） |
| `lakutata/orm` | TypeORM 的 API：`Repository`、`EntityManager`、`QueryRunner`、查询操作符、`BaseEntity`、迁移、错误类 |

更多细节见 `@lakutata/orm` 的 README；实体、查询选项、查询构建器和迁移的用法见 TypeORM 文档。

## 1. 安装

TypeORM 是该包的依赖，数据库驱动则不是。请按连接的 `type` 安装对应的驱动：

| 数据库 | `type` | 需安装 |
|---|---|---|
| PostgreSQL、CockroachDB | `postgres`、`cockroachdb` | `pg` |
| MySQL、MariaDB | `mysql`、`mariadb` | `mysql2` |
| SQLite | `sqlite` / `better-sqlite3` | `sqlite3` / `better-sqlite3` |
| 内存中的 SQLite（WebAssembly） | `sqljs` | `sql.js` |
| Microsoft SQL Server | `mssql` | `mssql` |
| Oracle | `oracle` | `oracledb` |
| MongoDB | `mongodb` | `mongodb`（5 或 6） |

```shell
npm install lakutata pg
```

## 2. Database 组件

`buildDatabaseOptions` 用 TypeORM 的连接选项（`DataSourceOptions`，原样传给 TypeORM）声明一个 `Database` 组件。组件在创建时连接数据库（列入 `bootstrap` 时在启动阶段连接；连接失败会使启动失败），在应用停止时断开。其他对象按名称注入它。

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildDatabaseOptions, Database} from 'lakutata/com/database'
import {Column, CreateDateColumn, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

@Entity('users')
class User {
    @PrimaryGeneratedColumn()
    public id: number

    @Column({type: 'varchar', length: 100})
    public name: string

    @Column({unique: true})
    public email: string

    @CreateDateColumn({type: 'timestamptz'})
    public createdAt: Date
}

class Users extends Component {
    //以 "db" 注册的组件
    @Inject('db')
    protected readonly db: Database

    public async register(name: string, email: string): Promise<User> {
        return await this.db.getRepository(User).save({name: name, email: email})
    }

    public async find(id: number): Promise<User | null> {
        return await this.db.getRepository(User).findOneBy({id: id})
    }

    public async rename(id: number, name: string): Promise<void> {
        await this.db.getRepository(User).update({id: id}, {name: name})
    }

    public async remove(id: number): Promise<boolean> {
        const result = await this.db.getRepository(User).delete({id: id})
        return !!result.affected
    }
}

Application
    .run(() => ({
        id: 'com.example.users',
        name: 'Users',
        components: {
            db: buildDatabaseOptions({
                type: 'postgres',
                host: process.env.DB_HOST ?? 'localhost',
                port: 5432,
                username: 'postgres',
                password: process.env.DB_PASSWORD,
                database: 'users',
                entities: [User],
                //仅用于开发：表结构跟随实体变化；生产环境用迁移修改表结构
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

常用的连接选项：

| 选项 | 含义 |
|---|---|
| `type` | 驱动：`'postgres'`、`'mysql'`、`'sqlite'` 等 |
| `url` 或 `host`、`port`、`username`、`password`、`database` | 服务器和数据库 |
| `entities` | 实体类、`EntitySchema`，或其编译后文件的 glob 路径（`'dist/entities/*.js'`） |
| `synchronize` | 每次连接时根据实体更新表结构（默认 `false`）：仅用于开发 |
| `migrations`、`migrationsRun`、`migrationsTransactionMode` | 迁移列表、是否在每次连接时执行（默认 `false`）、迁移的事务方式（默认 `'all'`） |
| `logging`、`logger` | TypeORM 记录哪些日志以及记录到哪里 |
| `poolSize`、`extra` | 连接池大小；传给驱动的选项 |
| `subscribers`、`namingStrategy`、`cache` | 实体订阅者、表名和列名的命名策略、查询结果缓存 |

组件提供数据源的 TypeORM API：`getRepository()`、`getTreeRepository()`、`getMongoRepository()`、`manager`、`transaction()`、`query()`、`createQueryBuilder()`、`createQueryRunner()`、`synchronize()`、`runMigrations()`、`undoLastMigration()`、`showMigrations()`。

## 3. 实体

`lakutata/decorator/orm` 中的装饰器就是 TypeORM 的装饰器（完整列表见 [Decorator](Decorator.md)）：

```typescript
import {
    BeforeInsert, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany,
    PrimaryGeneratedColumn, UpdateDateColumn, VersionColumn
} from 'lakutata/decorator/orm'

@Entity('orders')
export class Order {
    @PrimaryGeneratedColumn('uuid')
    public id: string

    @Index()
    @Column()
    public customer: string

    //随订单一起保存
    @OneToMany(() => OrderLine, (line: OrderLine) => line.order, {cascade: true})
    public lines: OrderLine[]

    @CreateDateColumn({type: 'timestamptz'})
    public createdAt: Date

    @UpdateDateColumn({type: 'timestamptz'})
    public updatedAt: Date

    //由 softDelete() 设置：除非指定 withDeleted，查询会跳过该订单
    @DeleteDateColumn({type: 'timestamptz'})
    public deletedAt: Date | null

    //每次保存时递增
    @VersionColumn()
    public version: number

    @BeforeInsert()
    protected normalize(): void {
        this.customer = this.customer.trim()
    }
}

@Entity('order_lines')
export class OrderLine {
    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public product: string

    @Column('integer')
    public quantity: number

    @ManyToOne(() => Order, (order: Order) => order.lines, {onDelete: 'CASCADE'})
    @JoinColumn({name: 'order_id'})
    public order: Order
}
```

实体也可以继承 `BaseEntity`（来自 `lakutata/orm`）以使用活动记录风格的操作（`User.findOneBy()`、`user.save()`）：它们使用最后一个注册了该实体的连接。

## 4. 查询

`lakutata/orm` 导出了查询操作符（`In`、`ILike`、`Between`、`MoreThan`、`IsNull`、`Not`、`Raw` 等）、仓储和查询构建器。

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Database} from 'lakutata/com/database'
import {Between, ILike, type Repository} from 'lakutata/orm'

class Orders extends Component {
    @Inject('db')
    protected readonly db: Database

    protected get orders(): Repository<Order> {
        return this.db.getRepository(Order)
    }

    //某段时间内订单的一页，以及订单总数
    public async search(customer: string, from: Date, to: Date, page: number): Promise<[Order[], number]> {
        return await this.orders.findAndCount({
            where: {customer: ILike(`%${customer}%`), createdAt: Between(from, to)},
            order: {createdAt: 'DESC'},
            skip: (page - 1) * 20,
            take: 20
        })
    }

    //查询构建器
    public async findByCustomer(customer: string): Promise<Order[]> {
        return await this.db.createQueryBuilder(Order, 'order')
            .where('order.customer LIKE :customer', {customer: `%${customer}%`})
            .orderBy('order.createdAt', 'DESC')
            .getMany()
    }

    //原生 SQL：PostgreSQL 的占位符是 $1、$2…
    public async count(customer: string): Promise<number> {
        const rows: { count: string }[] = await this.db.query('SELECT COUNT(*) AS count FROM orders WHERE customer = $1', [customer])
        return Number(rows[0].count)
    }
}
```

## 5. 事务

`transaction([isolationLevel], fn)` 在事务中执行函数：函数完成时提交，失败时回滚（并重新抛出其错误）。事务中的操作要通过传给函数的实体管理器执行；通过 `db.manager` 或 `db.getRepository()` 执行的操作不在该事务中。`createQueryRunner()` 用于手动控制事务。

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Database} from 'lakutata/com/database'
import {type EntityManager} from 'lakutata/orm'

class Signup extends Component {
    @Inject('db')
    protected readonly db: Database

    //两次保存要么都成功，要么都不生效
    public async signup(name: string, email: string, product: string): Promise<User> {
        return await this.db.transaction('SERIALIZABLE', async (manager: EntityManager): Promise<User> => {
            const user: User = await manager.save(User, {name: name, email: email})
            await manager.save(Order, {customer: email, lines: [{product: product, quantity: 1}]})
            return user
        })
    }
}
```

## 6. Database 提供者

`lakutata/provider/database` 中的提供者与组件的 API 相同，但它是瞬态的：每次解析（`@Inject`、`getObject()`）都会创建一个新实例，该实例打开自己的连接池，并在随创建它的对象或容器一起销毁时关闭。它适合短时使用（任务、脚本、租户数据库）；应用的各个请求共享组件。它的 `entities` 选项会追加到连接选项的实体中。

```typescript
import {Application} from 'lakutata'
import {buildDatabaseOptions, Database} from 'lakutata/provider/database'

Application
    .run(() => ({
        id: 'com.example.reports',
        name: 'Reports',
        providers: {
            reports: {
                ...buildDatabaseOptions({type: 'postgres', url: process.env.REPORTS_URL}),
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

## 7. 多个数据库

每个数据库是一个有自己名称的组件，按该名称注入：

```typescript
Application.run(() => ({
    id: 'com.example.shop',
    name: 'Shop',
    components: {
        db: buildDatabaseOptions({type: 'postgres', url: process.env.DATABASE_URL, entities: [User, Order, OrderLine]}),
        analytics: buildDatabaseOptions({type: 'mysql', url: process.env.ANALYTICS_URL, entities: [Visit]})
    },
    bootstrap: ['db', 'analytics']
}))
```

## 8. 迁移

迁移是实现了 `MigrationInterface`（来自 `lakutata/orm`）的类：`up()` 修改表结构，`down()` 撤销修改。连接选项 `migrations` 列出所有迁移。迁移在以下情况下执行：连接时设置了 `migrationsRun: true`，调用组件或提供者的 `runMigrations()` 和 `undoLastMigration()`，或者通过应用的迁移命令。

迁移命令是传给应用本身的环境变量：带着其中一个变量启动时，应用读取自己的选项，然后不执行 `bootstrap` 和 `onLaunched` 处理函数，而是对选项中的每个 `Database` 组件和提供者执行该命令，然后退出（成功时退出码为 0，失败时为 1）。

| 变量 | 命令 |
|---|---|
| `MIGRATION_GENERATE=<directory>` | 比较实体和数据库表结构，把差异的 SQL 作为迁移写入该目录 |
| `MIGRATION_RUN=1` | 执行待执行的迁移 |
| `MIGRATION_REVERT=1` | 撤销最后一次执行的迁移（有多个数据库时必须指定 `MIGRATION_DATABASE`） |
| `MIGRATION_SHOW=1` | 列出已执行和待执行的迁移 |
| `MIGRATION_DATABASE=<name>` | 命令作用的数据库（默认全部） |
| `MIGRATION_TRANSACTION=all\|each\|none` | `MIGRATION_RUN` 和 `MIGRATION_REVERT` 的事务方式 |
| `MIGRATION_FAKE=1` | 只把迁移记录为已执行（或已撤销），不真正执行 |

```shell
MIGRATION_GENERATE=src/migrations node dist/App.js
MIGRATION_RUN=1 node dist/App.js
```

## 9. 注意事项

- 生产环境中把 `synchronize` 设为 `false`，用迁移修改表结构。
- `pg` 把 `numeric` 和 `bigint` 列读成字符串：用列的 `transformer` 进行转换。
- 错误类型是 TypeORM 的错误，由 `lakutata/orm` 导出：`QueryFailedError`（其 `driverError` 包含驱动的错误）、`EntityNotFoundError`（`findOneByOrFail()`）、`EntityMetadataNotFoundError`（实体不在连接的 `entities` 中）等。

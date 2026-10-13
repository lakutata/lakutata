# Lakutata ORM Integration

The ORM of the framework (the package `@lakutata/orm`) is built on [TypeORM](https://typeorm.io) 1. The package
`lakutata` re-exports it under four subpaths:

| Subpath | What it provides |
|---|---|
| `lakutata/com/database` | The `Database` component (a connection shared by the application) and `buildDatabaseOptions` |
| `lakutata/provider/database` | The `Database` provider (a connection of its own per resolution) and `buildDatabaseOptions` |
| `lakutata/decorator/orm` | The TypeORM entity decorators (`@Entity`, `@Column`, the relations…) |
| `lakutata/orm` | The TypeORM API: `Repository`, `EntityManager`, `QueryRunner`, the find operators, `BaseEntity`, the migrations, the errors |

The README of `@lakutata/orm` gives the details; the TypeORM documentation describes the entities, the find options,
the query builder and the migrations.

## 1. Installation

TypeORM is a dependency of the package; the database driver is not. Install the driver of the `type` of the connection:

| Database | `type` | Install |
|---|---|---|
| PostgreSQL, CockroachDB | `postgres`, `cockroachdb` | `pg` |
| MySQL, MariaDB | `mysql`, `mariadb` | `mysql2` (3.15.3 or later) |
| SQLite | `better-sqlite3` | `better-sqlite3` (12) |
| SQLite in memory (WebAssembly) | `sqljs` | `sql.js` |
| Microsoft SQL Server | `mssql` | `mssql` (12) |
| Oracle | `oracle` | `oracledb` |
| MongoDB | `mongodb` | `mongodb` (7) |

```shell
npm install lakutata pg
```

## 2. The Database component

`buildDatabaseOptions` declares a `Database` component with the TypeORM connection options (`DataSourceOptions`, passed
to TypeORM as they are). The component connects when it is created (at launch when it is listed in `bootstrap`; a
connection failure stops the launch) and disconnects when the application stops. Other objects inject it by its name.

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
    //The component registered as "db"
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
                //Development only: the schema follows the entities; the migrations change it in production
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

The common connection options:

| Option | What it sets |
|---|---|
| `type` | The driver: `'postgres'`, `'mysql'`, `'better-sqlite3'`… |
| `url` or `host`, `port`, `username`, `password`, `database` | The server and the database |
| `entities` | The entity classes, `EntitySchema`s, or glob paths of their compiled files (`'dist/entities/*.js'`) |
| `synchronize` | Update the schema from the entities on each connection (default `false`): development only |
| `migrations`, `migrationsRun`, `migrationsTransactionMode` | The migrations, whether they run on each connection (default `false`), their transactions (default `'all'`) |
| `logging`, `logger` | What TypeORM logs and where |
| `poolSize`, `extra` | The connection pool size; the options passed to the driver |
| `subscribers`, `namingStrategy`, `cache` | The entity subscribers, the naming of the tables and columns, the query result cache |

The framework sets one option of its own: `invalidWhereValuesBehavior` is `{null: 'ignore', undefined: 'ignore'}` by
default, the behavior of TypeORM 0.3 (TypeORM 1 throws by default): a property of a where condition whose value is
`null` or `undefined` is left out of the condition. Each key given replaces its default
(`invalidWhereValuesBehavior: {undefined: 'throw'}` throws on the undefined values). With the default,
`findOneBy({id: undefined})` finds the first row: check the values taken from the requests before querying with them.

A database created with TypeORM 0.3 whose table or column names have characters outside ASCII: TypeORM 1 names their
indices and constraints differently, and the migrations generated rename them. The `NamingStrategyV03` of the package
`@typeorm/legacy-naming-strategies` (`namingStrategy: new NamingStrategyV03()`) keeps the names of TypeORM 0.3.

The component gives the TypeORM API of a data source: `getRepository()`, `getTreeRepository()`,
`getMongoRepository()`, `manager`, `transaction()`, `query()`, `createQueryBuilder()`, `createQueryRunner()`,
`synchronize()`, `runMigrations()`, `undoLastMigration()`, `showMigrations()`.

## 3. Entities

The decorators of `lakutata/decorator/orm` are the ones of TypeORM (see [Decorator](Decorator.md) for the list):

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

    //Saved with the order
    @OneToMany(() => OrderLine, (line: OrderLine) => line.order, {cascade: true})
    public lines: OrderLine[]

    @CreateDateColumn({type: 'timestamptz'})
    public createdAt: Date

    @UpdateDateColumn({type: 'timestamptz'})
    public updatedAt: Date

    //Set by softDelete(): the finds skip the order unless withDeleted is set
    @DeleteDateColumn({type: 'timestamptz'})
    public deletedAt: Date | null

    //Incremented by each save
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

An entity may also extend `BaseEntity` (from `lakutata/orm`) for the active record operations (`User.findOneBy()`,
`user.save()`): they use the last connection that registered the entity.

## 4. Queries

`lakutata/orm` exports the find operators (`In`, `ILike`, `Between`, `MoreThan`, `IsNull`, `Not`, `Raw`…), the
repositories and the query builders. The find options take objects: `relations: {author: true}`, `select: {id: true, title: true}` (TypeORM 1 removed
the arrays of names).

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

    //A page of the orders of a period, and their count
    public async search(customer: string, from: Date, to: Date, page: number): Promise<[Order[], number]> {
        return await this.orders.findAndCount({
            where: {customer: ILike(`%${customer}%`), createdAt: Between(from, to)},
            order: {createdAt: 'DESC'},
            skip: (page - 1) * 20,
            take: 20
        })
    }

    //A query builder
    public async findByCustomer(customer: string): Promise<Order[]> {
        return await this.db.createQueryBuilder(Order, 'order')
            .where('order.customer LIKE :customer', {customer: `%${customer}%`})
            .orderBy('order.createdAt', 'DESC')
            .getMany()
    }

    //Raw SQL: the PostgreSQL placeholders are $1, $2…
    public async count(customer: string): Promise<number> {
        const rows: { count: string }[] = await this.db.query('SELECT COUNT(*) AS count FROM orders WHERE customer = $1', [customer])
        return Number(rows[0].count)
    }
}
```

## 5. Transactions

`transaction([isolationLevel], fn)` runs a function in a transaction: committed when it resolves, rolled back when it
rejects (its error rethrown). The operations of the transaction go through the entity manager given to the function;
the ones made through `db.manager` or `db.getRepository()` run outside of it. `createQueryRunner()` controls a
transaction by hand.

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Database} from 'lakutata/com/database'
import {type EntityManager} from 'lakutata/orm'

class Signup extends Component {
    @Inject('db')
    protected readonly db: Database

    //Both saves, or none
    public async signup(name: string, email: string, product: string): Promise<User> {
        return await this.db.transaction('SERIALIZABLE', async (manager: EntityManager): Promise<User> => {
            const user: User = await manager.save(User, {name: name, email: email})
            await manager.save(Order, {customer: email, lines: [{product: product, quantity: 1}]})
            return user
        })
    }
}
```

## 6. The Database provider

The provider of `lakutata/provider/database` has the API of the component, but it is transient: each resolution
(`@Inject`, `getObject()`) creates a new instance, which opens its own connection pool and closes it when it is
destroyed with the object or the container that created it. It suits a short use (a job, a script, a tenant
database); the requests of an application share the component. Its `entities` option is added to the entities of its
connection options.

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
        //A connection opened here, closed with the application
        const database: Database = await app.getObject<Database>('reports')
        console.log(await database.getRepository(Report).count())
    })
```

## 7. Several databases

Each database is a component of its own name, injected by that name:

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

## 8. Migrations

A migration is a class implementing `MigrationInterface` (from `lakutata/orm`): its `up()` changes the schema, its
`down()` reverts the change. The `migrations` connection option lists them. They run when the database connects with
`migrationsRun: true`, by `runMigrations()` and `undoLastMigration()` of the component or provider, or by the commands
of the application.

The commands are environment variables given to the application itself: started with one of them, the application
reads its options, then, instead of its `bootstrap` and its `onLaunched` handlers, does the command on each `Database`
component and provider of its options, and exits (code 0, or 1 when the command fails).

| Variable | Command |
|---|---|
| `MIGRATION_GENERATE=<directory>` | Write the SQL of the differences between the entities and the schema as a migration in the directory |
| `MIGRATION_RUN=1` | Run the pending migrations |
| `MIGRATION_REVERT=1` | Revert the last migration run (`MIGRATION_DATABASE` required with several databases) |
| `MIGRATION_SHOW=1` | Print the migrations run and pending |
| `MIGRATION_DATABASE=<name>` | The database of the command (all by default) |
| `MIGRATION_TRANSACTION=all\|each\|none` | The transactions of `MIGRATION_RUN` and `MIGRATION_REVERT` |
| `MIGRATION_FAKE=1` | Record the migrations as run (or reverted) without running them |

```shell
MIGRATION_GENERATE=src/migrations node dist/App.js
MIGRATION_RUN=1 node dist/App.js
```

## 9. Notes

- Set `synchronize` to `false` in production and change the schema with migrations.
- `pg` reads the `numeric` and `bigint` columns back as strings: convert them with a column `transformer`.
- The errors are the ones of TypeORM, exported by `lakutata/orm`: `QueryFailedError` (its `driverError` holds the
  driver error), `EntityNotFoundError` (`findOneByOrFail()`), `EntityMetadataNotFoundError` (an entity not in the
  `entities` of the connection)…

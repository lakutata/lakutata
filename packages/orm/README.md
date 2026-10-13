# @lakutata/orm

The ORM of the lakutata framework, built on [TypeORM](https://typeorm.io) 1: the `Database` component (a
connection shared by the application), the `Database` provider (a connection of its own), the entity decorators, the
TypeORM API (repositories, find operators, query builders, migrations), and the migration commands of the applications
(`MIGRATION_GENERATE`, `MIGRATION_RUN`, `MIGRATION_REVERT`, `MIGRATION_SHOW`).

The umbrella package `lakutata` re-exports it: `lakutata/com/database` (the component), `lakutata/provider/database`
(the provider), `lakutata/decorator/orm` (the entity decorators) and `lakutata/orm` (the TypeORM API).

## Installation

```shell
npm install lakutata pg        # the framework, and the PostgreSQL driver
npm install @lakutata/orm      # or the ORM only, with @lakutata/core
```

The source of TypeORM 1.1.2 (MIT) is part of the package (`THIRD_PARTY_NOTICES.md`): no package `typeorm` is
installed, and the libraries built on the package `typeorm` (its NestJS module, the libraries of naming strategies…)
do not share it. The database driver is not a dependency: install the driver of the `type` of the connection options:

| Database | `type` | Install |
|---|---|---|
| PostgreSQL, CockroachDB | `postgres`, `cockroachdb` | `pg` |
| MySQL, MariaDB | `mysql`, `mariadb` | `mysql2` (3.15.3 or later) |
| SQLite | `better-sqlite3` | `better-sqlite3` (12) |
| SQLite in memory (WebAssembly) | `sqljs` | `sql.js` |
| Microsoft SQL Server | `mssql` | `mssql` (12) |
| Oracle | `oracle` | `oracledb` |
| MongoDB | `mongodb` | `mongodb` (7) |
| SAP HANA | `sap` | `@sap/hana-client` |
| Google Cloud Spanner | `spanner` | `@google-cloud/spanner` (8) |

The query result cache stored in Redis (`cache: {type: 'redis'}` or `'ioredis'`) needs `redis` or `ioredis`.

The entities use the decorators and their metadata: the TypeScript options of the applications (`"extends":
"lakutata/tsconfig.json"`) enable `experimentalDecorators` and `emitDecoratorMetadata`.

## Usage

### A database in an application

`buildDatabaseOptions` registers a `Database` component with the TypeORM connection options (`DataSourceOptions`,
passed to TypeORM as they are). The component connects when it is created (while the application launches when it is
listed in `bootstrap`), and disconnects when the application stops. A connection failure stops the launch of the
application.

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildDatabaseOptions, Database} from 'lakutata/com/database'
import {Column, CreateDateColumn, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

@Entity('users')
class User {
    @PrimaryGeneratedColumn()
    public id: number

    @Column({unique: true})
    public email: string

    @CreateDateColumn({type: 'timestamptz'})
    public createdAt: Date
}

class Users extends Component {
    //The component registered as db
    @Inject('db')
    protected readonly db: Database

    public async register(email: string): Promise<User> {
        return await this.db.getRepository(User).save({email: email})
    }

    public async find(email: string): Promise<User | null> {
        return await this.db.getRepository(User).findOneBy({email: email})
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
        const users: Users = await app.getObject('users')
        await users.register('ada@example.com')
    })
```

The common connection options (see the TypeORM documentation for the options of each driver):

| Option | What it sets |
|---|---|
| `type` | The driver: `'postgres'`, `'mysql'`, `'better-sqlite3'`… |
| `url` or `host`, `port`, `username`, `password`, `database` | The server and the database |
| `schema` | The PostgreSQL schema of the tables (default `public`) |
| `entities` | The entity classes, `EntitySchema`s, or glob paths of their compiled files (`'dist/entities/*.js'`) |
| `synchronize` | Update the schema from the entities on each connection (default `false`): development only |
| `migrations`, `migrationsTableName`, `migrationsRun`, `migrationsTransactionMode` | The migrations, their table (default `migrations`), whether they run on each connection (default `false`), their transactions (default `'all'`) |
| `logging`, `logger` | What TypeORM logs (`true`, `['error', 'schema']`…) and where |
| `poolSize`, `extra` | The connection pool size; the options passed to the driver (`extra: {max: 20}` for `pg`) |
| `subscribers`, `namingStrategy`, `cache` | The entity subscribers, the naming of the tables and columns, the query result cache |

The framework sets one option of its own: `invalidWhereValuesBehavior` is `{null: 'ignore', undefined: 'ignore'}` by
default, the behavior of TypeORM 0.3 (TypeORM 1 throws by default): a property of a where condition whose value is
`null` or `undefined` is left out of the condition. Each key given replaces its default
(`invalidWhereValuesBehavior: {undefined: 'throw'}` throws on the undefined values). With the default,
`findOneBy({id: undefined})` finds the first row: check the values taken from the requests before querying with them.

A database created with TypeORM 0.3 whose table or column names have characters outside ASCII: TypeORM 1 names their
indices and constraints differently, and the migrations generated rename them. The `NamingStrategyV03` of
`lakutata/orm` (`namingStrategy: new NamingStrategyV03()`) keeps the names of TypeORM 0.3.

### Entities

The decorators of `lakutata/decorator/orm` are the TypeORM decorators: `@Entity`, `@ViewEntity`, the columns
(`@Column`, `@PrimaryColumn`, `@PrimaryGeneratedColumn`, `@CreateDateColumn`, `@UpdateDateColumn`,
`@DeleteDateColumn`, `@VersionColumn`, `@VirtualColumn`, `@ViewColumn`, `@ObjectIdColumn`, `@Generated`), the
relations (`@OneToOne`, `@OneToMany`, `@ManyToOne`, `@ManyToMany`, `@JoinColumn`, `@JoinTable`, `@RelationId`), the
constraints (`@Index`, `@Unique`, `@Check`, `@Exclusion`), the trees (`@Tree`, `@TreeParent`, `@TreeChildren`,
`@TreeLevelColumn`), the inheritance (`@TableInheritance`, `@ChildEntity`), the entity listeners (`@BeforeInsert`,
`@AfterLoad`…) and `@EventSubscriber`.

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

    //pg reads the numeric columns back as strings: the transformer converts them
    @Column('numeric', {precision: 12, scale: 2, transformer: {to: (value: number): number => value, from: (value: string): number => Number(value)}})
    public total: number

    @Column('jsonb', {nullable: true})
    public metadata: Record<string, unknown> | null

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
`user.save()`): they use the last connection which registered the entity.

### Queries

`lakutata/orm` exports the TypeORM API: the repositories, the find operators (`In`, `ILike`, `Between`, `MoreThan`,
`IsNull`, `Not`, `Raw`, `ArrayContains`, `JsonContains`…), the query builders, the entity manager and the errors.
The find options take objects: `relations: {author: true}`, `select: {id: true, title: true}` (TypeORM 1 removed
the arrays of names).

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Database} from 'lakutata/com/database'
import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'
import {Between, ILike, In, type Repository} from 'lakutata/orm'

@Entity('orders')
class Order {
    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public customer: string

    @Column()
    public status: string

    @Column('integer')
    public total: number

    @Column({type: 'timestamptz'})
    public createdAt: Date
}

class Orders extends Component {
    @Inject('db')
    protected readonly db: Database

    protected get orders(): Repository<Order> {
        return this.db.getRepository(Order)
    }

    //A page of the orders of a period, and their count
    public async search(customer: string, from: Date, to: Date, page: number): Promise<[Order[], number]> {
        return await this.orders.findAndCount({
            where: {customer: ILike(`%${customer}%`), status: In(['paid', 'shipped']), createdAt: Between(from, to)},
            order: {createdAt: 'DESC'},
            skip: (page - 1) * 20,
            take: 20
        })
    }

    //A query builder for the aggregations
    public async totals(): Promise<{ customer: string, total: string }[]> {
        return await this.db.createQueryBuilder(Order, 'order')
            .select('order.customer', 'customer')
            .addSelect('SUM(order.total)', 'total')
            .groupBy('order.customer')
            .getRawMany()
    }

    //Raw SQL: the PostgreSQL placeholders are $1, $2…
    public async count(status: string): Promise<number> {
        const rows: { count: string }[] = await this.db.query('SELECT COUNT(*) AS count FROM orders WHERE status = $1', [status])
        return Number(rows[0].count)
    }
}
```

### Transactions

`transaction()` runs a function in a transaction: committed when it resolves, rolled back when it rejects (its error
rethrown). The operations of the transaction go through the entity manager given to the function; the ones made
through `db.manager` or `db.getRepository()` run outside of it. A query runner controls a transaction by hand.

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Database} from 'lakutata/com/database'
import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'
import {type EntityManager, type QueryRunner} from 'lakutata/orm'

@Entity('accounts')
class Account {
    @PrimaryGeneratedColumn()
    public id: number

    @Column('integer', {default: 0})
    public balance: number
}

class Bank extends Component {
    @Inject('db')
    protected readonly db: Database

    //Both updates, or none
    public async transfer(from: number, to: number, amount: number): Promise<void> {
        await this.db.transaction('SERIALIZABLE', async (manager: EntityManager): Promise<void> => {
            const source: Account = await manager.findOneByOrFail(Account, {id: from})
            if (source.balance < amount) throw new Error('Insufficient balance')
            await manager.decrement(Account, {id: from}, 'balance', amount)
            await manager.increment(Account, {id: to}, 'balance', amount)
        })
    }

    //The same transaction, by hand
    public async deposit(id: number, amount: number): Promise<void> {
        const runner: QueryRunner = this.db.createQueryRunner()
        await runner.connect()
        await runner.startTransaction()
        try {
            await runner.manager.increment(Account, {id: id}, 'balance', amount)
            await runner.commitTransaction()
        } catch (error) {
            await runner.rollbackTransaction()
            throw error
        } finally {
            //The connection goes back to the pool
            await runner.release()
        }
    }
}
```

### The Database provider

The provider of `lakutata/provider/database` has the API of the component, but it is transient: each resolution
(`@Inject`, `getObject()`) creates a new instance, which opens its own connection pool and closes it when it is
destroyed with the object or the container which created it. It suits a short use (a job, a script, a tenant
database); the requests of an application share the component. Its `entities` option is added to the entities of its
connection options.

```typescript
import {Application} from 'lakutata'
import {buildDatabaseOptions, Database} from 'lakutata/provider/database'
import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

@Entity('reports')
class Report {
    @PrimaryGeneratedColumn()
    public id: number

    @Column('text')
    public content: string
}

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
        const database: Database = await app.getObject('reports')
        console.log(await database.getRepository(Report).count())
    })
```

### Several databases

Each database is a component of its own name, injected by it. The migration commands act on all of them, or on the one
`MIGRATION_DATABASE` names.

```text
components: {
    db: buildDatabaseOptions({type: 'postgres', url: process.env.DATABASE_URL, entities: [User, Order]}),
    analytics: buildDatabaseOptions({type: 'postgres', url: process.env.ANALYTICS_URL, entities: [Event]})
}
```

### Migrations

A migration is a class implementing `MigrationInterface`: its `up()` changes the schema, its `down()` reverts the
change. The `migrations` connection option lists them (classes, or glob paths of their compiled files); the
`migrations` table records the ones run.

```typescript
import {type MigrationInterface, type QueryRunner} from 'lakutata/orm'

export class Migrations1760000000000 implements MigrationInterface {
    public name: string = 'Migrations1760000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "users" ADD "name" character varying')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "users" DROP COLUMN "name"')
    }
}
```

The migrations run when the database connects with `migrationsRun: true`, by `runMigrations()` and
`undoLastMigration()` of the `Database` component or provider, or by the commands of the application.

The commands are environment variables given to the application itself (no separate CLI): started with one of them,
the application reads its options, then, instead of its `bootstrap` and its `onLaunched` handler, it does the command
on each `Database` component and provider of its options, and exits. Each database connects with `synchronize`,
`migrationsRun` and `dropSchema` forced to `false`. The names of the variables are read in any case; the flags are
`1`, `true` or `yes`.

| Variable | Command |
|---|---|
| `MIGRATION_GENERATE=<directory>` | Compare the entities with the schema of the database, and write the SQL of the differences as a migration: `<directory>/<timestamp>-<database name>.ts` (the directory relative to the working directory, created if needed), its class `<Directory><timestamp>` (`Migrations1760000000000` for `src/migrations`), importing its types from `@lakutata/orm` when the project depends on it, from `lakutata/orm` otherwise |
| `MIGRATION_RUN=1` | Run the pending migrations, printing each one run |
| `MIGRATION_REVERT=1` | Revert the last migration run (`MIGRATION_DATABASE` required when the application has several databases) |
| `MIGRATION_SHOW=1` | Print each migration as `[X]` (run) or `[ ]` (pending), and the number pending |
| `MIGRATION_DATABASE=<name>` | The database of the command: the name of its component or provider (all of them by default) |
| `MIGRATION_TRANSACTION=all\|each\|none` | The transactions of `MIGRATION_RUN` and `MIGRATION_REVERT` (default: the `migrationsTransactionMode` option of the database, else `all`) |
| `MIGRATION_FAKE=1` | Record the migrations as run (or reverted) without running them |

When several are set, `MIGRATION_GENERATE` comes first, then `MIGRATION_RUN`, `MIGRATION_REVERT` and `MIGRATION_SHOW`.

```shell
# Generate from the compiled application: the database reachable and up to date with the migrations run
MIGRATION_GENERATE=src/migrations node dist/App.js
# Compile the migration, then
MIGRATION_SHOW=1 node dist/App.js
MIGRATION_RUN=1 node dist/App.js
MIGRATION_REVERT=1 MIGRATION_DATABASE=db node dist/App.js
```

The generated file is written in TypeORM's style (double quotes, semicolons): format it or exclude the migrations from
the linter. The process exits with the code 0 once the command is done, and 1 when it fails: an invalid
`MIGRATION_TRANSACTION`, an unknown `MIGRATION_DATABASE`, no database (but for `MIGRATION_GENERATE`, which exits with
0), `MIGRATION_REVERT` on several databases, a database which does not connect, a migration which fails (the databases
after it are skipped), or `MIGRATION_GENERATE` finding no change in any database.

The entities of a database are the ones of its connection options, and for a `Database` provider the ones of its
`entities` option as well.

## API

| Export | Subpath | What it is |
|---|---|---|
| `Database`, `buildDatabaseOptions` | `lakutata/com/database` | The database component (a shared connection) and its registration |
| `Database`, `buildDatabaseOptions` | `lakutata/provider/database` | The database provider (a connection per resolution) and its registration |
| `MigrationRunOptions` | `lakutata/com/database`, `lakutata/provider/database` | The options of `runMigrations()` and `undoLastMigration()` |
| `Entity`, `Column`, `PrimaryGeneratedColumn`, `OneToMany`, `ManyToOne`, `Index`, `BeforeInsert`… | `lakutata/decorator/orm` | The TypeORM decorators |
| `Repository`, `EntityManager`, `QueryRunner`, `SelectQueryBuilder`, `DataSource`, `BaseEntity`… | `lakutata/orm` | The TypeORM classes and types |
| `In`, `ILike`, `Between`, `MoreThan`, `IsNull`, `Not`, `Raw`… | `lakutata/orm` | The TypeORM find operators |
| `MigrationInterface`, `Migration`, `MigrationExecutor` | `lakutata/orm` | The migrations |
| `DataSourceOptions`, `PostgresDataSourceOptions`, `MysqlDataSourceOptions`… | `lakutata/orm` | The connection options of each driver (their names of TypeORM 0.3, `PostgresConnectionOptions`…, deprecated) |
| `QueryFailedError`, `EntityNotFoundError`, `TypeORMError`… | `lakutata/orm` | The TypeORM errors |

The typings document the declarations of lakutata with examples; the TypeORM ones are documented by
[TypeORM](https://typeorm.io).

## Errors

The package throws the TypeORM errors, exported by `lakutata/orm`:

| Error | Thrown when |
|---|---|
| The driver error (`pg`'s `DatabaseError`, `ECONNREFUSED`…) | The `Database` component or provider cannot connect: its creation rejects, and the launch of the application fails when the component is in `bootstrap` |
| `QueryFailedError` | The database rejects a query (a constraint violated, a syntax error); its `driverError` holds the driver error (`code` `23505` for a PostgreSQL unique violation) |
| `EntityNotFoundError` | `findOneOrFail()`, `findOneByOrFail()` find no entity |
| `EntityMetadataNotFoundError` | An entity is not in the `entities` of the connection |
| `OptimisticLockVersionMismatchError` | A find with `lock: {mode: 'optimistic', version}` reads another version |
| `CannotExecuteNotConnectedError` | `synchronize()` or the migrations run on a closed connection |
| `TypeORMError` | The base of the TypeORM errors (a MongoDB method on another database, a relation not found…) |

## See also

- The guide: `doc/en/ORMIntegration.md` of the package `lakutata` (Chinese in `doc/zh`).
- The TypeORM documentation: [typeorm.io](https://typeorm.io) (the entities, the relations, the find options, the
  query builder, the migrations).
- `@lakutata/core`: the application, the components and providers, the dependency injection.

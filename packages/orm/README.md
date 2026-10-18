# @lakutata/orm

English | [中文](README.zh-CN.md)

The ORM of the lakutata framework, built on [TypeORM](https://typeorm.io) 1. It provides the `Database` component (a
connection shared by the application), the `Database` provider (a connection of its own), the entity decorators, the
TypeORM API (repositories, find operators, query builders, migrations), and the migration commands of an application
(`MIGRATION_GENERATE`, `MIGRATION_RUN`, `MIGRATION_REVERT`, `MIGRATION_SHOW`).

The umbrella package `lakutata` re-exports it: `lakutata/com/database` (the component), `lakutata/provider/database`
(the provider), `lakutata/decorator/orm` (the entity decorators) and `lakutata/orm` (the TypeORM API).

## Installation

```shell
npm install lakutata pg        # the framework, and the PostgreSQL driver
npm install @lakutata/orm      # or the ORM only, with @lakutata/core
```

The source of TypeORM 1.1.2 (MIT) is part of the package (see `THIRD_PARTY_NOTICES.md`), so no `typeorm` package is
installed, and libraries built on the `typeorm` package (its NestJS module, naming strategy libraries…) do not use this
copy. The database driver is not a dependency: install the driver for the `type` of your connection options.

| Database | `type` | Install |
|---|---|---|
| PostgreSQL, CockroachDB | `postgres`, `cockroachdb` | `pg` |
| MySQL, MariaDB | `mysql`, `mariadb` | `mysql2` (3.15.3 or later) |
| SQLite | `better-sqlite3` | `better-sqlite3` (12) |
| SQLite in WebAssembly | `sqljs` | `sql.js` |
| Microsoft SQL Server | `mssql` | `mssql` (12) |
| Oracle | `oracle` | `oracledb` |
| MongoDB | `mongodb` | `mongodb` (7) |
| MongoDB embedded in the process | `mongo-embedded` | `mingo` and `bson` (7) |
| SAP HANA | `sap` | `@sap/hana-client` |
| Google Cloud Spanner | `spanner` | `@google-cloud/spanner` (8) |

The `sqljs` driver holds the whole database in memory. With the `location` option, it loads the database from that file
when it connects, and writes it back after each change with `autoSave: true`, or when `saveDatabase()` of its entity
manager (`SqljsEntityManager`) is called; `exportDatabase()` returns the database as a `Uint8Array`.

`mongo-embedded`, added by lakutata, is the MongoDB support of TypeORM (entities with an `@ObjectIdColumn`, the MongoDB
operators in find options, the `MongoRepository`) running on a database inside the process. Its documents are written
to files in the directory given by the `database` option (created when missing; `':memory:'`, the default, keeps them
in memory). Each write is appended to a file in a single operation, documents are found by their `_id` through an
index held in memory outside the V8 heap, and mingo runs the queries with the semantics of MongoDB.

The `sync` option sets when writes are flushed to disk: `'interval'` (the default) flushes every `syncInterval`
(100 ms), so a write survives a crash of the process but the last interval may be lost on a power failure; the other
values are `'always'` and `'never'`. Documents that have been read are cached in memory (`cacheSize`, 64 MiB by
default): scanning a collection whose documents are all cached reads none of its files. A write cut short by a crash
leaves the database as it was before that write.

The file of a collection is compacted while reads and writes go on (the `compaction` option: from 16 MiB, once the file
is twice the size of its live documents). The indexes of a collection are saved to a snapshot when the database is
closed, and also while it is in use (the `snapshot` option: once 64 MiB and a quarter of the file have been written
since the last snapshot). Opening the database again reads the snapshot, so after a crash only the records written
after the snapshot are read. Only one process can open the directory, which it locks.

The database runs in a worker thread (the `worker` option, `true` by default), so its queries, writes and file
operations do not block the event loop of the application. Arguments and results cross between the threads as BSON
(about 20 µs per call); the worker thread runs its own copies of mingo and bson, bundled into the package. Its limits
(`workerResourceLimits`, the `resourceLimits` of Node.js) are unset by default, so it has the limits of the
application's thread (`--max-old-space-size`). Exceeding them ends the worker thread, not the process: its calls fail
and its directory is unlocked (on Node.js 24, a heap of 256 MB or less may end the process; Bun does not apply the
limits). `worker: false` runs the database in the application's thread, where queries can also use JavaScript functions
(`$where`, `$function`, `$accumulator`).

Long writes (`insertMany`, `updateMany`, `deleteMany`, building an index on existing documents) run in batches of 1000
documents, yielding to the event loop between batches. A write that fails on a document leaves the documents before it
written, as MongoDB does without a transaction. As in MongoDB, `insertMany` stops at its first duplicate key, or
inserts the other documents with `ordered: false`, and then fails with the `writeErrors`, the `insertedCount` and the
`insertedIds` of its documents.

A `$group` (or a `$count` stage) at the start of a pipeline, with only stages that work on one document at a time
before it (`$match`, `$project`, `$unwind`...), processes a batch of documents at a time, so it holds only its groups
in memory. A cursor read with `next()`, `hasNext()` or `for await` (`createCursor` and `createEntityCursor` of the
`MongoRepository`) reads 1000 documents at a time when it has no sort order (and no limit of 1000 or less); `toArray()`
reads them all at once. As with MongoDB, documents written while a cursor is reading may be missed (updated or deleted
before it reads them, or inserted) or read twice (while the collection is compacted). A compaction of the collection
does not start while a cursor is reading it (or while one of its indexes is being built), and a compaction already
running finishes once the cursors reading its files end. A cursor left unread for 10 minutes no longer holds a
compaction back: the compaction closes it, and its next read fails (in the worker thread, such a cursor is closed after
10 minutes in any case).

A sort without an index holds all the documents it sorts in memory, even with a `limit` after it: index the fields that
large collections are sorted on. A sort with a `limit` on an indexed field reads the order of the index; otherwise mingo
sorts in memory, placing the integers beyond 2^53 (kept as `Long`) after the other numbers, in the order of their text.
An index key holds about 1000 bytes at most (its values are encoded with the `_id`: with an `ObjectId` as `_id`, a
string of 995 bytes at most). A write that would create a larger key fails before it is written, with the code 17280
that MongoDB used before 4.2 (in an `insertMany`, as an error of that document).

As with the `mongodb` type, TypeORM's relations, query builders and transactions are not supported (`transaction()`
runs its function without a transaction), and migrations are written by hand (through `queryRunner.manager`, a
`MongoEntityManager`), not generated. The `ObjectId` and `Binary` values are those of the CommonJS module of `bson`.
`import {ObjectId} from 'lakutata/orm'` gives the class of the ids of the entities, and their type for the
`@ObjectIdColumn()` properties. The `ObjectId` of `import {ObjectId} from 'bson'` in an ES module is a different class:
`instanceof` is false for the ids, though the queries accept both.

A query result cache in Redis (`cache: {type: 'redis'}` or `'ioredis'`) needs the `redis` or `ioredis` package.

Entities rely on decorators and their metadata: the TypeScript options for applications
(`"extends": "lakutata/tsconfig.json"`) enable `experimentalDecorators` and `emitDecoratorMetadata`.

## Usage

### A database in an application

`buildDatabaseOptions` registers a `Database` component with TypeORM connection options (`DataSourceOptions`, passed
to TypeORM unchanged). The component connects when it is created, which happens while the application launches when it
is listed in `bootstrap`, and it disconnects when the application stops. A connection failure stops the launch of the
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

The common connection options (the TypeORM documentation describes the options of each driver):

| Option | What it sets |
|---|---|
| `type` | The driver: `'postgres'`, `'mysql'`, `'better-sqlite3'`… |
| `url` or `host`, `port`, `username`, `password`, `database` | The server and the database |
| `schema` | The PostgreSQL schema of the tables (by default the `search_path` of the server, usually `public`) |
| `entities` | The entity classes, `EntitySchema`s, or glob paths of their compiled files (`'build/entities/*.js'`) |
| `synchronize` | Update the schema from the entities on each connection (default `false`): development only |
| `migrations`, `migrationsTableName`, `migrationsRun`, `migrationsTransactionMode` | The migrations, their table (default `migrations`), whether they run on each connection (default `false`), their transactions (default `'all'`) |
| `logging`, `logger` | What TypeORM logs (`true`, `['error', 'schema']`…) and where |
| `poolSize`, `extra` | The connection pool size; the options passed to the driver (`extra: {max: 20}` for `pg`) |
| `subscribers`, `namingStrategy`, `cache` | The entity subscribers, the naming of the tables and columns, the query result cache |

The framework changes the default of one option: `invalidWhereValuesBehavior` is
`{null: 'ignore', undefined: 'ignore'}`, the behavior of TypeORM 0.3 (TypeORM 1 throws by default). A property of a
where condition whose value is `null` or `undefined` is left out of the condition. Each key you give replaces its
default (`invalidWhereValuesBehavior: {undefined: 'throw'}` throws on `undefined` values). With the default,
`findOneBy({id: undefined})` finds the first row, so check the values taken from requests before querying with them.

If a database created with TypeORM 0.3 has table or column names with non-ASCII characters, TypeORM 1 names their
indices and constraints differently, and generated migrations would rename them. `NamingStrategyV03` from
`lakutata/orm` (`namingStrategy: new NamingStrategyV03()`) keeps the names of TypeORM 0.3.

### Entities

The decorators in `lakutata/decorator/orm` are those of TypeORM: `@Entity`, `@ViewEntity`, the columns (`@Column`,
`@PrimaryColumn`, `@PrimaryGeneratedColumn`, `@CreateDateColumn`, `@UpdateDateColumn`, `@DeleteDateColumn`,
`@VersionColumn`, `@VirtualColumn`, `@ViewColumn`, `@ObjectIdColumn`, `@Generated`), the relations (`@OneToOne`,
`@OneToMany`, `@ManyToOne`, `@ManyToMany`, `@JoinColumn`, `@JoinTable`, `@RelationId`), the constraints (`@Index`,
`@Unique`, `@Check`, `@Exclusion`), the trees (`@Tree`, `@TreeParent`, `@TreeChildren`, `@TreeLevelColumn`),
inheritance (`@TableInheritance`, `@ChildEntity`), the entity listeners (`@BeforeInsert`, `@AfterLoad`…) and
`@EventSubscriber`.

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

An entity may also extend `BaseEntity` (from `lakutata/orm`) for active record operations (`User.findOneBy()`,
`user.save()`); they use the last connection that registered the entity.

### Queries

`lakutata/orm` exports the TypeORM API: the repositories, the find operators (`In`, `ILike`, `Between`, `MoreThan`,
`IsNull`, `Not`, `Raw`, `ArrayContains`, `JsonContains`…), the query builders, the entity manager and the errors.
Find options take objects: `relations: {author: true}`, `select: {id: true, title: true}` (TypeORM 1 removed the
arrays of names).

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

`transaction()` runs a function in a transaction, which is committed when the function resolves and rolled back when
it rejects (the error is rethrown). The operations of the transaction go through the entity manager passed to the
function; those made through `db.manager` or `db.getRepository()` run outside it. A query runner controls a transaction
by hand.

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

The provider from `lakutata/provider/database` has the same API as the component, but it is transient: each
resolution (`@Inject`, `getObject()`) creates a new instance, which opens its own connection pool and closes it when
the instance is destroyed along with the object or container that created it. It suits short-lived work (a job, a
script, a tenant database), while the requests of an application share the component. Its `entities` option is added
to the entities of its connection options.

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

Each database is a component with its own name, injected by that name. The migration commands act on all of them, or
on the one named by `MIGRATION_DATABASE`.

```text
components: {
    db: buildDatabaseOptions({type: 'postgres', url: process.env.DATABASE_URL, entities: [User, Order]}),
    analytics: buildDatabaseOptions({type: 'postgres', url: process.env.ANALYTICS_URL, entities: [Event]})
}
```

### Migrations

A migration is a class implementing `MigrationInterface`: its `up()` changes the schema, and its `down()` reverts the
change. The `migrations` connection option lists the migrations (classes, or glob paths of their compiled files), and
the `migrations` table records those that have run.

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

Migrations run when the database connects with `migrationsRun: true`, through `runMigrations()` and
`undoLastMigration()` of the `Database` component or provider, or through the commands of the application.

The commands are environment variables read by the application itself; `lakutata migration` (from `@lakutata/cli`)
starts the application with them. When started with one of them, the application reads its options and then, instead
of running its `bootstrap` and its `onLaunched` handler, runs the command on each `Database` component and provider of
its options, and exits. Each database connects with `synchronize`, `migrationsRun` and `dropSchema` forced to `false`.
The names of the variables are case-insensitive, and a flag is set by `1`, `true` or `yes`.

| Variable | Command |
|---|---|
| `MIGRATION_GENERATE=<directory>` | Compare the entities with the schema of the database, and write the SQL of the differences as a migration: `<directory>/<timestamp>-<database name>.ts` (the directory is relative to the working directory and created if needed), with the class `<Directory><timestamp>` (`Migrations1760000000000` for `src/migrations`), which imports its types from `@lakutata/orm` when the project depends on it, else from `lakutata/orm` |
| `MIGRATION_RUN=1` | Run the pending migrations, printing each one as it runs |
| `MIGRATION_REVERT=1` | Revert the last migration run (`MIGRATION_DATABASE` required when the application has several databases) |
| `MIGRATION_SHOW=1` | Print each migration as `[X]` (run) or `[ ]` (pending), and the number pending |
| `MIGRATION_DATABASE=<name>` | The database of the command: the name of its component or provider (all of them by default) |
| `MIGRATION_TRANSACTION=all\|each\|none` | The transactions of `MIGRATION_RUN` and `MIGRATION_REVERT` (default: the `migrationsTransactionMode` option of the database, else `all`) |
| `MIGRATION_FAKE=1` | Record the migrations as run (or reverted) without running them |

When several are set, only one command runs: `MIGRATION_GENERATE` takes precedence, then `MIGRATION_RUN`,
`MIGRATION_REVERT` and `MIGRATION_SHOW`.

```shell
# Generate from the compiled application (the database must be reachable, with the existing migrations run)
MIGRATION_GENERATE=src/migrations node build/App.js
# Compile the migration, then
MIGRATION_SHOW=1 node build/App.js
MIGRATION_RUN=1 node build/App.js
MIGRATION_REVERT=1 MIGRATION_DATABASE=db node build/App.js
```

The generated file follows TypeORM's style (double quotes, semicolons): format it, or exclude the migrations from the
linter. The process exits with code 0 once the command is done, and with code 1 when it fails: an invalid
`MIGRATION_TRANSACTION`, an unknown `MIGRATION_DATABASE`, no database (except with `MIGRATION_GENERATE`, which then
exits with 0), `MIGRATION_REVERT` with several databases and no `MIGRATION_DATABASE`, a database that does not connect,
a migration that fails (the databases after it are skipped), or `MIGRATION_GENERATE` finding no change in any database.

The entities of a database are those of its connection options, plus, for a `Database` provider, those of its
`entities` option.

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
| `DataSourceOptions`, `PostgresDataSourceOptions`, `MysqlDataSourceOptions`… | `lakutata/orm` | The connection options of each driver (their TypeORM 0.3 names, `PostgresConnectionOptions`…, are deprecated) |
| `QueryFailedError`, `EntityNotFoundError`, `TypeORMError`… | `lakutata/orm` | The TypeORM errors |

The typings document the declarations of lakutata, with examples; the TypeORM declarations are documented by
[TypeORM](https://typeorm.io).

## Errors

The package throws the errors of the drivers and the TypeORM errors, which `lakutata/orm` exports:

| Error | Thrown when |
|---|---|
| The driver error (`pg`'s `DatabaseError`, `ECONNREFUSED`…) | The `Database` component or provider cannot connect: its creation rejects, and the application fails to launch when the component is in `bootstrap` |
| `QueryFailedError` | The database rejects a query (a constraint violation, a syntax error); its `driverError` holds the driver error (`code` `23505` for a PostgreSQL unique violation) |
| `EntityNotFoundError` | `findOneOrFail()`, `findOneByOrFail()` find no entity |
| `EntityMetadataNotFoundError` | An entity is not in the `entities` of the connection |
| `OptimisticLockVersionMismatchError` | A find with `lock: {mode: 'optimistic', version}` reads another version |
| `CannotExecuteNotConnectedError` | `synchronize()` or the migrations run on a closed connection |
| `TypeORMError` | The base class of the TypeORM errors, also thrown on its own (a MongoDB method called on another database, a relation not found…) |

## See also

- The guides on the website: [Databases](https://lakutata.com/guide/Database),
  [Entities, Queries and Transactions](https://lakutata.com/guide/Entities) and
  [Migrations](https://lakutata.com/guide/Migrations).
- The guides in the `lakutata` package (`doc/en`, with Chinese in `doc/zh`): `Database.md`, `DatabaseDrivers.md`,
  `MongoEmbedded.md`, `Entities.md`, `Migrations.md`.
- The TypeORM documentation: [typeorm.io](https://typeorm.io) (entities, relations, find options, the query builder,
  migrations).
- `@lakutata/core`: the application, components and providers, dependency injection.

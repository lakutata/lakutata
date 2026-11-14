# Lakutata Databases

Lakutata's database layer, the package `@lakutata/orm`, is built on [TypeORM](https://typeorm.io) 1. TypeORM's source is
part of the package, so no `typeorm` package is installed. `lakutata` re-exports it under four subpaths:

| Subpath | What it provides |
|---|---|
| `lakutata/com/database` | The `Database` component, a connection shared by the application, and `buildDatabaseOptions` |
| `lakutata/provider/database` | The `Database` provider, a new connection each time it is resolved |
| `lakutata/decorator/orm` | Entity decorators (`@Entity`, `@Column`, relations…) |
| `lakutata/orm` | TypeORM's API: repositories, entity manager, find operators, migrations, errors |

The database driver is installed separately: see [Database Drivers](DatabaseDrivers.md). Entities, queries and
transactions are described in [Entities, Queries and Transactions](Entities.md), and schema changes in
[Migrations](Migrations.md).

## 1. The Database component

`buildDatabaseOptions` declares a `Database` component with TypeORM's connection options:

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
    //The component declared as "db"
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
                //Development only: the tables follow the entities. In production, use migrations
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

- The component connects when it is created. When it is listed in `bootstrap`, it connects while the application
  launches, and the launch fails if the connection fails. Otherwise, it connects the first time an object needs it.
- It disconnects when the application stops.
- Other objects inject it by its name (`@Inject('db')`), or obtain it with `getObject('db')`.

## 2. The connection options

The options are TypeORM's own, passed to it unchanged. Each driver's options are listed in
[Database Drivers](DatabaseDrivers.md); the common ones are:

| Option | Default | Meaning |
|---|---|---|
| `type` | Required | The driver: `'postgres'`, `'mysql'`, `'better-sqlite3'`… |
| `entities` | | The entity classes, `EntitySchema`s, or globs of their compiled files (`'build/entities/*.js'`) |
| `synchronize` | `false` | Update the tables from the entities each time the database connects. For development only |
| `logging` | `false` | What TypeORM logs: `true`, or a list among `'query'`, `'error'`, `'schema'`, `'warn'`, `'info'`, `'log'` |
| `logger` | | Where TypeORM logs: `'advanced-console'`, `'simple-console'`, `'file'`, `'debug'`, or a custom logger |
| `maxQueryExecutionTime` | | Log queries slower than this, in milliseconds |
| `poolSize` | | The maximum number of connections in the pool |
| `extra` | | Options passed to the driver's client |
| `migrations`, `migrationsRun`, `migrationsTableName`, `migrationsTransactionMode` | | The migrations (see [Migrations](Migrations.md)) |
| `subscribers` | | The entity subscribers |
| `namingStrategy` | | How tables, columns and indices are named |
| `cache` | | The query result cache: `true` (in a database table), or `{type: 'redis', options}` |
| `invalidWhereValuesBehavior` | `{null: 'ignore', undefined: 'ignore'}` | What `null` and `undefined` do in a where condition (below) |

**`null` and `undefined` in conditions.** By default, a property in a where condition whose value is `null` or
`undefined` is left out of the condition, as in TypeORM 0.3; TypeORM 1 throws instead. Therefore,
`findOneBy({id: undefined})` finds the table's first row: check values taken from a request before querying with them,
or set `invalidWhereValuesBehavior: {undefined: 'throw'}` to throw on them (each key specified replaces its default).

**Paths with aliases.** A path that uses an application alias (`@data/app.sqlite`, `@app/migrations/*.js`) is resolved
when the database connects: the database file (`database`, and `location` for sql.js) and the entity, migration and
subscriber globs. Aliases are declared by `.alias()` ([Application](Application.md), section 2).

**Databases created with TypeORM 0.3.** If a table or column name contains non-ASCII characters, TypeORM 1 names its
indices and constraints differently, and generated migrations would rename them.
`namingStrategy: new NamingStrategyV03()` (from `lakutata/orm`) keeps the TypeORM 0.3 names.

**A Redis query cache** (`cache: {type: 'redis'}` or `'ioredis'`) requires the `redis` or `ioredis` package.

## 3. What the component provides

The component exposes the TypeORM data source API:

| Method or property | What it does |
|---|---|
| `getRepository(Entity)` | An entity's repository (a `MongoRepository` on MongoDB) |
| `getMongoRepository(Entity)`, `getTreeRepository(Entity)` | A MongoDB repository; a tree entity's repository |
| `manager` | The entity manager |
| `transaction(fn)`, `transaction(isolationLevel, fn)` | Run a function in a transaction |
| `query(sql, parameters)` | Run SQL; placeholders are `$1, $2…` on PostgreSQL, `?` on MySQL and SQLite |
| `createQueryBuilder(Entity, alias)` | A query builder |
| `createQueryRunner(mode)` | A connection from the pool, to control a transaction manually; `'slave'` reads from a replica |
| `synchronize()` | Update the tables from the entities |
| `runMigrations()`, `undoLastMigration()`, `showMigrations()` | Run, revert and list the migrations |
| `hasMetadata(Entity)`, `getMetadata(Entity)` | Whether an entity is known, and its metadata |

## 4. The Database provider

The `Database` from `lakutata/provider/database` has the same API, but it is **transient**: each time it is resolved
(`@Inject`, `getObject()`), a new instance opens its own connection pool, and closes it when it is destroyed with the
object or container that created it. It suits a short task (a job, a script, a database per customer), while an
application's requests share the component.

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
                //Added to the entities of the connection options
                entities: [Report]
            }
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        //A connection opened here, and closed with the application
        const database: Database = await app.getObject<Database>('reports')
        console.log(await database.getRepository(Report).count())
    })
```

## 5. Several databases

Each database is a separate component, injected by its name:

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

An entity can belong to several databases. Its repository comes from whichever database `getRepository()` is called on.

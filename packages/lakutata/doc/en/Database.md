# Lakutata Databases

The database layer of lakutata, the package `@lakutata/orm`, is built on [TypeORM](https://typeorm.io) 1. The source
of TypeORM is part of the package, so no package `typeorm` is installed. `lakutata` re-exports it under four subpaths:

| Subpath | What it provides |
|---|---|
| `lakutata/com/database` | The `Database` component, a connection shared by the application, and `buildDatabaseOptions` |
| `lakutata/provider/database` | The `Database` provider, a connection of its own each time it is resolved |
| `lakutata/decorator/orm` | The decorators of the entities (`@Entity`, `@Column`, the relations…) |
| `lakutata/orm` | The API of TypeORM: repositories, entity manager, find operators, migrations, errors |

The driver of the database is installed separately: see [DatabaseDrivers](DatabaseDrivers.md). The entities, the
queries and the transactions are described in [Entities](Entities.md), the changes of the schema in
[Migrations](Migrations.md).

## 1. The Database component

`buildDatabaseOptions` declares a `Database` component with the connection options of TypeORM:

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

- The component connects when it is created. Listed in `bootstrap`, it connects while the application launches, and a
  failed connection stops the launch. Otherwise it connects the first time an object needs it.
- It disconnects when the application stops.
- Other objects inject it by its name (`@Inject('db')`), or get it with `getObject('db')`.

## 2. The connection options

The options are the ones of TypeORM, given to it as they are. The options of each driver are in
[DatabaseDrivers](DatabaseDrivers.md); the common ones are:

| Option | Default | Meaning |
|---|---|---|
| `type` | Required | The driver: `'postgres'`, `'mysql'`, `'better-sqlite3'`… |
| `entities` | | The entity classes, `EntitySchema`s, or globs of their compiled files (`'build/entities/*.js'`) |
| `synchronize` | `false` | Update the tables from the entities each time the database connects. For development only |
| `logging` | `false` | What TypeORM logs: `true`, or a list among `'query'`, `'error'`, `'schema'`, `'warn'`, `'info'`, `'log'` |
| `logger` | | Where TypeORM logs: `'advanced-console'`, `'simple-console'`, `'file'`, `'debug'`, or a logger of your own |
| `maxQueryExecutionTime` | | Log the queries slower than this, in milliseconds |
| `poolSize` | | The connections of the pool |
| `extra` | | Options passed to the client of the driver |
| `migrations`, `migrationsRun`, `migrationsTableName`, `migrationsTransactionMode` | | The migrations (see [Migrations](Migrations.md)) |
| `subscribers` | | The entity subscribers |
| `namingStrategy` | | How tables, columns and indices are named |
| `cache` | | The cache of query results: `true` (in a table of the database), or `{type: 'redis', options}` |
| `invalidWhereValuesBehavior` | `{null: 'ignore', undefined: 'ignore'}` | What `null` and `undefined` do in a where condition (below) |

**`null` and `undefined` in the conditions.** By default, a property of a where condition whose value is `null` or
`undefined` is left out of the condition, as in TypeORM 0.3; TypeORM 1 throws instead. So `findOneBy({id: undefined})`
finds the first row of the table: check the values taken from a request before querying with them, or set
`invalidWhereValuesBehavior: {undefined: 'throw'}` to throw on them (each key given replaces its default).

**Databases created with TypeORM 0.3.** If a table or column name has characters outside ASCII, TypeORM 1 names its
indices and constraints differently, and generated migrations would rename them.
`namingStrategy: new NamingStrategyV03()` (from `lakutata/orm`) keeps the names of TypeORM 0.3.

**A Redis query cache** (`cache: {type: 'redis'}` or `'ioredis'`) needs the package `redis` or `ioredis`.

## 3. What the component provides

The component exposes the API of a TypeORM data source:

| Method or property | What it does |
|---|---|
| `getRepository(Entity)` | The repository of an entity (a `MongoRepository` on MongoDB) |
| `getMongoRepository(Entity)`, `getTreeRepository(Entity)` | The repository of MongoDB, of a tree entity |
| `manager` | The entity manager |
| `transaction(fn)`, `transaction(isolationLevel, fn)` | Run a function in a transaction |
| `query(sql, parameters)` | Run SQL; the placeholders are `$1, $2…` on PostgreSQL, `?` on MySQL and SQLite |
| `createQueryBuilder(Entity, alias)` | A query builder |
| `createQueryRunner(mode)` | A connection of the pool, to control a transaction by hand; `'slave'` reads from a replica |
| `synchronize()` | Update the tables from the entities |
| `runMigrations()`, `undoLastMigration()`, `showMigrations()` | Run, revert and list the migrations |
| `hasMetadata(Entity)`, `getMetadata(Entity)` | Whether an entity is known, and its metadata |

## 4. The Database provider

The `Database` of `lakutata/provider/database` has the same API, but it is **transient**: each time it is resolved
(`@Inject`, `getObject()`), a new instance opens its own pool of connections, and closes it when it is destroyed with
the object or the container that created it. It suits a short task (a job, a script, a database per customer), while
the requests of an application share the component.

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

Each database is a component of its own, injected by its name:

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

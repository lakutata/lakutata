# Lakutata Database Drivers

The `type` option of a database chooses its driver. The driver packages are not installed with `lakutata`: install the
one for your database alongside it.

| Database | `type` | Install |
|---|---|---|
| PostgreSQL | `postgres` | `pg` (8.5 or later) |
| CockroachDB | `cockroachdb` | `pg` |
| MySQL, MariaDB | `mysql`, `mariadb` | `mysql2` (3.15.3 or later) |
| SQLite | `better-sqlite3` | `better-sqlite3` (12) |
| SQLite in WebAssembly | `sqljs` | `sql.js` (1.4 or later) |
| Microsoft SQL Server | `mssql` | `mssql` (12) |
| Oracle | `oracle` | `oracledb` (6.3 or later, or 7) |
| MongoDB | `mongodb` | `mongodb` (7) |
| MongoDB embedded in the application | `mongo-embedded` | `mingo` (7.2 or later) and `bson` (7); see [MongoEmbedded](MongoEmbedded.md) |
| SAP HANA | `sap` | `@sap/hana-client` (2.14 or later) |
| Google Cloud Spanner | `spanner` | `@google-cloud/spanner` (8) |
| Amazon Aurora through the Data API | `aurora-mysql`, `aurora-postgres` | `typeorm-aurora-data-api-driver` (3) |

```bash
npm install lakutata pg
```

There is no `sqlite` type: SQLite files use `better-sqlite3`, or `sqljs` where a native module cannot run. TypeORM also
has drivers for the mobile platforms (`capacitor`, `cordova`, `expo`, `nativescript`, `react-native`); lakutata does
not target them.

## What applies to every driver

- The connection options go to TypeORM as they are, and TypeORM does not check them: a missing host or password
  is reported by the driver when the database connects.
- `extra` is passed to the client of the driver (its pool, its connection), after the other options: it reaches the
  settings that TypeORM has no option for.
- `driver` gives the driver module itself (`driver: require('pg')`), instead of letting lakutata load the package.
- Every example below declares a `Database` component. The options are the same for the `Database` provider (see
  [Database](Database.md)).

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
    //Or all of them at once: url: 'postgres://app:secret@localhost:5432/app'
    entities: []
})
```

| Option | Default | Meaning |
|---|---|---|
| `url` | | The connection URL, instead of the options below |
| `host`, `port`, `username`, `password`, `database` | | The server and the database; `password` can be a function, sync or async, to read a rotating secret |
| `ssl` | | `true`, or the TLS options of Node.js (`{ca, rejectUnauthorized}`) |
| `schema` | The `search_path` of the server (usually `public`) | The schema of the tables |
| `poolSize` | 10 (the default of `pg`) | The connections of the pool |
| `connectTimeoutMS` | No limit | The time allowed to connect |
| `applicationName` | | The name shown in the activity of the server |
| `uuidExtension` | `'uuid-ossp'` | The extension of the UUID columns: `'uuid-ossp'` or `'pgcrypto'` |
| `replication` | | `{master, slaves}`: the reads go to the replicas |

- **`bigint` and `numeric` columns come back as strings**, to keep their precision (`'9007199254740993'`, `'12.50'`).
  Convert them with a column `transformer` where a number is enough. `parseInt8: true` returns the `bigint` columns as
  numbers, but it changes this setting of `pg` for the whole process.
- With `pg-native` installed, the native client of `pg` is used. Streams (`stream()` of the query builders) need
  `pg-query-stream`.

**CockroachDB** uses the same driver with `type: 'cockroachdb'` and the same connection options. Its option
`timeTravelQueries` (whether the reads use follower reads) must be given; a transaction failing on a conflict is
retried 5 times (`maxTransactionRetries`).

## MySQL and MariaDB

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

| Option | Default | Meaning |
|---|---|---|
| `url`, `host`, `port`, `username`, `password` | | The server |
| `database` | | The database. Required, unless every entity names its own |
| `socketPath` | | A unix socket, instead of the host and the port |
| `ssl` | | The TLS options, or the name of a TLS profile |
| `charset` | `'UTF8_GENERAL_CI'` | The character set and collation: use `'utf8mb4'` for the full Unicode (emoji) |
| `timezone` | `'local'` | How the dates are read and written: `'local'`, `'Z'` or an offset (`'+08:00'`) |
| `poolSize` | 10 (the default of `mysql2`) | The connections of the pool |
| `connectTimeout`, `acquireTimeout` | `10000` | The time allowed to connect, and to get a connection of the pool |
| `replication` | | `{master, slaves}`: the reads go to the replicas |

- Use `type: 'mariadb'` for MariaDB: the options are the same. MariaDB has the `uuid` column type from 10.7.
- **`bigint` and `decimal` columns come back as strings**, as with PostgreSQL.
- A table has at most one auto-increment column. MySQL has no check constraint in TypeORM's schema synchronization.
- Only `mysql2` is supported: the old package `mysql` is not.

## SQLite: better-sqlite3

```typescript
import {buildDatabaseOptions} from 'lakutata/com/database'

export const db = buildDatabaseOptions({
    type: 'better-sqlite3',
    //A file (its directory is created), or ':memory:'
    database: 'data/app.sqlite',
    enableWAL: true,
    entities: []
})
```

| Option | Default | Meaning |
|---|---|---|
| `database` | Required | The file of the database, or `':memory:'` |
| `enableWAL` | `false` | The write-ahead log: the reads no longer wait for the writes |
| `timeout` | `5000` | How long a statement waits for a database locked by another connection, in milliseconds |
| `readonly`, `fileMustExist` | `false` | Open the file read-only; fail when it does not exist |
| `key` | | The encryption key, for a build of SQLite with SQLCipher |
| `prepareDatabase` | | `(db) => …`, called with the connection of better-sqlite3 once it is open: pragmas, functions |
| `nativeBinding` | | The path of the compiled module `better_sqlite3.node` |

- The foreign keys are enforced (`PRAGMA foreign_keys = ON`). There is one connection: `poolSize` is not supported.
- **`bigint` columns come back as numbers**: values beyond 2^53 lose precision. Keep such values in a text column.
- `better-sqlite3` is a native module, compiled for one version of Node.js. An Electron application needs the build of
  its Electron (`electron-rebuild`, or the prebuilt binaries of better-sqlite3 for Electron); Bun cannot load it (use
  `sqljs` there).

## SQLite: sql.js

`sql.js` is SQLite compiled to WebAssembly: no native module, so it runs the same in Node.js, Bun, Electron and the
browsers. The whole database is held in memory, and written to its file when it changes.

```typescript
import {buildDatabaseOptions} from 'lakutata/com/database'

export const db = buildDatabaseOptions({
    type: 'sqljs',
    //Loaded when the database connects (if it exists), written after each change
    location: 'data/app.sqlite',
    autoSave: true,
    entities: []
})
```

| Option | Default | Meaning |
|---|---|---|
| `location` | | The file to load and to save (in a browser, the key of `localStorage`) |
| `autoSave` | `false` | Save after each change. It needs `location` or `autoSaveCallback` |
| `autoSaveCallback` | | `(data: Uint8Array) => …`, called instead of writing `location` |
| `database` | | The content of a database to load (a `Uint8Array`), instead of `location` |
| `useLocalForage` | `false` | In a browser, save to IndexedDB (through `localforage`) instead of `localStorage` |
| `sqlJsConfig` | | The options of the initialization of sql.js (`locateFile` of its `.wasm` file) |

- Without `autoSave`, nothing is written to disk until `saveDatabase()` of the entity manager (`SqljsEntityManager`)
  is called. With `autoSave`, the changes of a transaction are saved once it is committed.
- The file is written as a whole at each save: sql.js suits small databases.
- As with better-sqlite3, the foreign keys are enforced and `bigint` columns come back as numbers.

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
        //A server with a self-signed certificate, as in development
        trustServerCertificate: true
    },
    entities: []
})
```

| Option | Default | Meaning |
|---|---|---|
| `url`, `host`, `port`, `username`, `password`, `database` | | The server and the database |
| `authentication` | | Another authentication than the user and password: `{type: 'ntlm', ...}`, `{type: 'azure-active-directory-default', ...}`… |
| `schema` | The default schema of the user | The schema of the tables |
| `options.encrypt` | `true` | Encrypt the connection |
| `options.trustServerCertificate` | `false` | Accept a certificate not signed by a trusted authority |
| `options.instanceName` | | A named instance |
| `pool` | | The pool of connections: `max`, `min`, `idleTimeoutMillis` (30000 by default)… (`poolSize` is not supported) |
| `connectionTimeout`, `requestTimeout` | `15000` | The time allowed to connect, and to run a query |

- Since `encrypt` is on, a server with a self-signed certificate (a local server, a container) refuses the connection
  unless `trustServerCertificate` is `true`.
- Transactions cannot be nested.

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

| Option | Default | Meaning |
|---|---|---|
| `host`, `port`, `username`, `password` | | The server |
| `serviceName` or `sid` | | The database service |
| `connectString` | Built from the options above | A connect string (`'localhost:1521/FREEPDB1'`, a TNS entry), instead of them |
| `thickMode` | `false` | The thick mode of `oracledb` (with the Oracle Client libraries): `true`, or `{libDir, configDir}` |
| `useUTC` | `false` | Read and write the dates in UTC |
| `poolSize` | | The connections of the pool |

- `oracledb` 6 and later run in thin mode by default, with no Oracle Client. Set `thickMode` for the features that
  need it.
- The tables are in the schema of the user. `useUTC` sets the time zone of the sessions of the whole process (the
  variable `ORA_SDTZ`).

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

| Option | Default | Meaning |
|---|---|---|
| `url` | | The connection URL |
| `host`, `port`, `username`, `password`, `database` | `127.0.0.1`, `27017` | The server, when there is no `url` |
| `authSource`, `replicaSet`, `tls`, `readPreference`, `writeConcern`… | | The options of the client of MongoDB |
| `poolSize` | | The largest number of connections (`maxPoolSize`) |

- An entity has an `@ObjectIdColumn()`, its `_id`. Its type is the `ObjectId` of `lakutata/orm`: an
  `import {ObjectId} from 'bson'` in an ES module is another class, whose instances are not the ids of the entities.
- `getRepository()` returns a `MongoRepository`, with the methods of MongoDB (`find` with the MongoDB operators,
  `aggregate`, `createCursor`…).
- TypeORM does not support for MongoDB: the query builders, `query()`, the relations and the cascades, the tree
  repositories, the streams. **`transaction()` runs its function without a transaction**: the writes of a failed
  function stay written.
- `synchronize` only creates the indices. The migrations are written by hand (see [Migrations](Migrations.md)).

## SAP HANA, Google Cloud Spanner and Amazon Aurora

These drivers come from TypeORM as they are:

- **SAP HANA** (`sap`): `host`, `port`, `username`, `password`, `database`, `schema`, `encrypt` with `key`, `cert`,
  `ca`, and `pool` (`maxConnectedOrPooled`, 10 by default).
- **Google Cloud Spanner** (`spanner`): `projectId`, `instanceId`, `databaseId`, and `credentials` (`client_email`,
  `private_key`) unless the credentials of the environment are used. The other options of its type, copied from
  MySQL, are not read.
- **Amazon Aurora through the Data API** (`aurora-mysql`, `aurora-postgres`): `region`, `secretArn`, `resourceArn` and
  `database` are required; the queries go through the HTTP API of AWS, not through a connection.

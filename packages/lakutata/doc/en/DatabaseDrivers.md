# Lakutata Database Drivers

A database's `type` option selects its driver. Driver packages are not installed with `lakutata`: install the one for
your database alongside it.

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
| MongoDB embedded in the application | `mongo-embedded` | `@lakutata/mongo-embedded`, compiled when installed (Python 3 and a C++17 compiler); see [Embedded MongoDB](MongoEmbedded.md) |
| SAP HANA | `sap` | `@sap/hana-client` (2.14 or later) |
| Google Cloud Spanner | `spanner` | `@google-cloud/spanner` (8) |
| Amazon Aurora through the Data API | `aurora-mysql`, `aurora-postgres` | `typeorm-aurora-data-api-driver` (3) |

```bash
npm install lakutata pg
```

There is no `sqlite` type: SQLite files use `better-sqlite3`, or `sqljs` where a native module cannot run. TypeORM also
has drivers for JavaScript on mobile platforms (`capacitor`, `cordova`, `expo`, `nativescript`, `react-native`);
Lakutata does not use them. Instead, a mobile application built from the `mobile-react` template runs the Lakutata
application in Node.js, with the drivers in this guide (see [The mobile applications](#the-mobile-applications)).

## What applies to every driver

- Connection options are passed to TypeORM unchanged, and TypeORM does not check them: the driver reports a missing host
  or password when the database connects.
- `extra` is passed to the driver's client (its pool, its connection), after the other options: it reaches settings
  that TypeORM has no option for.
- `driver` provides the driver module itself (`driver: require('pg')`), instead of letting Lakutata load the package.
- Every example below declares a `Database` component. The options are the same for the `Database` provider (see
  [Databases](Database.md)).

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
| `ssl` | | `true`, or Node.js TLS options (`{ca, rejectUnauthorized}`) |
| `schema` | The server's `search_path` (usually `public`) | The schema of the tables |
| `poolSize` | 10 (the `pg` default) | The maximum number of connections in the pool |
| `connectTimeoutMS` | No limit | The time allowed to connect |
| `applicationName` | | The name shown in the server's activity |
| `uuidExtension` | `'uuid-ossp'` | The extension for UUID columns: `'uuid-ossp'` or `'pgcrypto'` |
| `replication` | | `{master, slaves}`: reads go to the replicas |

- **`bigint` and `numeric` columns are returned as strings**, to keep their precision (`'9007199254740993'`,
  `'12.50'`). Convert them with a column `transformer` where a number is enough. `parseInt8: true` returns `bigint`
  columns as numbers, but it changes this `pg` setting for the whole process.
- With `pg-native` installed, the `pg` native client is used. Streams (`stream()` on query builders) require
  `pg-query-stream`.

**CockroachDB** uses the same driver with `type: 'cockroachdb'` and the same connection options. Its
`timeTravelQueries` option (whether reads use follower reads) must be specified; a transaction that fails on a conflict
is retried 5 times (`maxTransactionRetries`).

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
| `socketPath` | | A unix socket, instead of the host and port |
| `ssl` | | TLS options, or a TLS profile name |
| `charset` | `'UTF8_GENERAL_CI'` | The character set and collation: use `'utf8mb4'` for full Unicode (emoji) |
| `timezone` | `'local'` | How dates are read and written: `'local'`, `'Z'` or an offset (`'+08:00'`) |
| `poolSize` | 10 (the `mysql2` default) | The maximum number of connections in the pool |
| `connectTimeout`, `acquireTimeout` | `10000` | The time allowed to connect, and to obtain a connection from the pool |
| `replication` | | `{master, slaves}`: reads go to the replicas |

- Use `type: 'mariadb'` for MariaDB: the options are the same. MariaDB has the `uuid` column type from version 10.7.
- **`bigint` and `decimal` columns are returned as strings**, as with PostgreSQL.
- A table has at most one auto-increment column. MySQL has no check constraint in TypeORM's schema synchronization.
- Only `mysql2` is supported: the old `mysql` package is not.

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
| `database` | Required | The database file, or `':memory:'` |
| `enableWAL` | `false` | The write-ahead log: reads no longer wait for writes |
| `timeout` | `5000` | How long a statement waits for a database locked by another connection, in milliseconds |
| `readonly`, `fileMustExist` | `false` | Open the file read-only; fail when it does not exist |
| `key` | | The encryption key, for a SQLite build with SQLCipher |
| `prepareDatabase` | | `(db) => …`, called with the better-sqlite3 connection once it is open: pragmas, functions |
| `nativeBinding` | | The path to the compiled module `better_sqlite3.node` |

- Foreign keys are enforced (`PRAGMA foreign_keys = ON`). There is one connection: `poolSize` is not supported.
- **`bigint` columns are returned as numbers**: values beyond 2^53 lose precision. Keep such values in a text column.
- `better-sqlite3` is a native module, compiled for one Node.js version. An Electron application needs a build for its
  Electron version (`electron-rebuild`, or better-sqlite3's prebuilt binaries for Electron); an NW.js application has
  it rebuilt with the NW.js headers (0.111.3 or later: use `sqljs` with earlier releases); Bun cannot load it (use
  `sqljs` there).
- When it is built from source against the headers of Node.js 24.19 or later, it aborts the process when the garbage
  collector frees one of its objects (`Assertion failed: (env) != nullptr`, in `RemoveEnvironmentCleanupHook`:
  [nodejs/node#65446](https://github.com/nodejs/node/issues/65446)), as every addon built on `node::ObjectWrap` does.
  Its prebuilt binaries are built against earlier headers; `lakutata mobile stage` builds the addons for mobile systems
  without the `node::ObjectWrap` cleanup hooks that cause the abort.

## SQLite: sql.js

`sql.js` is SQLite compiled to WebAssembly: no native module, so it runs the same way in Node.js, Bun, Electron and
browsers. The whole database is held in memory and written to its file when it changes.

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
| `location` | | The file to load and save (in a browser, the `localStorage` key) |
| `autoSave` | `false` | Save after each change. It requires `location` or `autoSaveCallback` |
| `autoSaveCallback` | | `(data: Uint8Array) => …`, called instead of writing `location` |
| `database` | | The database content to load (a `Uint8Array`), instead of `location` |
| `useLocalForage` | `false` | In a browser, save to IndexedDB (through `localforage`) instead of `localStorage` |
| `sqlJsConfig` | | The sql.js initialization options (`locateFile` for its `.wasm` file) |
| `driver` | | A sql.js build to use instead of the package's: its asm.js build (`sql.js/dist/sql-asm.js`) needs no WebAssembly |

- Without `autoSave`, nothing is written to disk until the entity manager's `saveDatabase()` (`SqljsEntityManager`)
  is called. With `autoSave`, a transaction's changes are saved once it is committed.
- The whole file is written on each save: sql.js suits small databases.
- As with better-sqlite3, foreign keys are enforced and `bigint` columns are returned as numbers.

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
| `authentication` | | Authentication other than user and password: `{type: 'ntlm', ...}`, `{type: 'azure-active-directory-default', ...}`… |
| `schema` | The user's default schema | The schema of the tables |
| `options.encrypt` | `true` | Encrypt the connection |
| `options.trustServerCertificate` | `false` | Accept a certificate not signed by a trusted authority |
| `options.instanceName` | | A named instance |
| `pool` | | The connection pool: `max`, `min`, `idleTimeoutMillis` (30000 by default)… (`poolSize` is not supported) |
| `connectionTimeout`, `requestTimeout` | `15000` | The time allowed to connect, and to run a query |

- Because `encrypt` is on, the connection to a server with a self-signed certificate (a local server, a container) is
  refused unless `trustServerCertificate` is `true`.
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
| `thickMode` | `false` | The `oracledb` thick mode (with the Oracle Client libraries): `true`, or `{libDir, configDir}` |
| `useUTC` | `false` | Read and write dates in UTC |
| `poolSize` | | The maximum number of connections in the pool |

- `oracledb` 6 and later run in thin mode by default, with no Oracle Client. Set `thickMode` for features that need it.
- Tables are in the user's schema. `useUTC` sets the session time zone for the whole process (the `ORA_SDTZ`
  variable).

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
| `authSource`, `replicaSet`, `tls`, `readPreference`, `writeConcern`… | | MongoDB client options |
| `poolSize` | | The maximum number of connections (`maxPoolSize`) |

- An entity has an `@ObjectIdColumn()`, its `_id`. Its type is the `ObjectId` from `lakutata/orm`: an
  `import {ObjectId} from 'bson'` in an ES module is a different class, whose instances are not entity IDs.
- `getRepository()` returns a `MongoRepository`, with MongoDB's methods (`find` with MongoDB operators, `aggregate`,
  `createCursor`…).
- TypeORM does not support the following for MongoDB: query builders, `query()`, relations and cascades, tree
  repositories, streams. **`transaction()` runs its function without a transaction**: the writes of a failed function
  remain written.
- `synchronize` only creates the indices. Migrations are written manually (see [Migrations](Migrations.md)).

## SAP HANA, Google Cloud Spanner and Amazon Aurora

These drivers come from TypeORM unchanged:

- **SAP HANA** (`sap`): `host`, `port`, `username`, `password`, `database`, `schema`, `encrypt` with `key`, `cert`,
  `ca`, and `pool` (`maxConnectedOrPooled`, 10 by default).
- **Google Cloud Spanner** (`spanner`): `projectId`, `instanceId`, `databaseId`, and `credentials` (`client_email`,
  `private_key`) unless the environment's credentials are used. The other options in its type, copied from MySQL, are
  not read.
- **Amazon Aurora through the Data API** (`aurora-mysql`, `aurora-postgres`): `region`, `secretArn`, `resourceArn` and
  `database` are required; queries go through the AWS HTTP API, not through a connection.

## The mobile applications

A mobile application built from the `mobile-react` template runs its Lakutata application in the Node.js it embeds
(Node.js 24.20). The drivers in the following table run there as they do on a computer, except where the table states
otherwise:

| Driver | Android | iOS | HarmonyOS |
|---|---|---|---|
| `better-sqlite3` | Yes | Yes | Yes |
| `sqljs`, its asm.js build | Yes | Yes | Yes |
| `sqljs`, its WebAssembly | Yes | Yes, much slower (a polyfill) | No: `ReferenceError: WebAssembly is not defined` |
| `mongo-embedded` | Yes | Yes | Yes |
| `postgres`, `mysql`, `mongodb` (a server on the network) | Yes | Yes | Yes |

- `lakutata mobile stage` builds `better-sqlite3` and `@lakutata/mongo-embedded` from source for each system, with the
  NDK, Xcode or DevEco Studio (see the `lakutata mobile` commands in the `@lakutata/cli` README).
- A database file must persist, and `os.tmpdir()` is the application's cache, which the system may empty. The template's
  `App.ts` declares the application's data directory as the alias `@data`: its `files` directory on Android,
  `Library/Application Support` on iOS, `/data/storage/el2/base/files` on HarmonyOS, and `packages/app/data` on the
  development computer. The database options name a file there as `@data/app.sqlite`: the alias is resolved when the
  database connects.
- The asm.js build of sql.js is SQLite compiled to JavaScript: no WebAssembly and no other file, so it runs the same way
  on all three systems. The Node.js on HarmonyOS has no WebAssembly, and the one on iOS has only the nodejs-mobile
  polyfill, which is much slower:

```typescript
import type {ApplicationOptions} from 'lakutata'
import {buildDatabaseOptions} from 'lakutata/com/database'
import {createRequire} from 'node:module'

/**
 * The options of the application
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
                //The asm.js build of sql.js, instead of its WebAssembly
                driver: createRequire(import.meta.url)('sql.js/dist/sql-asm.js'),
                entities: []
            })
        }
    }
}
```

- sql.js 1.15 marks its asm.js build as deprecated: the build prints a warning each time it is loaded, and the authors
  ask users who cannot move away from it to say so ([sql-js/sql.js#635](https://github.com/sql-js/sql.js/issues/635)).
  The build they recommend instead, `sql-wasm-inline.js`, requires WebAssembly, which the Node.js on HarmonyOS lacks.
  For a database that the application keeps, `better-sqlite3`, which works on all three systems, is the better choice.
- sql.js reads its WebAssembly from `sql-wasm.wasm`, next to its module, which the application bundle does not keep:
  declare the file as a resource in `lakutata.resources` (its `from` is where npm installed `sql.js` in the workspace),
  and pass its path among the resources to `sqlJsConfig.locateFile` ([Packaging](Packaging.md), section 6).
- A database server is reached over the device's network; from an emulator, the computer is reached through
  `adb reverse` (Android) or `hdc rport` (HarmonyOS).

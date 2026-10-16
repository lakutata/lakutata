# Lakutata Migrations

`synchronize: true` changes the tables to match the entities each time the database connects: handy in development, but
unsafe in production, where a renamed column would be dropped with its data. In production the schema changes through
**migrations**: classes that each make one change, run in order, and recorded in the database so that each runs once.

## 1. A migration

A migration implements `MigrationInterface` from `lakutata/orm`. `up()` makes the change, `down()` reverts it:

```typescript
import type {MigrationInterface, QueryRunner} from 'lakutata/orm'

export class AddBookAuthor1792161460658 implements MigrationInterface {
    public name: string = 'AddBookAuthor1792161460658'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "books" ADD "author" character varying')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "books" DROP COLUMN "author"')
    }
}
```

- The name of a migration ends with a timestamp in milliseconds (13 digits): the migrations run in the order of their
  timestamps. Two migrations with the same name are an error.
- The `migrations` option of the database lists them: the classes, or globs of their compiled files, relative to the
  working directory.

  ```typescript
  import {buildDatabaseOptions} from 'lakutata/com/database'

  export const db = buildDatabaseOptions({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [],
      migrations: ['build/migrations/*.js']
  })
  ```

- The migrations run are recorded in a table named `migrations` (`migrationsTableName` changes its name). A
  migration is run once, even if its timestamp is older than the last one run.

## 2. The `lakutata` command

The projects created by `lakutata` have scripts for the migrations:

```bash
npm run migration:generate          # a migration of the changes of the entities
npm run migration:create -- seed    # an empty migration, src/migrations/<timestamp>-seed.ts
npm run migration:run               # run the pending migrations
npm run migration:show              # list the migrations, run and pending
npm run migration:revert            # revert the last migration run
```

They call `lakutata migration <action>`:

| Option | Default | Meaning |
|---|---|---|
| `--dir` | `src/migrations` | The directory of the migrations written (`generate`, `create`) |
| `--script` | `dev` | The npm script that builds and starts the application |
| `--database` | Every database | The database of the command; required to revert with several databases |
| `--transaction` | The `migrationsTransactionMode` of the database | `all`, `each` or `none` (section 6) |
| `--fake` | `false` | Record the migrations as run (or reverted) without running them |
| `--package` | The current directory | The package of the workspace to run the command in |

`create` writes an empty migration without starting the application. The other actions run the npm script of the
application with the environment variables of section 3: the application itself does the command.

## 3. The commands of the application

An application started with one of these environment variables does the command instead of launching: it reads its
options, connects to its databases, does the command, and exits. Its `bootstrap` and its `onLaunched` handlers do not
run, and no server starts.

| Variable | Command |
|---|---|
| `MIGRATION_GENERATE=<directory>` | Write a migration of the differences between the entities and the tables (section 4) |
| `MIGRATION_RUN=1` | Run the pending migrations |
| `MIGRATION_REVERT=1` | Revert the last migration run |
| `MIGRATION_SHOW=1` | List the migrations of the options, run (`[X]`) and pending (`[ ]`) |
| `MIGRATION_DATABASE=<name>` | The database of the command: the name of its component or provider (every database by default) |
| `MIGRATION_TRANSACTION=all\|each\|none` | The transactions of `MIGRATION_RUN` and `MIGRATION_REVERT` (section 6) |
| `MIGRATION_FAKE=1` | Record the migrations as run (or reverted) without running them |

```text
$ MIGRATION_SHOW=1 node build/App.js
[db] [ ] Migrations1792161460658
[db] 1 pending migration
$ MIGRATION_RUN=1 node build/App.js
[db] Migration Migrations1792161460658 has been run
$ MIGRATION_REVERT=1 node build/App.js
[db] Migration Migrations1792161460658 has been reverted
```

- A flag is set by `1`, `true` or `yes`: `MIGRATION_RUN=0` starts the application as usual.
- The commands work on the `Database` components and providers declared at the top of the options (`components`,
  `providers`), each named by its key.
- The exit code is 0 when the command succeeded, 1 when it failed. With several databases, `MIGRATION_REVERT` needs
  `MIGRATION_DATABASE`.

## 4. Generating a migration

`MIGRATION_GENERATE` compares the entities with the tables of the database, and writes the SQL of the differences as a
migration:

```text
$ MIGRATION_GENERATE=src/migrations node build/App.js
Migration /home/app/src/migrations/1792161460658-db.ts has been generated successfully.
```

```typescript
import { MigrationInterface, QueryRunner } from "lakutata/orm";

export class Migrations1792161460658 implements MigrationInterface {
    name = 'Migrations1792161460658'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "books" (
                "id" SERIAL NOT NULL,
                "title" character varying NOT NULL,
                CONSTRAINT "PK_f3f2f25a099d24e12545b70b022" PRIMARY KEY ("id")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP TABLE "books"
        `);
    }

}
```

- The database must be reachable, and up to date with the migrations already written: the differences are computed
  from its tables.
- The file is `<directory>/<timestamp>-<database name>.ts`, a TypeScript class named after the directory
  (`src/migrations` gives `Migrations<timestamp>`). Build it with the application: the `migrations` option lists the
  compiled files.
- Read the migration before running it: a renamed property becomes a column dropped and a column added, with the data
  of the old one lost. Edit the SQL when needed.
- When nothing changed, the command writes nothing and exits with the code 1 (`No changes in database schema were
  found`).
- With several databases, each database whose tables differ gets its own file. Give each database a `migrations` option
  that lists only its own files (`'build/migrations/*-db.js'`), or the databases would run each other's migrations.

## 5. Running the migrations at startup

Instead of a command, the database can run its pending migrations each time it connects, with `migrationsRun: true`.
The order is then: `dropSchema` (if set), the migrations, then `synchronize` (if set).

- The `Database` component connects once: listed in `bootstrap`, it runs the migrations while the application launches.
- The `Database` provider connects each time it is resolved, so it checks the migrations each time.

The component and the provider also have the methods `runMigrations({transaction, fake})`,
`undoLastMigration({transaction, fake})` and `showMigrations()` (which resolves to whether migrations are pending).

## 6. Transactions

`migrationsTransactionMode`, an option of the database, or `MIGRATION_TRANSACTION` for one command:

| Mode | The pending migrations run… |
|---|---|
| `all` (default) | In one transaction: a failure reverts all of them |
| `each` | Each in its own transaction: a failure keeps the migrations run before it |
| `none` | Without a transaction |

- A migration can set its own `transaction` property (`true` or `false`) in the modes `each` and `none`; in the mode
  `all`, this is an error.
- PostgreSQL and SQLite run the changes of the schema inside transactions. MySQL and MariaDB commit each change of the
  schema at once: a failed migration can leave part of its changes applied.

## 7. MongoDB

The MongoDB databases (`mongodb`, `mongo-embedded`) have no schema to compare: `MIGRATION_GENERATE` writes nothing for
them, and their migrations are written by hand. `queryRunner.query()` is not supported; the entity manager of MongoDB
does the work:

```typescript
import type {MigrationInterface, MongoEntityManager, QueryRunner} from 'lakutata/orm'

export class RenameTitle1792161460700 implements MigrationInterface {
    public name: string = 'RenameTitle1792161460700'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const manager: MongoEntityManager = queryRunner.manager as MongoEntityManager
        await manager.updateMany('notes', {}, {$rename: {title: 'name'}})
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const manager: MongoEntityManager = queryRunner.manager as MongoEntityManager
        await manager.updateMany('notes', {}, {$rename: {name: 'title'}})
    }
}
```

MongoDB runs them without transactions: a failed migration leaves the migrations run before it, and its own changes made
before the failure.

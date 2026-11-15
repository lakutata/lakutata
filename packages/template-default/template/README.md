# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) application.

```bash
npm run dev     # build and start the application: http://localhost:8080/example
npm test        # build the application and run its tests
npm run build   # compile the application into build/
npm start       # start the compiled application
```

- `src/App.ts` starts the application.
- `src/config/Config.ts` declares its components, its entrypoint and the entrypoint's adapters.
- `src/controllers/` holds the controllers, whose actions are served by the entrypoint's adapters.

## The database migrations

```bash
npm run migration:generate              # generate migrations from the changes to the entities
npm run migration:create -- seed-users  # create an empty migration, to be written by hand
npm run migration:show                  # list the migrations: run [X] and pending [ ]
npm run migration:run                   # run the pending migrations
npm run migration:revert                # revert the last migration that was run
```

These commands (`lakutata migration <action>`) build and start the application. The application connects to its
databases with their options, without synchronizing their schemas, carries out the command and exits.
`-- --database <name>` selects a database (required for `revert` when the application has several), and `-- --fake`
marks migrations as run or reverted without executing them. Migrations are written to `src/migrations` and compiled with
the application. Once they are listed in the `migrations` option of a database that has `migrationsRun: true`, they run
when the database connects:

```typescript
import {buildDatabaseOptions} from 'lakutata/com/database'
import {Migrations1788773616343} from '../migrations/1788773616343-db.js'

components: {
    db: buildDatabaseOptions({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        entities: [/* the entities */],
        synchronize: false,
        migrationsRun: true,
        migrations: [Migrations1788773616343]
    })
}
```

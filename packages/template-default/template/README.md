# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) application.

```bash
npm run dev     # build and start, http://localhost:8080/example
npm test        # build and run the tests
npm run build   # compile into build/
npm start       # start the compiled application
```

- `src/App.ts` starts the application;
- `src/config/Config.ts` declares its components, the entrypoint and its adapters;
- `src/controllers/` holds the controllers: their actions are served by the adapters of the entrypoint.

## Database migrations

```bash
npm run migration:generate              # the migrations of the changes of the entities of the databases
npm run migration:create -- seed-users  # an empty migration, written by hand
npm run migration:show                  # the migrations run [X] and pending [ ]
npm run migration:run                   # run the pending migrations
npm run migration:revert                # revert the last migration run
```

The commands (`lakutata migration <action>`) build and start the application, which connects its databases with their
options (without synchronizing their schemas), does the command and exits; `-- --database <name>` selects a database
(required to revert when there are several), `-- --fake` marks the migrations as run or reverted without executing
them. The migrations are written into `src/migrations`, compiled with the application and given to the options of the
databases, run when they connect:

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

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

`npm run migration:generate` generates the migrations of the databases of the application (`lakutata migration generate`):
the application is built and started with `MIGRATION_GENERATE`, it compares the entities of its Database components and
providers with their databases, and writes the migrations of the changes into `src/migrations`. The migrations are
compiled with the application and given to the options of the databases, run when they connect:

```typescript
import {BuildDatabaseOptions} from 'lakutata/com/database'
import {Migrations1788773616343} from '../migrations/1788773616343-db.js'

components: {
    db: BuildDatabaseOptions({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        entities: [/* the entities */],
        synchronize: false,
        migrationsRun: true,
        migrations: [Migrations1788773616343]
    })
}
```

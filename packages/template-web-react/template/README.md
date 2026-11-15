# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) web application. The project is a workspace: `packages/app` is the
service, which serves its API under `/api` and the React application of `packages/ui` (built with Vite); further
packages are added under `packages/`.

```bash
npm run dev            # start the service and the Vite dev server: http://localhost:5173
npm test               # build the packages and run their tests
npm run build          # build the packages in the order of their dependencies (ui, then app)
npm start              # start the built service: http://localhost:8080
npm run version:patch  # give every package its next patch version
npm run docker:build   # build the image {$APP_ID}:<version>
DOCKER_REPOSITORY=registry.example.com/team/{$APP_ID} npm run docker:push   # build the image for linux/amd64 and push it
```

Results and errors alike are answered as `{errno, errMsg, data}`, errors with status 200. When the environment sets
`API_TOKEN`, every request except those to `/health` must carry `Authorization: Bearer <API_TOKEN>`
(`packages/app/src/middlewares/Authenticate.ts`). `/health` reports whether the process is responding.

Run `docker login <registry>` once before pushing; Docker keeps the credentials.

<!-- @if installer -->
## The installers

`npm run package:host` makes the installers for the platform it runs on, in `dist/installer`, with
`lakutata package installer` (configured by `lakutata.installer` in `packages/app/package.json`). The packages and
installers install the application, put its command `{$APP_ID}` in the PATH and register its service, which starts with
the system and has an environment file (`PORT`, `MODE`…, kept across upgrades) and a data directory of its own. The
archives hold the application as it is.

- Linux: deb and rpm packages, and a tar.gz archive. The packages install the application in `/opt/{$APP_ID}`, and its
  service is run by systemd. The environment is in `/etc/{$APP_ID}/{$APP_ID}.env` (run `systemctl restart {$APP_ID}`
  after changing it), and the data is in `/var/lib/{$APP_ID}`. `npm run package:linux` makes these files in Docker
  (`Dockerfile.installer`, output in `dist/installer`) on any platform.
- macOS: a pkg package and a tar.gz archive. The package installs the application in `/usr/local/lib/{$APP_ID}`, and its
  service is run by launchd. The environment is in `/usr/local/etc/{$APP_ID}/{$APP_ID}.env`.
  `sudo /usr/local/lib/{$APP_ID}/uninstall` removes the application and keeps its environment and its data.
- Windows: an NSIS installer, a Windows Installer package (msi) and a zip archive. The installers install the
  application in `C:\Program Files\{$APP_ID}`, and its service is run by WinSW. The environment is in
  `C:\ProgramData\{$APP_ID}\{$APP_ID}.env` (run `Restart-Service {$APP_ID}` after changing it).

<!-- @end -->
## The database migrations

```bash
npm run migration:generate              # generate migrations from the changes to the entities
npm run migration:create -- seed-users  # create an empty migration, to be written by hand
npm run migration:show                  # list the migrations: run [X] and pending [ ]
npm run migration:run                   # run the pending migrations
npm run migration:revert                # revert the last migration that was run
```

These commands (`lakutata migration <action>`) build and start the service. The service connects to its databases with
their options, without synchronizing their schemas, carries out the command and exits. `-- --database <name>` selects a
database (required for `revert` when the service has several), and `-- --fake` marks migrations as run or reverted
without executing them. Migrations are written to `packages/app/src/migrations` and compiled with the service. Once they
are listed in the `migrations` option of a database that has `migrationsRun: true`, they run when the database connects:

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

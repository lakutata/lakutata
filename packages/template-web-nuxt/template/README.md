# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) web application. The project is a workspace: `packages/app` is the
service, serving its API under `/api` and the Nuxt application of `packages/ui` (rendered by its Nitro build); the other
packages are added in `packages/`. The routes of the Nuxt application are not under `/api`, which belongs to the actions;
its pages call the API from the browser (on the server, `/api` is not the one of Nitro: call the service by its address).

```bash
npm run dev            # start the service and the Nuxt dev server, http://localhost:3000
npm test               # build the packages and run their tests
npm run build          # build the packages, in the order of their dependencies (ui, then app)
npm start              # start the built service, http://localhost:8080
npm run version:patch  # give the packages their next version
npm run docker:build   # build the image {$APP_ID}:<version>
DOCKER_REPOSITORY=registry.example.com/team/{$APP_ID} npm run docker:push   # build it for linux/amd64 and push it
```

The results are `{errno, errMsg, data}`, the errors too (with the status 200). The requests carry
`Authorization: Bearer <API_TOKEN>` when the environment has an `API_TOKEN`
(`packages/app/src/middlewares/Authenticate.ts`). `/health` tells whether the process answers.

`docker login <registry>` once before pushing: the credentials are kept by Docker.

<!-- @if installer -->
## The installers

`npm run package:host` makes the installers of the platform it runs on (`lakutata package installer`, configured by the
`lakutata.installer` of `packages/app/package.json`) in `dist/installer`: the application, its command
`{$APP_ID}` in the PATH, and its service started at the start of the system, with its environment (`PORT`, `MODE`…, kept by
the upgrades) and its data:

- Linux: the deb, rpm and tar.gz packages; the application in `/opt/{$APP_ID}`, its service run by systemd, its environment
  `/etc/{$APP_ID}/{$APP_ID}.env` (`systemctl restart {$APP_ID}` after changing it), its data `/var/lib/{$APP_ID}`.
  `npm run package:linux` makes them in Docker (`Dockerfile.installer`, in `dist/installer`) on any platform.
- macOS: the pkg package; the application in `/usr/local/lib/{$APP_ID}`, its service run by launchd, its environment
  `/usr/local/etc/{$APP_ID}/{$APP_ID}.env` (`sudo /usr/local/lib/{$APP_ID}/uninstall` removes it).
- Windows: the installer of NSIS and the package of Windows Installer (msi); the application in
  `C:\Program Files\{$APP_ID}`, its service run by WinSW, its environment `C:\ProgramData\{$APP_ID}\{$APP_ID}.env`
  (`Restart-Service {$APP_ID}` after changing it).

<!-- @end -->
## Database migrations

```bash
npm run migration:generate              # the migrations of the changes of the entities of the databases
npm run migration:create -- seed-users  # an empty migration, written by hand
npm run migration:show                  # the migrations run [X] and pending [ ]
npm run migration:run                   # run the pending migrations
npm run migration:revert                # revert the last migration run
```

The commands (`lakutata migration <action>`) build and start the app, which connects its databases with their
options (without synchronizing their schemas), does the command and exits; `-- --database <name>` selects a database
(required to revert when there are several), `-- --fake` marks the migrations as run or reverted without executing
them. The migrations are written into `packages/app/src/migrations`, compiled with the app and given to the options of the
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

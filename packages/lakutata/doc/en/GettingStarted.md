# Getting Started

This page creates a first Lakutata project from a template, then shows how to add the framework to an existing project
and write an application by hand.

## 1. Requirements

- Node.js 18.10 or later (`>=18.10.0`). A few features need a newer Node.js:
  - the Fastify adapter: Fastify 5 needs Node.js 18.19, 19.9, 20 or later (the Express adapter needs nothing more);
  - the worker threads of the WebRTC connections (`PeerThreads`): not on Node.js 18 and 19;
  - the Kafka transport of `@lakutata/queue`: Node.js 22.22, 24.6 or later, as `@platformatic/kafka` needs;
  - the executables of Node.js (`lakutata package exe`, the installers): made by a Node.js 20.12, 21.7 or later, or with
    `--node-program` naming one;
  - `await using` with the objects of the framework: Node.js 18.18, 20.4 or later.

  The projects made by `lakutata create` declare Node.js `^22.13.0 || >=24.11.0`, which the tools of the web and
  Electron templates need.
- TypeScript, with its decorators (`experimentalDecorators`) and their metadata (`emitDecoratorMetadata`). The framework
  publishes the compiler options it needs as `lakutata/tsconfig.json`; the templates use TypeScript 6.
- ES modules (`"type": "module"`), as in the templates; the package also ships CommonJS builds.

## 2. Creating a project

```bash
npx @lakutata/cli create --name my-app
cd my-app
npm run dev
```

`npm run dev` compiles the project and starts it; the log shows `my-app started in development mode`, and the
application answers on port 8080:

```bash
curl 'http://localhost:8080/example?name=you'
# {"message":"Hello, you!"}
```

The `default` template is a small HTTP application. Other templates start from another kind of application:

| Template | Application |
|---|---|
| `default` | A minimal application serving HTTP actions |
| `cli` | A command line tool built into executables that run without Node.js |
| `service` | An HTTP API deployed as a Docker image |
| `web-react`, `web-vue` | An HTTP API serving a React or Vue single-page application (Vite) |
| `web-next`, `web-nuxt` | An HTTP API serving a Next.js or Nuxt application from the same process |
| `electron-react`, `electron-vue` | A desktop application: Electron, its main process serving a React or Vue renderer over IPC |

```bash
npx @lakutata/cli create --name shop --template service --with i18n,installer
```

`--with` adds optional features: `i18n` (messages in several languages) to every template, `installer` (installers
and a system service) to `cli`, `service` and the `web-*` templates. In a terminal, the tool offers them when `--with`
is not given. [ProjectStructure](ProjectStructure.md) describes the files of the templates, and
[Command](Command.md) the options of `lakutata create`.

The scripts of the `default` template:

| Script | What it does |
|---|---|
| `npm run dev` | Compiles the project into `build/` and starts it |
| `npm run build` | Compiles the project into `build/` |
| `npm start` | Starts the compiled application |
| `npm test` | Compiles the project and runs its tests (`node --test`) |

The other templates are workspaces of several packages; their scripts work on every package, and `npm test` builds them
before running their tests ([ProjectStructure](ProjectStructure.md), section 2).

## 3. Adding Lakutata to an existing project

```bash
npm install lakutata express
npm install --save-dev typescript @types/node @types/express @lakutata/cli
```

`express` is the library of the HTTP adapter used below. The adapters and drivers are optional dependencies, installed
only when they are used: `fastify`, `commander` and `@inquirer/prompts` (command line tools), `socket.io`, `ws`, the
database drivers (`pg`, `mysql2`, `better-sqlite3`…), the cache stores (`redis`…).

`tsconfig.json`:

```json
{
  "extends": "lakutata/tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "build"
  },
  "include": ["src"]
}
```

Keep `include`: the published options compile JavaScript files too (`allowJs`), so without it a configuration file at
the root of the project (`eslint.config.js`, `vite.config.ts`) breaks the build. In the `package.json`, set
`"type": "module"` and add scripts such as those of the templates:

```json
{
  "type": "module",
  "main": "build/App.js",
  "scripts": {
    "clean": "lakutata clean",
    "build": "npm run clean && tsc",
    "start": "node build/App.js"
  }
}
```

The relative imports of the sources end in `.js` (`import {config} from './config/Config.js'`), as Node.js resolves
them in the compiled code.

## 4. A first application

`src/App.ts`:

```typescript
import {Application, DTO, type ILogger} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class GreetDTO extends DTO {
    @Expect(DTO.String().optional().default('world'))
    public name: string
}

class GreetController extends Controller {
    //GET /greet?name=you, and the service action {cmd: 'greet', name: 'you'}
    @GET('/greet', GreetDTO)
    @ServiceAction({cmd: 'greet'}, GreetDTO)
    public async greet(input: GreetDTO): Promise<{ message: string }> {
        return {message: `Hello, ${input.name}!`}
    }
}

Application
    .run(() => ({
        id: 'com.example.greeter',
        name: 'Greeter',
        components: {
            entrypoint: buildEntrypoints({
                controllers: [GreetController],
                http: expressHTTPEntrypoint({port: 8080})
            })
        },
        bootstrap: ['entrypoint']
    }))
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started', app.appName))
```

```bash
npm run build && npm start
curl 'http://localhost:8080/greet?name=you'
# {"message":"Hello, you!"}
```

- `GreetDTO` validates the input: `name` is optional, `world` by default ([DTOValidation](DTOValidation.md)).
- `GreetController` declares an action, here served over HTTP; the same method could also be a command of a command
  line tool or a service action ([Controllers](Controllers.md)).
- `Application.run()` declares the components of the application: the `entrypoint` component serves the controllers
  through its adapters, and `bootstrap` creates it at launch ([Application](Application.md),
  [Entrypoint](Entrypoint.md)).

## 5. Next

- [Examples](examples/README.md): whole applications built from the templates, step by step.
- [ProjectStructure](ProjectStructure.md): the files of a project and its scripts.
- [Application](Application.md), [Objects](Objects.md) and [Injection](Injection.md): how an application is declared,
  and how its objects are created and obtain one another.
- [Controllers](Controllers.md) and [HTTP](HTTP.md): actions, their input and their responses.
- [Command](Command.md), [Workspaces](Workspaces.md), [NativeAddons](NativeAddons.md), [Packaging](Packaging.md) and
  [Installers](Installers.md): the `lakutata` command, the packages of a project, and the packed applications.

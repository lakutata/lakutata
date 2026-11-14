# Getting Started

This guide describes how to create a first Lakutata project from a template, and then how to add the framework to an
existing project and write an application manually.

## 1. Requirements

- Node.js 18.10 or later (`>=18.10.0`). A few features require a newer Node.js:
  - the Fastify adapter: Fastify 5 requires Node.js 18.19, 19.9, 20 or later (the Express adapter has no further
    requirement);
  - the Kafka driver of `@lakutata/queue`: Node.js 22.22, 24.6 or later, as required by `@platformatic/kafka`;
  - Node.js executables (`lakutata package exe`, the installers): built by Node.js 20.12, 21.7 or later, or with
    `--node-program` pointing to such a Node.js program;
  - `await using` with framework objects: Node.js 18.18, 20.4 or later.

  On Node.js 18 and 19, an application uses commander 13, @inquirer/prompts 7 and better-sqlite3 11, because their next
  major versions require Node.js 20 or later.

  Projects created by `lakutata create` declare Node.js `>=22.13.0`, as required by the tools in the web and desktop
  templates.
- TypeScript, with decorators (`experimentalDecorators`) and their metadata (`emitDecoratorMetadata`). The framework
  publishes the compiler options it requires as `lakutata/tsconfig.json`; the templates use TypeScript 6.
- ES modules (`"type": "module"`), as in the templates; the package also ships CommonJS builds.

## 2. Creating a project

```bash
npx @lakutata/cli create --name my-app
cd my-app
npm run dev
```

`npm run dev` compiles the project and launches the application. The log shows `my-app started in development mode`, and
the application responds on port 8080:

```bash
curl 'http://localhost:8080/example?name=you'
# {"message":"Hello, you!"}
```

The `default` template is a small HTTP application. Other templates create other kinds of applications:

| Template | Application |
|---|---|
| `default` | A minimal application serving HTTP actions |
| `cli` | A command-line tool built into executables that run without Node.js |
| `service` | An HTTP API deployed as a Docker image |
| `web-react`, `web-vue` | An HTTP API serving a React or Vue single-page application (Vite) |
| `web-next`, `web-nuxt` | An HTTP API serving a Next.js or Nuxt application from the same process |
| `electron-react`, `electron-vue` | An Electron desktop application whose main process serves a React or Vue renderer over IPC |
| `nwjs-react`, `nwjs-vue` | An NW.js desktop application whose background script serves a React or Vue user interface isolated in a webview |
| `mobile-react` | A React Native mobile application for Android, iOS and HarmonyOS, whose embedded Node.js serves the user interface |

```bash
npx @lakutata/cli create --name shop --template service --with i18n,installer
```

`--with` adds optional features: `i18n` (messages in several languages) to every template, `installer` (installers and a
system service) to `cli`, `service` and the `web-*` templates, and `win7` (NW.js 0.72, which runs on Windows 7) to the
`nwjs-*` templates. In a terminal, the tool offers these features when `--with` is not specified. [Project
Structure](ProjectStructure.md) describes the templates' files, and [Command-Line Tool](Command.md) describes the
options of `lakutata create`.

The `default` template defines the following scripts:

| Script | What it does |
|---|---|
| `npm run dev` | Compiles the project into `build/` and launches the application |
| `npm run build` | Compiles the project into `build/` |
| `npm start` | Launches the compiled application |
| `npm test` | Compiles the project and runs its tests (`node --test`) |

The other templates are multi-package workspaces: their scripts apply to every package, and `npm test` builds the
packages before running their tests ([Project Structure](ProjectStructure.md), section 2).

## 3. Adding Lakutata to an existing project

```bash
npm install lakutata express
npm install --save-dev typescript @types/node @types/express @lakutata/cli
```

`express` is the library behind the HTTP adapter used below. Adapters and drivers are optional dependencies, installed
only when they are used: `fastify`, `commander` and `@inquirer/prompts` (command-line tools), `socket.io`, `ws`,
database drivers (`pg`, `mysql2`, `better-sqlite3`…) and cache stores (`redis`…).

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

Keep `include`: the published options also compile JavaScript files (`allowJs`), so without it the build fails on a
configuration file in the project root (`eslint.config.js`, `vite.config.ts`). In `package.json`, set `"type": "module"`
and add scripts similar to those in the templates:

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

Relative imports in the source files end in `.js` (`import {config} from './config/Config.js'`), because Node.js
resolves them in the compiled code.

## 4. A first application

`src/App.ts`:

```typescript
import {Application, DTO, type ILogger} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class GreetDTO extends DTO {
    @Expect(DTO.String().optional().default('world'))
    public name: string
}

class GreetController extends Controller {
    //GET /greet?name=you
    @GET('/greet', GreetDTO)
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

- `GreetDTO` validates the input: `name` is optional and defaults to `world` ([DTO and Validation](DTOValidation.md)).
- `GreetController` declares an action, served here over HTTP. The same method could also be a command in a command-line
  tool or a service action ([Controllers and Actions](Controllers.md)).
- `Application.run()` declares the application's components: the `entrypoint` component serves the controllers through
  its adapters, and `bootstrap` creates it at launch ([Application](Application.md), [Entrypoint](Entrypoint.md)).

## 5. Next

- [Examples](examples/README.md): complete applications built from the templates, step by step.
- [Concepts](Concepts.md) and [Application Design](ApplicationDesign.md): the framework's model, and how to structure an
  application on it.
- [Project Structure](ProjectStructure.md): a project's files and scripts.
- [Application](Application.md), [Objects and Lifetimes](Objects.md) and [Dependency Injection](Injection.md): how an
  application is declared, and how its objects are created and obtain one another.
- [Controllers and Actions](Controllers.md) and [HTTP](HTTP.md): actions, their input and their responses.
- [Command-Line Tool](Command.md), [Workspaces](Workspaces.md), [Native Addons](NativeAddons.md),
  [Packaging](Packaging.md) and [Installers](Installers.md): the `lakutata` command, a project's packages, and packed
  applications.

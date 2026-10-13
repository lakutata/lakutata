# Contributing

## Naming

The functions of lakutata, exported or internal (the helpers of a module, of the tests, of the scripts), are named in
camel case, as JavaScript's own; the classes, the types, the decorators and four helpers are named in Pascal case:

| Declaration | Case | Examples |
|---|---|---|
| Functions, exported or internal (helpers, option builders, adapters) | camel | `buildEntrypoints`, `expressHTTPEntrypoint`, `delay`, `md5`, `isEmptyObject` |
| Classes, interfaces, types, enums | Pascal | `Application`, `ActionPattern`, `HTTPErrorOrigin` |
| Decorators | Pascal | `@Inject`, `@Configurable`, `@ServiceAction`, `@Synchronized` |
| The helpers `As`, `DevNull`, `Glob` and `GlobSync` | Pascal | see below |
| Methods and properties | camel | `getObject()`, `appName`, `startup()` |
| Option keys | camel | `shutdownSignals`, `actionErrorStatus` |
| Constants of a module | upper snake | `DBUS_CONTEXT_TYPE` |

Acronyms are kept in capitals inside a name (`HTTPContext`, `isHTML`, `buildHTTPEntrypoint`, not `HttpContext`); a name
starting with an acronym starts it in lower case (`md5`, `httpServiceEntrypoint`, `jsonRPCServiceEntrypoint`).

`As`, `DevNull`, `Glob` and `GlobSync` stay in Pascal case: in camel case they would be `as` (a keyword of TypeScript),
`devNull` (a string of `node:os`, the path of the null device) and `glob`/`globSync` (the functions of `node:fs`, which
match the same patterns). A function whose camel case name would be the name of a function of Node.js doing something
else gets another name (`constantTimeEqual`, not `timingSafeEqual` of `node:crypto`, which throws for values of
different lengths).

A function whose camel case name would be the name of a variable or a parameter of its scope (a factory `random()`
called as `const random = random()`) is named after what it does instead (`seededRandom`, `clientIdOf`, `toWebRequest`).
The components of React keep their Pascal case, as the constructor functions called with `new`.

The names of the libraries lakutata re-exports (TypeORM, dbus-sdk) and of the code vendored in it (the engine of the
validation) are kept as they are. The functions of 2.x renamed in
camel case have no alias: the projects and the SDKs built on 2.x rename their calls when they move to 3.0.

## Documenting the public API

The applications built on lakutata are more and more written by AI agents, which learn a package from what is
published: its README and the comments of its typings (`dist/types/**/*.d.ts` keep the JSDoc of the sources). Every
public API is therefore documented in its source, completely enough to be used without reading its code.

The public API of a package is what its `src/exports/*.ts` barrels export, with the public and protected members of the
exported classes, interfaces and object types (the protected ones are used by the subclasses: `Controller.context`,
`BaseObject.getObject`). `npm run test:api-docs` checks it (see [the check](#the-check)).

### What each declaration states

| Declaration | Required |
|---|---|
| Class | What it is and when to use it; how it is obtained (registered as a component, created by the container, built by a function); its lifetime when it matters; an `@example` |
| Function, decorator | What it does; an `@param` with a description for each parameter (its constraints, its default); `@returns` unless it returns nothing; `@throws` for the exceptions a caller handles; an `@example` |
| Method | As a function, without `@example` unless its use is not obvious |
| Property, option | What it holds, its unit (milliseconds, bytes), its `@default` when it has one |
| Type, interface | What it describes; each of its members documented |
| Enum | What it lists; each of its members documented |
| Exception | When it is thrown; its `errno` and, for the transports, its status (HTTP 409…) |

Optional tags: `@see` a guide of `doc/en` or another API, `@deprecated` with its replacement, `@remarks` for what a user
of the API needs to know beyond its summary (its concurrency, its cost, its platform).

### The examples

An `@example` is a complete TypeScript module, fenced as `typescript`: it imports what it uses from the published
subpaths (`lakutata`, `lakutata/com/mutex`, `@lakutata/grpc`…, never `src/`), and declares with `declare` what it does not
build itself (`declare const app: Application`). The examples are compiled as ES modules (top-level `await` allowed)
against the built typings, with the compiler options of the applications (the `tsconfig.json` published by `lakutata`),
by `npm run test:api-docs`: an example which does not compile any more fails it. A decorator may start a line of an
example: the check reads the lines of a code fence as code, not as tags.

```typescript
/**
 * Run a controller action holding a lock, acquired once its input is validated and its access control passed,
 * released after it.
 * @param name The name of the lock: a template of the fields of the input (`order:{id}`), or a function of the input
 * and the context of the request.
 * @param options How the lock is waited for, and the component holding it.
 * @returns The method decorator.
 * @throws {MutexTimeoutException} From the action, when the lock is not acquired in time (HTTP 409).
 * @example
 * ```typescript
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {Synchronized} from 'lakutata/com/mutex'
 *
 * class OrderController extends Controller {
 *     //The payments of an order one at a time, the other orders in parallel
 *     @ServiceAction({cmd: 'order.pay'})
 *     @Synchronized('order:{id}')
 *     public async pay(input: {id: number}): Promise<void> {
 *     }
 * }
 * ```
 */
```

### The wording

- Write plain English sentences, starting with what the API does ("Acquire a lock…", "The options of…"); avoid the
  chains of "of" ("the locks of the components of the application"): "the application's component locks".
- State the behavior a caller depends on: the defaults, the units, what happens on a failure, an abort, a timeout, a
  concurrent call.
- Keep the internal details (how it is implemented) in the line comments of the code, not in the JSDoc.

### The READMEs

Each library package has a `README.md` with these sections (the check requires the headings `## Installation`,
`## Usage` and `## API`):

1. Its title, then one paragraph: what it is, and the subpath of the umbrella package `lakutata` exposing it.
2. `## Installation`: the package, and its optional peer dependencies for each feature (`redis` for the Redis driver…).
3. `## Usage`: a minimal runnable example registering it in an `Application`, then the common uses.
4. `## API`: a table of its exported symbols, one line each.
5. `## Errors`: its exceptions and when they are thrown.
6. `## See also`: its guide in `doc/en` / `doc/zh` and its related packages.

Each ```` ```typescript ```` block of a README is compiled as an example, a module of its own: a fragment (a part of
the options of an application) is fenced as `text` or completed into a module.

### The check

`npm run lint` runs the check without compiling the examples (no build needed); `npm run test:api-docs` builds the
packages, then runs it whole:

- reports each public declaration missing its description, an `@param` of one of its parameters, or the `@example` of a
  class or a function (the exceptions need none), and each library package missing its README or one of its sections;
- compiles the `@example` of every public declaration and the TypeScript blocks of the READMEs against the built
  typings.

The declarations not documented yet are listed in `scripts/api-docs/baseline.json`: the check fails on a new one, and
on one documented since (its entry removed with `node scripts/api-docs/check.mjs --update`). The baseline only shrinks.

## The source of TypeORM

`@lakutata/orm` holds the source of TypeORM in `packages/orm/typeorm`, built into `dist/typeorm` and imported as
`#typeorm/*` (`packages/orm/typeorm/README.md`). It keeps the style of TypeORM, which ESLint does not check.

- A change of lakutata goes in new files where possible; a change of a file of TypeORM is marked with a `lakutata:`
  comment. It is committed apart from the upgrades.
- An upgrade merges the source of a newer tag of TypeORM three ways (`node scripts/typeorm/sync.mjs <tag>`), keeping the
  changes of lakutata; it lists the conflicts left in the files. The upgrade commit holds the source of TypeORM only.

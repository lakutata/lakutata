# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

This repository is the **source of the `lakutata` framework itself** — an IoC-based universal
application framework for Node.js (web, desktop, embedded, CLI). It is *not* an application built on
lakutata. The `lakutata-framework` skill describes how to *consume* this framework; this file
describes how to *develop the framework*.

Published to npm as `lakutata`. Requires Node >= 20, ESM-only (`"type": "module"`).

## Commands

```bash
# Build (custom Rollup pipeline, NOT tsc) — outputs to ./distro
npm run rebuild        # clean + build:js (develop, ESM only)
npm run compile        # alias of rebuild; runs automatically on `prepare`
BUILD_MODE=production npm run compile   # production: ESM + CJS, excludes src/tests

# Tests — both compile (develop mode) first, then run the built .mjs from distro/
npm run test:unit      # mocha distro/src/tests/UnitTest.spec.mjs (DI, BaseObject, DTO suites)
npm run test:app       # node distro/src/tests/App.spec.mjs (full app: HTTP/CLI/Service/ORM/Docker)

# Run a single unit suite: edit src/tests/UnitTest.spec.ts to import only the desired
# ./unit/*.spec.js, then `npm run test:unit`. (Mocha's --grep filters describe/it titles.)

# Lint (config only; not wired to a script) — single quotes, NO semicolons, NO trailing commas
npx eslint 'src/**/*.ts'

# Release (maintainers): release-it bumps/tags, then builds prod + publishes distro/
npm run release        # also: release:beta-release / alpha-release / proto-release
```

There is **no `tsc` build step**. `rollup.mjs` is the single source of build truth: it globs
`src/**/*.ts`, transpiles via `@rollup/plugin-typescript`, bundles third-party deps into
`distro/vendor/`, generates a flattened `.d.ts` per export entry, and rewrites `package.json` /
`tsconfig.json` for the published artifact. Tests run against `distro/`, never against `src/`
directly — **rebuild before testing** (the test scripts already do this).

## Conventions (enforced / load-bearing)

- **ESM `.js` import specifiers in `.ts` source.** Every relative import ends in `.js` even though
  the file is `.ts` (e.g. `import {Module} from './Module.js'`). Required by `module: Node16`.
  Match this exactly in new files.
- **Code style:** single quotes, no semicolons, no trailing commas, 4-space indent. See `.eslintrc.json`.
- **Decorators:** `experimentalDecorators` + `emitDecoratorMetadata` are on; `strict` is on but
  `noImplicitAny`, `strictPropertyInitialization`, and unused checks are off.
- **Public API is the `exports` map in `package.json`.** Each subpath (`.`, `./orm`, `./dtos`,
  `./decorator/*`, `./com/*`, `./provider/*`, `./helper`) maps to one `src/exports/*.ts` barrel.
  Anything not re-exported from a barrel under `src/exports/` is internal. When adding public API,
  add the symbol to the appropriate `src/exports/*.ts` **and** the `exports` map.

## Architecture

Three layers, bottom-up:

1. **IoC container — `src/lib/ioc/`** — a vendored/adapted Awilix-style DI container
   (`DependencyInjectionContainer.ts`, `Resolvers.ts`, `Lifetime.ts`, `InjectionMode.ts`,
   `FunctionTokenizer.ts`). Pure dependency-injection mechanics; framework-agnostic.

2. **Core object model — `src/lib/core/` + `src/lib/base/`** — wraps the container in the
   framework's class hierarchy:
   ```
   AsyncConstructor (lib/base/async-constructor) → BaseObject (lib/base/BaseObject.ts)
        → Component → Module → Application
        → Provider → Controller (components/entrypoint/lib/Controller.ts)
   ```
   - **`BaseObject`** is the root. Key mechanism: the **AsyncConstructor** pattern. Construction is
     async — after `new`, the container resolves `@Inject` dependencies, applies `@Configurable`
     property values (validated through DTO/joi), then awaits the `[__init]` symbol method. Teardown
     awaits `[__destroy]`. Lifetimes (`@Singleton`/`@Scoped`/`@Transient`) come from
     `src/decorators/di/Lifetime.ts`; `BaseObject` defaults to `@Transient`.
   - **`Module`** adds object registration + `getObject()` resolution + `bootstrap` ordering.
     **`Application`** is the top-level Module with the fluent bootstrap API
     (`.env().alias().run(Config).onLaunched(...)`), alias/path resolution (`Alias.ts`), and process
     lifecycle.
   - **`DTO`** (`lib/core/DTO.ts`) + **`VLD`** (`lib/validation/VLD.ts`) wrap **joi** (extended with
     bigint support) to provide schema validation used by `@Expect`/`@Accept`/`@Return`/`@Configurable`.

3. **Batteries (components & providers)** — `src/components/` (`@Singleton` business services:
   `Database` = TypeORM, `Logger` = pino, `cacher`, `docker` = dockerode, `monitor`, `entrypoint`)
   and `src/providers/` (`@Scoped` infra: `Database` provider, `PasswordHash`).

### Entrypoint dispatch (`src/components/entrypoint/`)

The `Entrypoint` component unifies three transports onto the same controller methods. A single
controller method may carry `@HTTPAction`/`@POST`-family, `@CLIAction`, and `@ServiceAction`
decorators simultaneously. Routing uses **patrun** pattern-matching to dispatch to a freshly-created
(`@Scoped`) controller instance per request. Contexts live in `src/lib/context/`
(`HTTPContext`, `CLIContext`, `ServiceContext`). Access control is in `entrypoint/lib/AccessControl*`.

### Decorators (`src/decorators/`, exported under `lakutata/decorator/*`)

- `di/` — `@Inject`, `@Configurable`, `@Autoload`, lifetime decorators (`./decorator/di`)
- `ctrl/` — `@HTTPAction` (+ `http/` verb wrappers `@GET/@POST/...`), `@CLIAction`, `@ServiceAction` (`./decorator/ctrl`)
- `dto/` — `@Expect`, `@Accept`, `@Return` (`./decorator/dto`)
- `orm/` — TypeORM re-exports (`./decorator/orm`); `asst/` — assistant decorators (`./decorator/asst`)

### Directory map

| Path | Role |
|------|------|
| `src/lib/ioc/` | Low-level DI container |
| `src/lib/core/` | `Application`/`Module`/`Component`/`Provider`/`Container`/`DTO`/`Time`/`Alias` |
| `src/lib/base/` | `BaseObject`, `AsyncConstructor`, `EventEmitter`, internal injection plumbing |
| `src/lib/validation/` | joi wrapper (`VLD`) + schema interface/type defs |
| `src/lib/helpers/` | Standalone utilities (exported via `lakutata/helper`) |
| `src/components/` | Built-in singleton components |
| `src/providers/` | Built-in scoped providers |
| `src/exports/` | Public API barrels (one per `package.json` export subpath) |
| `src/options/`, `src/types/`, `src/interfaces/` | Public option DTOs, types, interfaces |
| `src/exceptions/` | Framework exception classes (grouped by domain) |
| `src/tests/` | TS test sources (compiled to `distro/` then executed) |
| `doc/en`, `doc/zh` | Bilingual usage guides |

## Notes

- `BUILD_MODE` env var drives the build: `production` emits both CJS+ESM and strips `src/tests`;
  anything else (`develop`) emits ESM only and includes tests.
- Native/optional DB & transport deps (`mysql2`, `pg`, `sqlite3`, `mongodb`, `redis`, `fastify`,
  `socket.io`, …) are marked `external` in `rollup.mjs` — they are peer/optional, not bundled.
- The committed `package.json` `exports` point at `src/*.ts` (for in-repo/dev tooling); `rollup.mjs`
  rewrites them to `.d.ts`/`.mjs`/`.cjs` in the published `distro/package.json`.

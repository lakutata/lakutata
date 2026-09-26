# Validation engine: upstream provenance

The validation engine is lakutata's own TypeScript module. It is derived from the projects below, which are not
dependencies of lakutata. License texts: `THIRD_PARTY_NOTICES.md` in the package root.

| Directory | Upstream | Version | Commit | Scope |
|---|---|---|---|---|
| `hoek/` | [hapijs/hoek](https://github.com/hapijs/hoek) | 11.0.7 | 40e7940363febdb4d427d57c88eba96accdcc0e1 | applyToDefaults, assert, AssertError, clone, deepEqual, escapeHtml, escapeRegex, ignore, merge, reach, stringify (+ internal types, utils) |

Tests are ported from the upstream suites into `src/tests/engine` and run on `node:test`; the assertion
library is ported from [hapijs/code](https://github.com/hapijs/code) 9.0.3 (425043e302090e541f569ee37d8dd4c0444a9cf4).

## Rules

- The first rewrite of a module keeps the upstream behavior exactly (the ported upstream tests must pass unchanged).
  Behavior changes are separate, documented commits.
- No `any`: `npm run test:engine-types` type-checks the engine with `noImplicitAny` and rejects every explicit `any`
  without an `any-justified: <reason>` comment.

## Differences from upstream

### hoek
- Node.js only (>= 22): the runtime existence checks for `Buffer` and `structuredClone` are dropped.
- Typed with `unknown` instead of `any` (`reach()` returns `unknown`, `deepEqual()` takes `unknown`); `isArray()`
  narrows to `unknown[]`.
- Known upstream quirk kept for now: in `reach()`, a negative index on a Set yields `NaN` (it reads the Set's missing `length`).

# Validation engine: upstream provenance

The validation engine is lakutata's own TypeScript module. It is derived from the projects below, which are not
dependencies of lakutata. License texts: `THIRD_PARTY_NOTICES.md` in the package root.

| Directory | Upstream | Version | Commit | Scope |
|---|---|---|---|---|
| `hoek/` | [hapijs/hoek](https://github.com/hapijs/hoek) | 11.0.7 | 40e7940363febdb4d427d57c88eba96accdcc0e1 | applyToDefaults, assert, AssertError, clone, deepEqual, escapeHtml, escapeRegex, ignore, merge, reach, stringify (+ internal types, utils) |
| `pinpoint/` | [hapijs/pinpoint](https://github.com/hapijs/pinpoint) | 2.0.1 | b0497deca07051ed6911baa52ff97bd5e994b9ce | location |
| `formula/` | [hapijs/formula](https://github.com/hapijs/formula) | 3.0.2 | f173633232250d222548489a0b85f94c07ad2258 | Parser |
| `topo/` | [hapijs/topo](https://github.com/hapijs/topo) | 6.0.2 | 3c4ee008ec9f719b0992ba06feb35c24b57787d7 | Sorter |
| `tlds/` | [hapijs/tlds](https://github.com/hapijs/tlds) | 1.1.4 | 2c9410a8cb6dcb5a0c1d329a4359074b10151582 | tlds (IANA list, version 2025102200) |
| `address/` | [hapijs/address](https://github.com/hapijs/address) | 5.1.1 | f23e252d821644b4422220a2482d6f832aaf49ed | domain, email, ip, uri, decode, errors |
| `joi/` | [hapijs/joi](https://github.com/hapijs/joi) | 18.0.2 | 481e270e6c4ff8728d6fda248fd83f6ff70f7ed9 | the whole library (lib/, lib/types/) |
| `joi-bigint/` | [softstackhq/joi-bigint](https://github.com/softstackhq/joi-bigint) | 1.1.1 | a3db89f8baf264f44b2c09f8baa2c37d00cca942 | the bigint extension (src/index.ts, src/types.ts) |

Tests are ported from the upstream suites into `src/tests/engine` and run on `node:test` (joi-bigint's jest suite
included); the assertion
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

### pinpoint
- `location()` calls `Error.captureStackTrace()` without a constructor, like upstream (which passed its non-function
  `this`), so the frame of `location()` itself stays in the stack and depths are unchanged.
- Test adaptation: upstream asserts a hard-coded line number and an @hapi/lab frame; the ported test compares with an
  Error created on the same line instead.

### formula
- Operand values are `unknown`; arithmetic keeps JavaScript's runtime coercion (the `number` casts only satisfy the
  type checker).
- A function reference is replaced by a new part object instead of mutating the reference part in place.

### topo
- The intermediary 'before' graph (group names) and the expanded graph (sequence numbers) are separate typed maps;
  upstream reused one object. Keys stay object keys, so the numeric/string coercion is unchanged.

### tlds, address
- Upstream sources are TypeScript; they are taken over with lakutata's module paths and code style.
- Strict typing fixes without behavior change: `isTldsAllow()` takes `unknown` instead of `any`, the tlds deny check
  and the URI scheme list are typed (`Partial<TldsDeny>`, `Scheme[]`), `wrap()`'s scheme parameter is `string | null`.
- The address tests use Node's deprecated built-in `punycode` module to compute expected values (test only).

### joi
- Rewritten in TypeScript file by file (after a mechanical CommonJS to ESM stage), with the ported suite green at
  every step. Upstream behavior is kept, quirks included; the typing adds no runtime checks.
  - `Base` (base.ts) is the schema class; each type exports its schema interface (`AnySchema`, `StringSchema`...) and
    extends its parent with `extend<XSchema>()`. Type definitions are typed by `TypeDefinition<S>` (extend.ts).
  - Upstream required some modules lazily (inside functions) to keep its load order. ESM imports are static, so:
    `schemas.ts` builds its schemas on first use (`getSchemas()`), and `messages`, `template` and `schemas` register
    themselves in `lazy.ts` for the modules which read them at runtime (`common`, `ref`, `manifest`).
  - `Joi.version` is the constant '18.0.2' (upstream read it from package.json).
  - Upstream's internal module helpers (`internals.x`) are module-level functions; a few are renamed where a local
    variable of the same name would shadow them (the rewritten files note the upstream name).
  - Types widened to what upstream accepts at runtime: `RefOptions.prefix` may be `false`; the cache takes any value
    as key (only primitives are cached); `assertOptions()` also takes a single key (matched as a substring).
- Test adaptations (the rest of the 27 upstream test files is kept line by line):
  - `@hapi/bourne` parse is replaced by `JSON.parse` (the parsed inputs contain no prototype keys).
  - hoek's `wait()` (not part of the engine) is provided locally in the validator tests.
  - A schema of another joi version is simulated through the shared version marker (the only thing joi inspects);
    the two tests compiling v15 schemas are skipped: they need the compiler of an older joi release.
  - The annotate test reads the function source at runtime instead of hard-coding it.
  - Tracer tests: `__filename` comes from the stack (ESM), and expected lines are looked up in the compiled file
    because the TypeScript compiler drops the blank lines the upstream offsets rely on.
  - The stack test matches the ESM frame name of `process()` (`Module.process`) instead of `exports.process`.
  - Added (not in upstream): the inclusive boundaries of `number().port()`.

### joi-bigint
- Typed with the engine's types (`BigIntSchema` extends `AnySchema`); `BigIntSchema<T>` keeps its (unused) type
  parameter for compatibility with the upstream type.
- Test adaptations: jest's `toHaveProperty('error')` is checked with `'error' in result`; `toBeTruthy()` on booleans
  with `to.be.true()`.

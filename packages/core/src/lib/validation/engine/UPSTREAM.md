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

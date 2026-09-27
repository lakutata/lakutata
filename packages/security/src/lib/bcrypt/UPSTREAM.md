# bcrypt: upstream provenance

The bcrypt implementation is lakutata's own TypeScript module. It is derived from the project below, which is not a
dependency of lakutata. License text: `THIRD_PARTY_NOTICES.md` in the package root.

| Directory | Upstream | Version | Commit | Scope |
|---|---|---|---|---|
| `lib/bcrypt/` | [dcodeIO/bcrypt.js](https://github.com/dcodeIO/bcrypt.js) (npm: bcryptjs) | 3.0.3 | 1211e9a2213e0b3ee232a204b3ce899beebce31a | index.js |

The file headers refer to "the upstream" file a module is derived from (or a test is ported from). The tests are
ported from the upstream `tests/index.js` into `src/tests/Bcrypt.spec.ts` and run on `node:test`.

## Differences from upstream

- Node.js only: the random bytes come from `node:crypto` (upstream also tries the Web Crypto API, then a fallback set
  with `setRandomFallback()`, which is dropped).
- Promise API only: `genSalt()`, `hash()` and `compare()` return promises (the callbacks are dropped; the optional
  progress callback of `hash()` and `compare()` is kept). The synchronous functions are unchanged.
- Typed: the byte arrays accept any array-like of numbers (the random bytes are a Buffer); `genSaltSync()` has no
  unsupported `seed_length` parameter; the constants are in `constants.ts`.
- The Blowfish state always uses typed arrays (upstream falls back to plain arrays without `Int32Array`); the crypt
  state is an object instead of closure variables. The algorithm, the chunked asynchronous rounds (100 ms at a time),
  the error messages and the outputs are unchanged.
- Test adaptations: the callbacks are promises; the compatibility tests compare with fixed hashes (the OpenBSD test
  vectors, and hashes computed by the upstream implementation, which upstream checks against the native `bcrypt`
  package) instead of the native package; the UMD build test is dropped (no UMD build). Added: illegal arguments.

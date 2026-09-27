# Validation engine: upstream provenance

The validation engine is lakutata's own TypeScript module. It is derived from the projects below, which are not
dependencies of lakutata. License texts: `THIRD_PARTY_NOTICES.md` in the package root.

The file headers name "the upstream" file a module is derived from (or a test is ported from): it is the file of the
upstream project of the module's directory in the table below, at the listed version unless the header gives a commit.
The engine's code, messages and documentation do not name these projects; this file and the license notices do. The
directories of the utilities are named after what they do (upstream: hoek, pinpoint, formula, topo), and so are the
identifiers; the expression errors start with `Expression` (upstream: `Formula`).

| Directory | Upstream | Version | Commit | Scope |
|---|---|---|---|---|
| `utils/` | [hapijs/hoek](https://github.com/hapijs/hoek) | 11.0.7 | 40e7940363febdb4d427d57c88eba96accdcc0e1 | applyToDefaults, assert, AssertError, clone, deepEqual, escapeHtml, escapeRegex, ignore, merge, reach, stringify (+ internal types, utils) |
| `location/` | [hapijs/pinpoint](https://github.com/hapijs/pinpoint) | 2.0.1 | b0497deca07051ed6911baa52ff97bd5e994b9ce | location |
| `expression/` | [hapijs/formula](https://github.com/hapijs/formula) | 3.0.2 | f173633232250d222548489a0b85f94c07ad2258 | Parser |
| `sorter/` | [hapijs/topo](https://github.com/hapijs/topo) | 6.0.2 | 3c4ee008ec9f719b0992ba06feb35c24b57787d7 | Sorter |
| `tlds/` | [hapijs/tlds](https://github.com/hapijs/tlds) | 1.1.4 | 2c9410a8cb6dcb5a0c1d329a4359074b10151582 | tlds (IANA list, version 2025102200) |
| `address/` | [hapijs/address](https://github.com/hapijs/address) | 5.1.1 | f23e252d821644b4422220a2482d6f832aaf49ed | domain, email, ip, uri, decode, errors |
| `schema/` | [hapijs/joi](https://github.com/hapijs/joi) | 18.0.2 | 481e270e6c4ff8728d6fda248fd83f6ff70f7ed9 | the whole library (lib/, lib/types/) |
| `schema/extensions/bigint.ts` | [softstackhq/joi-bigint](https://github.com/softstackhq/joi-bigint) | 1.1.1 | a3db89f8baf264f44b2c09f8baa2c37d00cca942 | the bigint extension (src/index.ts, src/types.ts) |
| `json-schema/` | [kenspirit/joi-to-json](https://github.com/kenspirit/joi-to-json) | 5.0.0 | c2bfe68698397e9f2391b2e145bb38ae76d1b97a | the whole library (index.js, lib/parsers/) |
| `json-schema/combinations.ts` | [jgallen23/combinations](https://github.com/jgallen23/combinations) (npm package) | 1.0.0 | (npm tarball) | index.js |

Tests are ported from the upstream suites into `src/tests/engine` and run on `node:test` (the jest suites of
joi-bigint and joi-to-json included); the assertion
library is ported from [hapijs/code](https://github.com/hapijs/code) 9.0.3 (425043e302090e541f569ee37d8dd4c0444a9cf4).

## Rules

- The first rewrite of a module keeps the upstream behavior exactly (the ported upstream tests must pass unchanged).
  Behavior changes are separate, documented commits.
- No `any`: `npm run test:engine-types` type-checks the engine with `noImplicitAny` and rejects every explicit `any`
  without an `any-justified: <reason>` comment.

## Differences from upstream

### utils (hoek)
- Node.js only (>= 22): the runtime existence checks for `Buffer` and `structuredClone` are dropped.
- Typed with `unknown` instead of `any` (`reach()` returns `unknown`, `deepEqual()` takes `unknown`); `isArray()`
  narrows to `unknown[]`.
- Known upstream quirk kept for now: in `reach()`, a negative index on a Set yields `NaN` (it reads the Set's missing `length`).

### location (pinpoint)
- `location()` calls `Error.captureStackTrace()` without a constructor, like upstream (which passed its non-function
  `this`), so the frame of `location()` itself stays in the stack and depths are unchanged.
- Test adaptation: upstream asserts a hard-coded line number and an @hapi/lab frame; the ported test compares with an
  Error created on the same line instead.

### expression (formula)
- Operand values are `unknown`; arithmetic keeps JavaScript's runtime coercion (the `number` casts only satisfy the
  type checker).
- A function reference is replaced by a new part object instead of mutating the reference part in place.

### sorter (topo)
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
  - Upstream's internal module helpers (`internals.x`) are module-level functions; a few are renamed where a local
    variable of the same name would shadow them (the rewritten files note the upstream name).
  - Types widened to what upstream accepts at runtime: `RefOptions.prefix` may be `false`; the cache takes any value
    as key (only primitives are cached); `assertOptions()` also takes a single key (matched as a substring).
- Behavior changes after the rewrite:
  - The Standard Schema vendor of the schemas is `'lakutata'` (upstream: `'joi'`).
  - Nothing refers to joi anymore (the engine is lakutata's): internal names follow the engine (the root object
    is `Engine`, the tracer is named `'lakutata'`), and the messages are reworded: `object.refType` "must be a
    reference", `object.schema` "must be a schema of {type} type", "Cannot mix different versions of validation
    schemas", "Must be invoked on a validation root.", "Object schema cannot be a schema object", "adjuster function
    failed to return a schema"; joi-to-json's "Not a schema object.". The ported tests expect the new messages.
  - Validation errors have no `isJoi` property (they are identified by `isError()`), the tracer has no @hapi/lab
    coverage hook, and schemas are marked with `Symbol.for('@lakutata/validation/schema')` (upstream: the joi marker
    shared by all joi versions), with the engine's own schema format version `'1.0.0'` (upstream: the joi release):
    engine schemas and joi schemas no longer recognize each other.
  - The errors are framework exceptions (`src/lib/validation/exceptions`, subclasses of `SchemaException`, itself a
    subclass of the framework `Exception`): a failed validation is a `SchemaValidationException` (upstream:
    `ValidationError`; its name is the class name, as for all framework exceptions), an invalid definition (rule
    arguments, options, templates, references, key dependencies) is a `SchemaDefinitionException` (upstream: hoek's
    `AssertError`, or the errors of topo and formula; the schema engine asserts with its own `assert()`, and converts
    the errors of the utilities it calls, keeping them as `cause`), and a JSON Schema conversion error is a
    `SchemaConversionException`. Messages are unchanged; errors thrown by user code pass through unchanged.
  - Added (lakutata's own): the numeric type rules of `number()`: `int8()`, `uint8()`, `int16()`, `uint16()`,
    `int32()`, `uint32()`, `int64()`, `uint64()` (the 64-bit ranges are limited to the safe integers), `float()` (the
    32-bit floating point range) and `double()` (every finite number); `float()` and `double()` set `unsafe()`.
  - The length rules of `string()` (`min()`, `max()`, `length()` without an encoding) and `truncate()` count Unicode
    code points (upstream: UTF-16 code units), like JSON Schema: a surrogate pair is one character.
  - Added (lakutata's own, for the constructs of JSON Schema): `object().unknown(schema)` (the unknown keys are
    allowed and must match the schema; the flag holds the schema), `object().keyNames(schema)` (every key name must
    match), `array().has(schema, {min, max})` (the number of matching items; without options `has()` is unchanged)
    and `alternatives().match('none')` (the value must match none of the alternatives); `any().allOf(...schemas)`
    (the value must also match every schema; its errors are theirs, the value is kept) and `string().format(name)`
    (the string formats of JSON Schema, in `schema/formats.ts`, validated like the full formats of ajv-formats).
- Fixes:
  - `alternatives().match('all')` with object alternatives merges the matched values only when they are all plain
    objects (not arrays), into a new object with the prototype of the first one. Upstream merges into the first matched
    value, which may be the validated value itself (an array it matches is emptied: hoek's merge truncates the target
    before copying the source, the same array), and merges the `null` of an object schema allowing it (and throws hoek's
    merge assertion).
- Performance changes (same behavior, covered by `src/tests/engine/schema/Caching.spec.ts`):
  - The validation settings (defaults merged with the validate() options) are reused for options which cannot change:
    frozen, with primitive values only. Upstream merges them on every validation.
  - The preferences of a schema merged with its parent preferences are cached by parent preferences (upstream caches
    only the merge with the default preferences), and `$_match()` reuses its abort-early copy of the preferences.
    Merged preferences are never mutated, so they can be shared.
  - The fast path (`schema/fastpath.ts`, lakutata's own): a schema made of common constructs (any, string, number,
    boolean, date; objects with keys and patterns; arrays with one item schema and ordered items; try alternatives;
    custom rules marked as pure) is compiled, per validation settings, into closures which validate without the
    per node states, helpers and results of the interpreter. It only produces successful results: on an error it
    returns INVALID and on anything it does not decide FALLBACK, and the interpreter then validates the value. The type,
    coercion and rule functions of the types are called as they are. `npm run test:fastpath` runs the ported suites in
    its verify mode (both validate, a different result fails), and `src/tests/engine/schema/FastPath.spec.ts` fuzzes it
    against the interpreter. Known difference: when it falls back, getters of the value are read once more.
- Test adaptations (the rest of the 27 upstream test files is kept line by line, with the engine's names):
  - The `isJoi` checks are `isError()` checks.
  - The names of validation errors are `SchemaValidationException` (upstream: `ValidationError`).
  - A URI test value naming the upstream repository is replaced by another repository URL of the same form.
  - `@hapi/bourne` parse is replaced by `JSON.parse` (the parsed inputs contain no prototype keys).
  - hoek's `wait()` (not part of the engine) is provided locally in the validator tests.
  - A schema of another version is simulated through the shared version marker (the only thing the engine inspects);
    the two tests compiling v15 schemas are skipped: they need the compiler of an older joi release.
  - The annotate test reads the function source at runtime instead of hard-coding it.
  - Tracer tests: `__filename` comes from the stack (ESM), and expected lines are looked up in the compiled file
    because the TypeScript compiler drops the blank lines the upstream offsets rely on.
  - The stack test matches the ESM frame name of `process()` (`Module.process`) instead of `exports.process`.
  - Added (not in upstream): the inclusive boundaries of `number().port()`.
  - The Standard Schema vendor test expects `'lakutata'`.
  - The extension test defining a value changing number rule names it `twice` (upstream: `double`, now a rule of
    `number()`).

### joi-bigint
- Typed with the engine's types (`BigIntSchema` extends `AnySchema`); `BigIntSchema<T>` keeps its (unused) type
  parameter for compatibility with the upstream type.
- Test adaptations: jest's `toHaveProperty('error')` is checked with `'error' in result`; `toBeTruthy()` on booleans
  with `to.be.true()`.

### joi-to-json
- lodash and combinations are no longer dependencies: `helpers.ts` implements the lodash 4.17.21 functions the parsers
  use with lodash's semantics (merge follows lodash's algorithm: null replaces, undefined does not replace an existing
  key, arrays merge by index, cycles are handled); `combinations.ts` is the combinations package.
- Fixes after 5.0.0:
  - A `when()` switch (or `conditional()` switch) which yields a single schema threw `ReferenceError: oneOf is not
    defined` (upstream, still on its master, merges an undeclared variable): the single schema is merged, like the
    single branch of a condition.
  - From upstream 5.0.1 (61fde575b289e4b30ca987f01f2314a2d633c064): converting a condition removes only the `if-style`
    meta, not all the metas (the filter compared `typeof` with `undefined` instead of `'undefined'`); its test data
    changes are ported too.
  - Also ported from upstream after 5.0.1, each with its test changes:
    - 8dd0d57: the unknown keys unit test.
    - 2c2d6b0 (5.0.2): the `not` schema of invalid values no longer repeats the type (test data from a4a7275).
    - a4a7275 (5.0.3): OpenAPI 3.0 schemas keep `example` and drop `examples`.
    - 79228c3 (5.0.4): OpenAPI 3.0 keeps only the known keys of every schema, the shared ones (by id) included; the
      unreachable const branch reads the schema (upstream reads its former variable).
    - 92d3a44 (5.0.5): OpenAPI 3.0 has no `null` type: a null only schema becomes a nullable object, and the type
      branches (anyOf) of a nullable schema are each nullable.
  - With these, the parsers, the unit tests and the test data are at parity with upstream master
    (92d3a44b605a3309aa7e4dc96582296b51a0afd6, 5.0.5), plus the single branch switch fix above.
- Tests: the unit, baseline and parser suites are ported; their JSON data files are copied as is into
  `src/tests/engine/json-schema/data` (read from the source tree, not published). jest's `toEqual()` (which ignores
  undefined properties) is reproduced by the test support, `toBeTruthy()`/`toBeFalsy()` by boolean checks. The
  generated schemas are still checked with ajv 8 (a test-only devDependency, like upstream).
- Added (not in upstream): `array().unique()` conversion, the single branch switch, and the lodash semantics of
  the helpers.
- Conversion semantics (lakutata's own, after the parity above): a converted JSON Schema describes the values the
  schema accepts without conversion, so it can validate data like the engine (with ajv, and the other validators).
  What has no JSON Schema equivalent is dropped, so a JSON Schema never rejects a value the schema accepts; the parser
  tracks what it drops (`isExact()`), and a negated subschema which is not exact (`not`, `oneOf`, an `if` condition)
  is loosened instead of negated. `src/tests/engine/json-schema/Fidelity.spec.ts` verifies both properties with ajv on
  random schemas and values of every version. Known limits: formats are named after the rules (their implementations
  differ on edge cases), numbers beyond the safe integers are accepted, and `when()` conditions are converted as
  conjunctions (the engine concatenates them to the schema).
  - Values: `valid()` values are the only accepted values (upstream keeps the type and the rules, which do not apply to
    them); case-insensitive values match a case-insensitive pattern; `allow()` values are accepted besides the values
    of the schema (null by the type when the schema has one, the others with anyOf; upstream only handles null); the
    values of objects are unwrapped; references drop the values.
  - Strings are not empty (`minLength: 1`) unless the empty string is allowed or the minimum length is zero; the
    length rules are merged (the tightest), `length()` converts, lengths in bytes are dropped; patterns with flags,
    and patterns which are not valid Unicode regular expressions, are dropped; inverted patterns are negated;
    `alphanum()`, `token()`, `hex()` and `trim()` convert to patterns; IP addresses with a CIDR prefix accept an
    address pattern besides the formats; URIs with relative references are `uri-reference`.
  - Numbers: the integer types, `port()`, `float()` and the signs convert to integer types and bounds (the tightest,
    exclusive bounds without the redundant inclusive ones); references drop the bounds; OpenAPI names the formats
    `int32`, `int64`, `float` and `double`; big integers are integers.
  - Objects: an object without keys accepts every key (the engine does not check them; upstream applies the unknown
    keys handling); the unknown keys are accepted by the validation preferences (the parser option `preferences`) or
    the flag, stripped keys included, or match the schema of `unknown(schema)`; a pattern applies to the keys which
    are not defined keys and which no previous pattern (without fallthrough) matched, like the engine (upstream also
    adds the patterns as properties); patterns the JSON Schema cannot express accept every unknown key; the key count
    rules convert (not the ones the stripped keys or the defaults change); `keyNames()` converts to propertyNames;
    the dependencies of nested keys, and of stripped keys, are dropped. Draft 07 converts `with()` to `dependencies`
    (upstream: `dependentRequired`, a 2019-09 keyword).
  - Arrays: ordered items convert (items arrays and additionalItems, or prefixItems in 2020-12; OpenAPI 3.0 lists
    them in anyOf); `has()` counts convert to minContains/maxContains (2019-09 and later); `single()` accepts a value
    of the items.
  - Conditions on references are anyOf of the branches (upstream: oneOf, which rejects a value of both branches);
    `match('none')` converts to `not`.
  - Types: function and symbol schemas match no JSON value; links outside the shared schemas and unknown types accept
    every value; timestamps are numbers (upstream: integers); binary strings have no format in JSON Schema (OpenAPI:
    `binary`); OpenAPI 3.0 converts `any()` to a schema without type (upstream lists the types, as anyOf branches).
  - Defaults and examples are only kept when they are JSON values. The preferences of a schema are merged with the
    inherited ones (upstream uses them instead).
  - Added: JSON Schema 2020-12 (`json-2020-12`), the base of OpenAPI 3.1 (upstream: 2019-09); the engine additions
    convert (`format()`, `allOf()`, `keyNames()`, `unknown(schema)`, `has()` counts, `match('none')`); a minimum
    string length of zero is not written.
- The import (`json-schema/import.ts`, lakutata's own, not from upstream): JSON Schemas (drafts 04 to 2020-12) and
  OpenAPI 3.0/3.1 schema objects become schemas which validate like JSON Schema (without conversion, the formats like
  ajv-formats, the $ref siblings applied like ajv does in every version). References resolve by JSON pointer, anchor
  and $id (recursive ones become shared schemas and links); unevaluatedProperties/unevaluatedItems are evaluated with
  the subschemas which match the value. `src/tests/engine/json-schema/ImportFidelity.spec.ts` verifies it against ajv
  on random JSON Schemas and values of every version (except where ajv diverges from the specification: contains with
  ordered items, and contains with unevaluatedItems).
  - Tests: the expected parser outputs of the ported data are regenerated with these semantics (the 2020-12 parser has
    the cases of the 2019-09 parser), the ported unit tests expect them (non-empty strings, exclusive bounds, anyOf
    conditions, draft 07 dependencies, and non-empty strings in their data).

# The vendored SQLite

`native/engine/engine.c` and `engine.h` are the amalgamation of SQLite 3.53.2 (its `sqlite3.c` and `sqlite3.h`),
unchanged but for their names: `vendor/UPSTREAM.json` records its archive, which file of the archive each one is, and
the checksums of the archive and of the two files, which the tests check. The version is not upgraded.

What the addon changes is outside these files:

- the compile-time options in `binding.gyp` (the target `store`);
- `native/store.c`, which includes the amalgamation and reaches its b-tree layer directly, without the SQL statements,
  for the reads and the writes of the documents. Its notes list the internal functions it uses and the preconditions
  of them found along the way.

# The vendored ICU

`vendor/icu/` holds the part of ICU 77.1 (the version Node.js 24 ships) that the collators use, unchanged:

- `source/`: 99 source files and 168 headers from `common`, `i18n` and `stubdata` in the release's source archive.
  `vendor/UPSTREAM.json` records the archive, its checksum and each file's checksum, which the tests verify.
- `icudt77l.dat`: the collation data, built from the release's data archive (see below).
- `LICENSE`: ICU's license, from the source archive.

The source files were chosen by compiling all of `common` and `i18n` with the defines in `binding.gyp` (targets
`icu_common`, `icu_i18n`), linking them into a program that makes the same ICU calls as `native/collation.cc`, and
stripping unused code (`-Wl,-dead_strip -Wl,-map`). The files whose objects survived are the ones vendored; the headers
are those they include (`clang -MM`). Phase 6 checks that this list also builds on Linux and Windows.

The data is built from `icu4c-77_1-src.tgz` and `icu4c-77_1-data.zip` (rebuilt on 2026-11-06, byte for byte the same):

1. extract the source archive and replace its `icu/source/data` with the `data` directory from the data archive;
2. in `icu/source`, run `ICU_DATA_FILTER_FILE=<path to vendor/icu/filter.json> ./runConfigureICU MacOSX
   --enable-static --disable-shared --disable-tests --disable-samples --disable-extras --disable-icuio
   --disable-layoutex --with-data-packaging=archive` (or the platform of the build machine in place of `MacOSX`), then
   `make`;
3. the result is `data/out/icudt77l.dat` (little-endian, the byte order of every platform the package builds for).

`filter.json` keeps the collation rules of every locale and of the root (`coll_ucadata`, `coll_tree`), the
normalization data, the core character properties (`unicore`) and `misc` (the likely-subtags data the collators need to
open a locale).

What the addon changes is outside these files:

- the compile-time defines in `binding.gyp`: functions and classes renamed with the suffix `_mde` (`ucol_open_77_mde`,
  namespace `icu_77_mde`) and hidden, so the ICU built into Node.js or Electron in the same process cannot be confused
  with them; the parts the collators do not use (conversion, formatting, break iteration, file access...) compiled out;
- `native/collation.cc` hands ICU its data (`udata_setCommonData`), which the JavaScript side reads from
  `vendor/icu/icudt77l.dat`.

The version is not upgraded: collation indexes store sort keys, and another ICU version could order them differently.

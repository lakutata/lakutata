# The vendored SQLite

`vendor/sqlite/sqlite3.c` and `sqlite3.h` are the amalgamation of SQLite 3.53.2, unchanged: `vendor/UPSTREAM.json` records
its archive and the checksums of the archive and of the two files, which the tests check. The version is not upgraded.

What the addon changes is outside these files:

- the compile-time options in `binding.gyp` (the target `store`);
- `native/store.c`, which includes the amalgamation and reaches its b-tree layer directly, without the SQL statements,
  for the reads and the writes of the documents. Its notes list the internal functions it uses and the preconditions
  of them found along the way.

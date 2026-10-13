# The source of TypeORM

This directory holds the source of [TypeORM](https://typeorm.io) (MIT, see `LICENSE`) which `@lakutata/orm` is built on,
at the tag recorded in `UPSTREAM.json`:

- the package `typeorm` (`packages/typeorm/src` of its repository), at the root of the directory;
- the package `@typeorm/legacy-naming-strategies` (`packages/legacy-naming-strategies/src`), in
  `legacy-naming-strategies`, its imports of `typeorm` rewritten to the source beside it.

The package builds it with its own TypeScript options into `dist/typeorm` (CommonJS), and imports it as `#typeorm/...`.
lakutata does not lint it: its style is TypeORM's.

## Changing it

- Keep the changes small and apart from the source of TypeORM where possible: a new driver in new files, a change of a
  file of TypeORM marked with a `lakutata:` comment.
- Commit them apart from the upgrades: an upgrade commit holds the source of TypeORM only.

## Upgrading it

```shell
node scripts/typeorm/sync.mjs <tag>
```

The script merges each file three ways: the source of the tag of `UPSTREAM.json` (the base), this directory (ours), the
source of the new tag (theirs). A file lakutata did not change takes the new one; a file TypeORM did not change keeps
ours; a file both changed is merged by `git merge-file`, its conflicts left in it with their markers. A file removed on
one side and changed on the other keeps ours, the new one written beside it as `<file>.typeorm-<tag>`. The conflicts are
listed and the script exits with 1. Resolve them, build and test the package, then commit the upgrade.

Before a real upgrade, `--target <directory>` tries it on a copy of this directory.

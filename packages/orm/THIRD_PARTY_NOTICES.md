# Third-party notices

Parts of `@lakutata/orm` are derived from the third-party projects listed below; the original copyright notices and
license terms are reproduced here as required.

## TypeORM 1.1.2

The source of TypeORM, its packages `typeorm` and `@typeorm/legacy-naming-strategies`
(https://github.com/typeorm/typeorm, the tag and commit in `vendor/typeorm/UPSTREAM.json`): `vendor/typeorm/` of the
repository, built into `dist/vendor/typeorm`.

Modifications: the imports of `typeorm` of the legacy naming strategies rewritten to the source beside them; the changes
of lakutata marked with `lakutata:` comments in the source. The command line of TypeORM (`cli.ts`,
`commands/*Command.ts`) is not built.

Its license is the MIT License of TypeORM reproduced below.

## TypeORM 0.3.24

The generation of the migrations: `src/providers/migration/GenerateMigration.ts`, rewritten in TypeScript from the
command `typeorm migration:generate` (`src/commands/MigrationGenerateCommand.ts`).

Modifications: a provider of the application, run when the environment variable `MIGRATION_GENERATE` is set, for each
Database component or provider; the migrations import their types from `@lakutata/orm` or `lakutata/orm`.

```
The MIT License

Copyright (c) 2015-2025 TypeORM. http://typeorm.github.io

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

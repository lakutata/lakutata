# Lakutata 迁移

`synchronize: true` 会在每次连接数据库时，让表结构与实体保持一致：开发时很方便，但在生产环境中并不安全，比如重命名的列会连同数据一起被删掉。生产环境中的表结构通过**迁移**来变更：每个迁移是一个类，只做一处变更，按顺序执行，并记录在数据库中，保证每个迁移只执行一次。

## 1. 一个迁移

迁移实现 `lakutata/orm` 中的 `MigrationInterface`。`up()` 执行变更，`down()` 撤销变更：

```typescript
import type {MigrationInterface, QueryRunner} from 'lakutata/orm'

export class AddBookAuthor1792161460658 implements MigrationInterface {
    public name: string = 'AddBookAuthor1792161460658'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "books" ADD "author" character varying')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "books" DROP COLUMN "author"')
    }
}
```

- 迁移的名字以毫秒时间戳（13 位数字）结尾：迁移按时间戳的顺序执行。两个迁移同名会报错。
- 数据库的 `migrations` 选项列出迁移：迁移类，或者编译后文件的 glob（相对于工作目录）。

  ```typescript
  import {buildDatabaseOptions} from 'lakutata/com/database'

  export const db = buildDatabaseOptions({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [],
      migrations: ['build/migrations/*.js']
  })
  ```

- 已执行的迁移记录在名为 `migrations` 的表中（`migrationsTableName` 可以改名）。每个迁移只执行一次，即使它的时间戳早于最后执行的那个迁移。

## 2. `lakutata` 命令

用 `lakutata` 创建的项目自带迁移相关的脚本：

```bash
npm run migration:generate          # 根据实体的变化生成迁移
npm run migration:create -- seed    # 一个空迁移，src/migrations/<时间戳>-seed.ts
npm run migration:run               # 执行待执行的迁移
npm run migration:show              # 列出已执行和待执行的迁移
npm run migration:revert            # 撤销最后执行的迁移
```

这些脚本调用 `lakutata migration <action>`：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `--dir` | `src/migrations` | 写入迁移的目录（`generate`、`create`） |
| `--script` | `dev` | 构建并启动应用的 npm 脚本 |
| `--database` | 所有数据库 | 命令针对的数据库；有多个数据库时，撤销必须指定 |
| `--transaction` | 数据库的 `migrationsTransactionMode` | `all`、`each` 或 `none`（第 6 节） |
| `--fake` | `false` | 只把迁移记录为已执行（或已撤销），不真正执行 |
| `--package` | 当前目录 | 在工作区的哪个包中执行命令 |

`create` 只写一个空迁移，不启动应用。其他操作会带着第 3 节的环境变量运行应用的 npm 脚本：命令由应用自己完成。

## 3. 应用的迁移命令

带着下面某个环境变量启动的应用不会正常启动，而是执行命令：它读取自己的选项，连接数据库，执行命令，然后退出。它的 `bootstrap` 和 `onLaunched` 回调都不会执行，也不会启动任何服务。

| 变量 | 命令 |
|---|---|
| `MIGRATION_GENERATE=<目录>` | 把实体与表之间的差异写成一个迁移（第 4 节） |
| `MIGRATION_RUN=1` | 执行待执行的迁移 |
| `MIGRATION_REVERT=1` | 撤销最后执行的迁移 |
| `MIGRATION_SHOW=1` | 列出选项中的迁移：已执行（`[X]`）和待执行（`[ ]`） |
| `MIGRATION_DATABASE=<名字>` | 命令针对的数据库：它的组件或提供者的名字（默认所有数据库） |
| `MIGRATION_TRANSACTION=all\|each\|none` | `MIGRATION_RUN` 和 `MIGRATION_REVERT` 使用的事务方式（第 6 节） |
| `MIGRATION_FAKE=1` | 只把迁移记录为已执行（或已撤销），不真正执行 |

```text
$ MIGRATION_SHOW=1 node build/App.js
[db] [ ] Migrations1792161460658
[db] 1 pending migration
$ MIGRATION_RUN=1 node build/App.js
[db] Migration Migrations1792161460658 has been run
$ MIGRATION_REVERT=1 node build/App.js
[db] Migration Migrations1792161460658 has been reverted
```

- 开关变量的值为 `1`、`true` 或 `yes` 时才生效：`MIGRATION_RUN=0` 会让应用照常启动。
- 命令作用于选项顶层（`components`、`providers`）声明的 `Database` 组件和提供者，每个数据库以它的键作为名字。
- 命令成功时退出码为 0，失败时为 1。有多个数据库时，`MIGRATION_REVERT` 需要 `MIGRATION_DATABASE`。

## 4. 生成迁移

`MIGRATION_GENERATE` 比较实体与数据库中的表，把差异的 SQL 写成一个迁移：

```text
$ MIGRATION_GENERATE=src/migrations node build/App.js
Migration /home/app/src/migrations/1792161460658-db.ts has been generated successfully.
```

```typescript
import { MigrationInterface, QueryRunner } from "lakutata/orm";

export class Migrations1792161460658 implements MigrationInterface {
    name = 'Migrations1792161460658'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "books" (
                "id" SERIAL NOT NULL,
                "title" character varying NOT NULL,
                CONSTRAINT "PK_f3f2f25a099d24e12545b70b022" PRIMARY KEY ("id")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP TABLE "books"
        `);
    }

}
```

- 数据库必须能连上，并且已经执行了已有的迁移：差异是根据它当前的表计算的。
- 文件是 `<目录>/<时间戳>-<数据库名>.ts`，类名取自目录（`src/migrations` 得到 `Migrations<时间戳>`），是 TypeScript 文件。随应用一起编译：`migrations` 选项列出的是编译后的文件。
- 执行迁移之前先读一遍：重命名的属性会变成删除一列再新增一列，旧列的数据会丢失。必要时修改其中的 SQL。
- 没有任何变化时，命令什么都不写，并以退出码 1 退出（`No changes in database schema were found`）。
- 有多个数据库时，每个表结构有差异的数据库各自生成一个文件。给每个数据库的 `migrations` 选项只列出它自己的文件（`'build/migrations/*-db.js'`），否则各个数据库会执行彼此的迁移。

## 5. 启动时执行迁移

除了使用命令，数据库也可以在每次连接时执行待执行的迁移，只要设置 `migrationsRun: true`。此时的顺序是：`dropSchema`（如果设置了），迁移，然后是 `synchronize`（如果设置了）。

- `Database` 组件只连接一次：列在 `bootstrap` 里时，它在应用启动过程中执行迁移。
- `Database` 提供者每次被解析时都会连接，所以每次都会检查迁移。

组件和提供者还有 `runMigrations({transaction, fake})`、`undoLastMigration({transaction, fake})` 和 `showMigrations()`（返回是否有待执行的迁移）三个方法。

## 6. 事务

数据库的选项 `migrationsTransactionMode`，或者单次命令的 `MIGRATION_TRANSACTION`：

| 方式 | 待执行的迁移…… |
|---|---|
| `all`（默认） | 在同一个事务中执行：失败时全部撤销 |
| `each` | 各自在自己的事务中执行：失败时保留之前已执行的迁移 |
| `none` | 不使用事务 |

- 在 `each` 和 `none` 方式下，迁移可以设置自己的 `transaction` 属性（`true` 或 `false`）；在 `all` 方式下这样做会报错。
- PostgreSQL 和 SQLite 在事务中执行表结构的变更。MySQL 和 MariaDB 会立即提交每一处表结构的变更：失败的迁移可能已经执行了一部分变更。

## 7. MongoDB

MongoDB 数据库（`mongodb`、`mongo-embedded`）没有可以比较的表结构：`MIGRATION_GENERATE` 不会为它们生成任何内容，它们的迁移需要手写。不支持 `queryRunner.query()`，要用 MongoDB 的实体管理器来完成工作：

```typescript
import type {MigrationInterface, MongoEntityManager, QueryRunner} from 'lakutata/orm'

export class RenameTitle1792161460700 implements MigrationInterface {
    public name: string = 'RenameTitle1792161460700'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const manager: MongoEntityManager = queryRunner.manager as MongoEntityManager
        await manager.updateMany('notes', {}, {$rename: {title: 'name'}})
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const manager: MongoEntityManager = queryRunner.manager as MongoEntityManager
        await manager.updateMany('notes', {}, {$rename: {name: 'title'}})
    }
}
```

MongoDB 不使用事务执行这些迁移：迁移失败时，之前已执行的迁移，以及它自己在失败前做出的变更，都会保留。

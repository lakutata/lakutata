# Lakutata 实体、查询与事务

实体、仓储、查询和事务都来自 [TypeORM](https://typeorm.io) 1：装饰器来自 `lakutata/decorator/orm`，其余 API 来自 `lakutata/orm`。本指南介绍常见的用法，每个选项的说明见 TypeORM 的文档。

## 1. 实体

实体是映射到一张表的类：

```typescript
import {
    BeforeInsert, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany,
    PrimaryGeneratedColumn, UpdateDateColumn, VersionColumn
} from 'lakutata/decorator/orm'

@Entity('orders')
export class Order {
    @PrimaryGeneratedColumn('uuid')
    public id: string

    @Index()
    @Column()
    public customer: string

    //随订单一起保存（级联）
    @OneToMany(() => OrderLine, (line: OrderLine) => line.order, {cascade: true})
    public lines: OrderLine[]

    @CreateDateColumn({type: 'timestamptz'})
    public createdAt: Date

    @UpdateDateColumn({type: 'timestamptz'})
    public updatedAt: Date

    //由 softDelete() 设置：除非设置了 withDeleted，查询会跳过这个订单
    @DeleteDateColumn({type: 'timestamptz'})
    public deletedAt: Date | null

    //每次保存加一
    @VersionColumn()
    public version: number

    @BeforeInsert()
    protected normalize(): void {
        this.customer = this.customer.trim()
    }
}

@Entity('order_lines')
export class OrderLine {
    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public product: string

    @Column('integer')
    public quantity: number

    @ManyToOne(() => Order, (order: Order) => order.lines, {onDelete: 'CASCADE'})
    @JoinColumn({name: 'order_id'})
    public order: Order
}
```

| 装饰器 | 用途 |
|---|---|
| `@Entity(name)`、`@ViewEntity`、`@ChildEntity`、`@TableInheritance` | 实体、视图、表的继承 |
| `@PrimaryGeneratedColumn(strategy)`、`@PrimaryColumn` | 主键：自动生成（`'increment'`、`'uuid'`、`'identity'`），或者手动给出 |
| `@Column(type, options)` | 列：类型、`length`、`nullable`、`default`、`unique`、`transformer`…… |
| `@CreateDateColumn`、`@UpdateDateColumn`、`@DeleteDateColumn`、`@VersionColumn` | 由 TypeORM 自动设置的列 |
| `@OneToOne`、`@OneToMany`、`@ManyToOne`、`@ManyToMany`、`@JoinColumn`、`@JoinTable` | 关系 |
| `@Index`、`@Unique`、`@Check` | 索引和约束 |
| `@BeforeInsert`、`@AfterLoad`、`@BeforeUpdate`…… | 在操作前后执行的方法 |
| `@ObjectIdColumn` | MongoDB 实体的 `_id` |

实体要列在每个使用它的数据库的 `entities` 选项中。实体也可以继承 `lakutata/orm` 中的 `BaseEntity`，从而自己保存和查询（`await Order.findOneBy({id})`、`await order.save()`）：这些操作使用最后一个连接了该实体的数据库。

## 2. 查询

仓储（`db.getRepository(Order)`）用来读写一张表中的实体：

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Database} from 'lakutata/com/database'
import {Column, CreateDateColumn, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'
import {Between, ILike, type Repository} from 'lakutata/orm'

@Entity('orders')
class Order {
    @PrimaryGeneratedColumn('uuid')
    public id: string

    @Column()
    public customer: string

    @CreateDateColumn({type: 'timestamptz'})
    public createdAt: Date
}

class Orders extends Component {
    @Inject('db')
    protected readonly db: Database

    protected get orders(): Repository<Order> {
        return this.db.getRepository(Order)
    }

    //某段时间内订单的一页，以及订单总数
    public async search(customer: string, from: Date, to: Date, page: number): Promise<[Order[], number]> {
        return await this.orders.findAndCount({
            where: {customer: ILike(`%${customer}%`), createdAt: Between(from, to)},
            order: {createdAt: 'DESC'},
            skip: (page - 1) * 20,
            take: 20
        })
    }

    //查询构造器
    public async byCustomer(customer: string): Promise<Order[]> {
        return await this.db.createQueryBuilder(Order, 'order')
            .where('order.customer LIKE :customer', {customer: `%${customer}%`})
            .orderBy('order.createdAt', 'DESC')
            .getMany()
    }

    //SQL：占位符在 PostgreSQL 上是 $1、$2……，在 MySQL 和 SQLite 上是 ?
    public async count(customer: string): Promise<number> {
        const rows: { count: string }[] = await this.db.query('SELECT COUNT(*) AS count FROM orders WHERE customer = $1', [customer])
        return Number(rows[0].count)
    }
}
```

- **查询：** `find`、`findBy`、`findOne`、`findOneBy`、`findAndCount`、`count`、`exists`；`findOneByOrFail` 什么都没找到时会抛出 `EntityNotFoundError`。
- **查询选项**使用对象：`where`、`relations: {lines: true}`、`select: {id: true, customer: true}`、`order: {createdAt: 'DESC'}`、`skip` 和 `take`、`withDeleted`。`where` 中给出条件列表表示 `OR`。
- **查询操作符**来自 `lakutata/orm`：`In`、`Not`、`IsNull`、`Like`、`ILike`、`Between`、`MoreThan`、`MoreThanOrEqual`、`LessThan`、`LessThanOrEqual`、`Any`、`ArrayContains`、`Raw`……
- **写入：** `save`（插入或更新，并按关系的级联设置一起保存）、`insert`、`update`、`delete`、`softDelete` 和 `restore`（需要 `@DeleteDateColumn`）、`increment`、`upsert`。
- **查询构造器**（`createQueryBuilder`）用来写查询选项表达不了的查询：带条件的连接、分组、子查询。它的值（`:customer`）作为参数传递，从不拼接进 SQL 文本。
- **SQL**（`query(sql, parameters)`）原样返回驱动给出的行：PostgreSQL 的 `COUNT(*)` 是字符串。

## 3. 事务

`transaction(fn)` 在事务中执行一个函数：函数成功时提交，失败时回滚，并重新抛出它的错误。事务中的每个操作都要通过传给函数的实体管理器执行；通过 `db.manager` 或 `db.getRepository()` 执行的操作不在事务中。

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Database} from 'lakutata/com/database'
import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'
import {type EntityManager} from 'lakutata/orm'

@Entity('accounts')
class Account {
    @PrimaryGeneratedColumn()
    public id: number

    @Column('integer')
    public balance: number
}

class Transfers extends Component {
    @Inject('db')
    protected readonly db: Database

    //两个更新要么都完成，要么都不完成
    public async transfer(from: number, to: number, amount: number): Promise<void> {
        await this.db.transaction('SERIALIZABLE', async (manager: EntityManager): Promise<void> => {
            await manager.decrement(Account, {id: from}, 'balance', amount)
            await manager.increment(Account, {id: to}, 'balance', amount)
        })
    }
}
```

- 隔离级别可以省略：`'READ UNCOMMITTED'`、`'READ COMMITTED'`、`'REPEATABLE READ'`、`'SERIALIZABLE'`。
- `createQueryRunner()` 提供一个独占的连接，用来手动控制事务（`startTransaction()`、`commitTransaction()`、`rollbackTransaction()`，最后 `release()`）。
- MongoDB 和嵌入式 MongoDB 没有事务：在它们上面，`transaction()` 会在没有事务的情况下执行函数。

## 4. 需要注意的值

- **大数。** PostgreSQL 和 MySQL 以字符串返回 `bigint` 和 `decimal` 列，以保持精度。SQLite 以数字返回它们，超过 2^53 时会丢失精度。如果数字就够用，可以用列的 `transformer` 转换：

  ```typescript
  import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'
  import type {ValueTransformer} from 'lakutata/orm'

  const decimal: ValueTransformer = {
      to: (value: number): number => value,
      from: (value: string | null): number | null => value === null ? null : Number(value)
  }

  @Entity('invoices')
  export class Invoice {
      @PrimaryGeneratedColumn()
      public id: number

      @Column({type: 'decimal', precision: 10, scale: 2, transformer: decimal})
      public total: number
  }
  ```

- **条件中的 `null` 和 `undefined`** 默认会被忽略：`findOneBy({id: undefined})` 会查到第一行。见 [Database](Database.md) 第 2 节。
- **日期。** 优先使用带时区的列（PostgreSQL 的 `timestamptz`）。在 MySQL 上，连接的 `timezone` 选项决定日期如何写入和读取。

## 5. 错误

错误都来自 TypeORM，由 `lakutata/orm` 导出：

| 错误 | 什么时候 |
|---|---|
| `QueryFailedError` | 数据库拒绝了查询。它的 `driverError` 是驱动的错误：在 PostgreSQL 上，代码 `23505` 表示重复键，`constraint` 是约束的名字 |
| `EntityNotFoundError` | `findOneByOrFail()` 和 `findOneOrFail()` 什么都没找到 |
| `EntityMetadataNotFoundError` | 实体不在数据库的 `entities` 中 |
| `OptimisticLockVersionMismatchError` | 加锁时 `@VersionColumn` 与期望的版本不一致 |
| `CannotExecuteNotConnectedError` | 在没有连接或已经断开的数据库上查询 |

```typescript
import {QueryFailedError} from 'lakutata/orm'

export function isDuplicate(error: unknown): boolean {
    return error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505'
}
```

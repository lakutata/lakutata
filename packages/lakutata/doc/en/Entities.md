# Lakutata Entities, Queries and Transactions

Entities, repositories, queries and transactions are those of [TypeORM](https://typeorm.io) 1: the decorators come from
`lakutata/decorator/orm`, and the rest of the API from `lakutata/orm`. This guide describes the common uses; TypeORM's
documentation covers every option.

## 1. Entities

An entity is a class mapped to a table:

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

    //Saved with the order (cascade)
    @OneToMany(() => OrderLine, (line: OrderLine) => line.order, {cascade: true})
    public lines: OrderLine[]

    @CreateDateColumn({type: 'timestamptz'})
    public createdAt: Date

    @UpdateDateColumn({type: 'timestamptz'})
    public updatedAt: Date

    //Set by softDelete(): the finds skip the order unless withDeleted is set
    @DeleteDateColumn({type: 'timestamptz'})
    public deletedAt: Date | null

    //Incremented by each save
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

| Decorators | Use |
|---|---|
| `@Entity(name)`, `@ViewEntity`, `@ChildEntity`, `@TableInheritance` | An entity, a view, table inheritance |
| `@PrimaryGeneratedColumn(strategy)`, `@PrimaryColumn` | The primary key: generated (`'increment'`, `'uuid'`, `'identity'`), or provided |
| `@Column(type, options)` | A column: its type, `length`, `nullable`, `default`, `unique`, `transformer`… |
| `@CreateDateColumn`, `@UpdateDateColumn`, `@DeleteDateColumn`, `@VersionColumn` | Columns set by TypeORM |
| `@OneToOne`, `@OneToMany`, `@ManyToOne`, `@ManyToMany`, `@JoinColumn`, `@JoinTable` | Relations |
| `@Index`, `@Unique`, `@Check` | Indices and constraints |
| `@BeforeInsert`, `@AfterLoad`, `@BeforeUpdate`… | Methods run around operations |
| `@ObjectIdColumn` | The `_id` of MongoDB entities |

An entity is listed in the `entities` option of each database that uses it. An entity may also extend `BaseEntity` (from
`lakutata/orm`) to save and find itself (`await Order.findOneBy({id})`, `await order.save()`): these methods use the
last database connected with the entity.

## 2. Queries

A repository (`db.getRepository(Order)`) reads and writes a table's entities:

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

    //A page of the orders of a period, and the count of all of them
    public async search(customer: string, from: Date, to: Date, page: number): Promise<[Order[], number]> {
        return await this.orders.findAndCount({
            where: {customer: ILike(`%${customer}%`), createdAt: Between(from, to)},
            order: {createdAt: 'DESC'},
            skip: (page - 1) * 20,
            take: 20
        })
    }

    //A query builder
    public async byCustomer(customer: string): Promise<Order[]> {
        return await this.db.createQueryBuilder(Order, 'order')
            .where('order.customer LIKE :customer', {customer: `%${customer}%`})
            .orderBy('order.createdAt', 'DESC')
            .getMany()
    }

    //SQL: the placeholders are $1, $2… on PostgreSQL, ? on MySQL and SQLite
    public async count(customer: string): Promise<number> {
        const rows: { count: string }[] = await this.db.query('SELECT COUNT(*) AS count FROM orders WHERE customer = $1', [customer])
        return Number(rows[0].count)
    }
}
```

- **Finding:** `find`, `findBy`, `findOne`, `findOneBy`, `findAndCount`, `count`, `exists`; `findOneByOrFail` throws
  an `EntityNotFoundError` when nothing is found.
- **Find options** take objects: `where`, `relations: {lines: true}`, `select: {id: true, customer: true}`,
  `order: {createdAt: 'DESC'}`, `skip` and `take`, `withDeleted`. A list of conditions in `where` is an `OR`.
- **Find operators** from `lakutata/orm`: `In`, `Not`, `IsNull`, `Like`, `ILike`, `Between`, `MoreThan`,
  `MoreThanOrEqual`, `LessThan`, `LessThanOrEqual`, `Any`, `ArrayContains`, `Raw`…
- **Writing:** `save` (inserts or updates, with relation cascades), `insert`, `update`, `delete`, `softDelete` and
  `restore` (with a `@DeleteDateColumn`), `increment`, `upsert`.
- **A query builder** (`createQueryBuilder`) writes queries that the find options cannot express: joins with conditions,
  groups, subqueries. Its values (`:customer`) are passed as parameters, never inserted into the SQL text.
- **SQL** (`query(sql, parameters)`) returns the driver's rows unchanged: a PostgreSQL `COUNT(*)` is a string.

## 3. Transactions

`transaction(fn)` runs a function in a transaction, which is committed when the function resolves and rolled back when
it rejects; the error is then thrown again. Every operation in the transaction goes through the entity manager passed to
the function; operations made through `db.manager` or `db.getRepository()` run outside it.

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

    //Both updates, or none
    public async transfer(from: number, to: number, amount: number): Promise<void> {
        await this.db.transaction('SERIALIZABLE', async (manager: EntityManager): Promise<void> => {
            await manager.decrement(Account, {id: from}, 'balance', amount)
            await manager.increment(Account, {id: to}, 'balance', amount)
        })
    }
}
```

- The isolation level is optional: `'READ UNCOMMITTED'`, `'READ COMMITTED'`, `'REPEATABLE READ'`, `'SERIALIZABLE'`.
- `createQueryRunner()` returns a dedicated connection, to control a transaction manually (`startTransaction()`,
  `commitTransaction()`, `rollbackTransaction()`, then `release()`).
- MongoDB has no transactions in TypeORM: there, `transaction()` runs the function without one. The embedded MongoDB
  runs it in its own transaction (see section 4 of [Embedded MongoDB](MongoEmbedded.md)).

## 4. Values to watch

- **Big numbers.** PostgreSQL and MySQL return `bigint` and `decimal` columns as strings, to keep their precision.
  SQLite returns them as numbers, which lose precision beyond 2^53. A column `transformer` converts them where a
  number is enough:

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

- **`null` and `undefined` in conditions** are left out of the condition by default: `findOneBy({id: undefined})`
  finds the first row. See [Databases](Database.md), section 2.
- **Dates.** Prefer columns with a time zone (`timestamptz` on PostgreSQL). On MySQL, the connection's `timezone` option
  determines how dates are written and read.

## 5. Errors

The errors come from TypeORM and are exported by `lakutata/orm`:

| Error | When |
|---|---|
| `QueryFailedError` | The database refused a query. Its `driverError` is the driver's error: on PostgreSQL, code `23505` is a duplicate key, and its `constraint` is the name of the constraint |
| `EntityNotFoundError` | `findOneByOrFail()` and `findOneOrFail()` found nothing |
| `EntityMetadataNotFoundError` | An entity that is not in the database's `entities` |
| `OptimisticLockVersionMismatchError` | A `@VersionColumn` did not match the version expected by a lock |
| `CannotExecuteNotConnectedError` | A query on a database that is not connected, or no longer is |

```typescript
import {QueryFailedError} from 'lakutata/orm'

export function isDuplicate(error: unknown): boolean {
    return error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505'
}
```

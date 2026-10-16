# Lakutata Entities, Queries and Transactions

The entities, the repositories, the queries and the transactions are the ones of [TypeORM](https://typeorm.io) 1: the
decorators come from `lakutata/decorator/orm`, the rest of the API from `lakutata/orm`. This guide shows the common
uses; the documentation of TypeORM describes every option.

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
| `@Entity(name)`, `@ViewEntity`, `@ChildEntity`, `@TableInheritance` | An entity, a view, the inheritance of tables |
| `@PrimaryGeneratedColumn(strategy)`, `@PrimaryColumn` | The primary key: generated (`'increment'`, `'uuid'`, `'identity'`), or given |
| `@Column(type, options)` | A column: its type, `length`, `nullable`, `default`, `unique`, `transformer`… |
| `@CreateDateColumn`, `@UpdateDateColumn`, `@DeleteDateColumn`, `@VersionColumn` | Columns set by TypeORM |
| `@OneToOne`, `@OneToMany`, `@ManyToOne`, `@ManyToMany`, `@JoinColumn`, `@JoinTable` | The relations |
| `@Index`, `@Unique`, `@Check` | Indices and constraints |
| `@BeforeInsert`, `@AfterLoad`, `@BeforeUpdate`… | Methods run around the operations |
| `@ObjectIdColumn` | The `_id` of the entities of MongoDB |

An entity is listed in the `entities` option of each database that uses it. An entity may also extend `BaseEntity` (from
`lakutata/orm`) to save and find itself (`await Order.findOneBy({id})`, `await order.save()`): these use the last
database connected with the entity.

## 2. Queries

A repository (`db.getRepository(Order)`) reads and writes the entities of a table:

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
- **The find options** take objects: `where`, `relations: {lines: true}`, `select: {id: true, customer: true}`,
  `order: {createdAt: 'DESC'}`, `skip` and `take`, `withDeleted`. A list of conditions in `where` is an `OR`.
- **The find operators** of `lakutata/orm`: `In`, `Not`, `IsNull`, `Like`, `ILike`, `Between`, `MoreThan`,
  `MoreThanOrEqual`, `LessThan`, `LessThanOrEqual`, `Any`, `ArrayContains`, `Raw`…
- **Writing:** `save` (inserts or updates, with the cascades of the relations), `insert`, `update`, `delete`,
  `softDelete` and `restore` (with a `@DeleteDateColumn`), `increment`, `upsert`.
- **A query builder** (`createQueryBuilder`) writes the queries the find options cannot: joins with conditions, groups,
  subqueries. Its values (`:customer`) are passed as parameters, never put into the SQL text.
- **SQL** (`query(sql, parameters)`) returns the rows of the driver as they are: a `COUNT(*)` of PostgreSQL is a string.

## 3. Transactions

`transaction(fn)` runs a function in a transaction: committed when the function resolves, rolled back when it
rejects, its error thrown again. Every operation of the transaction goes through the entity manager given to the
function; the ones made through `db.manager` or `db.getRepository()` run outside of it.

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
- `createQueryRunner()` gives a connection of its own, to control a transaction by hand (`startTransaction()`,
  `commitTransaction()`, `rollbackTransaction()`, then `release()`).
- MongoDB and the embedded MongoDB have no transactions: there, `transaction()` runs the function without one.

## 4. Values to watch

- **Big numbers.** PostgreSQL and MySQL return the `bigint` and `decimal` columns as strings, to keep their precision.
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

- **`null` and `undefined` in the conditions** are left out of the condition by default: `findOneBy({id: undefined})`
  finds the first row. See [Database](Database.md), section 2.
- **Dates.** Prefer the columns with a time zone (`timestamptz` on PostgreSQL). On MySQL, the `timezone` option of the
  connection tells how the dates are written and read.

## 5. Errors

The errors are the ones of TypeORM, exported by `lakutata/orm`:

| Error | When |
|---|---|
| `QueryFailedError` | The database refused a query. Its `driverError` is the error of the driver: on PostgreSQL, the code `23505` is a duplicate key, its `constraint` the name of the constraint |
| `EntityNotFoundError` | `findOneByOrFail()` and `findOneOrFail()` found nothing |
| `EntityMetadataNotFoundError` | An entity that is not in the `entities` of the database |
| `OptimisticLockVersionMismatchError` | A `@VersionColumn` did not match the version expected by a lock |
| `CannotExecuteNotConnectedError` | A query on a database that is not connected, or no longer is |

```typescript
import {QueryFailedError} from 'lakutata/orm'

export function isDuplicate(error: unknown): boolean {
    return error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505'
}
```

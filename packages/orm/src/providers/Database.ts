import {Configurable, Transient} from '@lakutata/core/decorator/di'
import {type DataSourceOptions} from 'typeorm/data-source/DataSourceOptions.js'
import {DataSource} from 'typeorm/data-source/DataSource.js'
import {Driver} from 'typeorm/driver/Driver.js'
import {EntityManager} from 'typeorm/entity-manager/EntityManager.js'
import {NamingStrategyInterface} from 'typeorm/naming-strategy/NamingStrategyInterface.js'
import {EntitySubscriberInterface} from 'typeorm/subscriber/EntitySubscriberInterface.js'
import {EntityMetadata} from 'typeorm/metadata/EntityMetadata.js'
import {EntityTarget} from 'typeorm/common/EntityTarget.js'
import {Migration} from 'typeorm/migration/Migration.js'
import {ObjectLiteral} from 'typeorm/common/ObjectLiteral.js'
import {TreeRepository} from 'typeorm/repository/TreeRepository.js'
import {Repository} from 'typeorm/repository/Repository.js'
import {MongoRepository} from 'typeorm/repository/MongoRepository.js'
import {QueryRunner} from 'typeorm/query-runner/QueryRunner.js'
import {SelectQueryBuilder} from 'typeorm/query-builder/SelectQueryBuilder.js'
import {ReplicationMode} from 'typeorm/driver/types/ReplicationMode.js'
import {QueryResultCache} from 'typeorm/cache/QueryResultCache.js'
import {IsolationLevel} from 'typeorm/driver/types/IsolationLevel.js'
import {Provider} from '@lakutata/core'
import {EntitySchema, type MixedList} from 'typeorm'
import {As} from '@lakutata/utils'
import {type MigrationRunOptions} from '../types/MigrationRunOptions.js'

/**
 * Build the registration of a {@link Database} provider, for the `providers` of the application options: the provider
 * class with its TypeORM connection options. Its `entities` option, added to the entities of the connection options,
 * is set by spreading the registration: `{...buildDatabaseOptions(options), entities: [User]}`.
 * @param options The TypeORM connection options (`DataSourceOptions`): the driver `type`, the connection settings, the
 * `entities`, the `migrations`, `synchronize`, `migrationsRun`, `logging`… Passed to TypeORM as they are.
 * @returns The registration `{class: Database, options}`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildDatabaseOptions} from 'lakutata/provider/database'
 * import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'
 *
 * @Entity()
 * class Report {
 *     @PrimaryGeneratedColumn()
 *     public id: number
 *
 *     @Column('text')
 *     public content: string
 * }
 *
 * Application.run(() => ({
 *     id: 'com.example.reports',
 *     name: 'Reports',
 *     providers: {
 *         //A new PostgreSQL connection each time reports is resolved, closed with its owner
 *         reports: {
 *             ...buildDatabaseOptions({type: 'postgres', url: 'postgres://postgres:secret@localhost:5432/reports'}),
 *             entities: [Report]
 *         }
 *     }
 * }))
 * ```
 */
export const buildDatabaseOptions: (options: DataSourceOptions) => {
    class: typeof Database
    options: DataSourceOptions
} = (options: DataSourceOptions) => ({
    class: Database,
    options: options
})

/**
 * A database connection of its own: a transient provider wrapping a TypeORM `DataSource`, with the API of the
 * `Database` component of `lakutata/com/database`.
 *
 * Register it in the `providers` of the application options with {@link buildDatabaseOptions}. Each resolution
 * (`@Inject('reports')`, `getObject('reports')`) creates a new instance, even within one scope: it opens its own
 * connection (its own pool) while it is created, and closes it when it is destroyed with the object or the container
 * which created it. It suits a short use (a job, a script, a tenant database); the requests of a busy application
 * share the `Database` component instead. A connection failure rejects its creation with the driver error.
 *
 * The entities of its `entities` option are added to the entities of its connection options.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildDatabaseOptions, Database} from 'lakutata/provider/database'
 * import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'
 *
 * @Entity()
 * class Report {
 *     @PrimaryGeneratedColumn()
 *     public id: number
 *
 *     @Column('text')
 *     public content: string
 * }
 *
 * Application
 *     .run(() => ({
 *         id: 'com.example.reports',
 *         name: 'Reports',
 *         providers: {
 *             reports: {
 *                 ...buildDatabaseOptions({type: 'postgres', url: 'postgres://postgres:secret@localhost:5432/reports', synchronize: true}),
 *                 entities: [Report]
 *             }
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         //A connection opened for this use, closed with the application
 *         const database: Database = await app.getObject('reports')
 *         await database.transaction(async (manager): Promise<void> => {
 *             await manager.save(Report, {content: 'Daily report'})
 *         })
 *         console.log(await database.getRepository(Report).count())
 *     })
 * ```
 */
@Transient()
export class Database extends Provider {

    /**
     * Load the provider generating the migrations of the database. The application calls it when it is started with
     * `MIGRATION_GENERATE`: the applications do not call it.
     * @returns The migration generator provider class.
     */
    public static migrationGenerator = async (): Promise<typeof Provider> => (await import('./migration/GenerateMigration.js')).GenerateMigration

    /**
     * Load the provider running, reverting or showing the migrations of the database. The application calls it when it
     * is started with `MIGRATION_RUN`, `MIGRATION_REVERT` or `MIGRATION_SHOW`: the applications do not call it.
     * @returns The migration executor provider class.
     */
    public static migrationExecutor = async (): Promise<typeof Provider> => (await import('./migration/ExecuteMigration.js')).ExecuteMigration

    #datasource: DataSource

    /**
     * The TypeORM connection options, given by the registration (see {@link buildDatabaseOptions}). Not validated by
     * lakutata: TypeORM checks them while connecting.
     */
    @Configurable()
    protected readonly options: DataSourceOptions

    /**
     * The entities added to the `entities` of the connection options: classes, `EntitySchema`s or glob paths of their
     * files. The migration commands of the application (`MIGRATION_GENERATE`…) read the connection options only, not
     * this option.
     * @default []
     */
    @Configurable()
    protected readonly entities: MixedList<Function | string | EntitySchema>

    /**
     * The TypeORM `DataSource` of the connection, for the subclasses needing what this class does not expose.
     */
    protected get datasource(): DataSource {
        return this.#datasource
    }

    /**
     * The TypeORM driver of the connection (PostgreSQL, MySQL, SQLite…).
     */
    public get driver(): Driver {
        return this.datasource.driver
    }

    /**
     * The entity manager of the connection: the TypeORM operations on any entity (`find`, `save`, `delete`…) outside a
     * transaction.
     */
    public get manager(): EntityManager {
        return this.datasource.manager
    }

    /**
     * Replace the naming strategy of the connection, which names the tables, the columns and the constraints of the
     * entities. Set it before the metadata is used: the names already built are not renamed.
     * @param instance The naming strategy.
     */
    public set namingStrategy(instance: NamingStrategyInterface) {
        this.datasource.namingStrategy = instance
    }

    /**
     * The naming strategy of the connection, which names the tables, the columns and the constraints of the entities.
     * @default TypeORM's `DefaultNamingStrategy`, unless the options set `namingStrategy`
     */
    public get namingStrategy(): NamingStrategyInterface {
        return this.datasource.namingStrategy
    }

    /**
     * The entity subscribers registered on the connection (the `subscribers` of the options).
     */
    public get subscribers(): EntitySubscriberInterface<any>[] {
        return this.datasource.subscribers
    }

    /**
     * The metadata of every entity registered on the connection.
     */
    public get entityMetadatas(): EntityMetadata[] {
        return this.datasource.entityMetadatas
    }

    /**
     * The metadata of every entity registered on the connection, by entity target (class, name or schema): the same as
     * {@link Database.entityMetadatas}, for fast lookups.
     */
    public get entityMetadatasMap(): Map<EntityTarget<any>, EntityMetadata> {
        return this.datasource.entityMetadatasMap
    }

    /**
     * The query result cache of the connection, `undefined` unless the options enable `cache`.
     */
    public get queryResultCache(): QueryResultCache | undefined {
        return this.datasource.queryResultCache
    }

    /**
     * Connect to the database with the options, their entities and the ones of the `entities` option.
     * @protected
     */
    protected async init(): Promise<void> {
        const entities: MixedList<Function | string | EntitySchema> = this.entities ? this.entities : []
        const options: DataSourceOptions = {
            ...this.options,
            entities: [...As<any[]>(this.options.entities ? this.options.entities : []), ...As<any[]>(entities)]
        }
        this.#datasource = await (new DataSource(options)).initialize()
    }

    /**
     * Disconnect from the database.
     * @protected
     */
    protected async destroy(): Promise<void> {
        await this.datasource.destroy()
    }

    /**
     * Create or update the database schema from the registered entities (the tables, columns, indices and foreign
     * keys). Meant for development: the migrations change the schema of a production database.
     * @param dropBeforeSync Drop every table of the database schema, with its data (also the tables of no entity),
     * before creating the schema. Defaults to `false`.
     * @returns Resolves once the schema is built.
     * @throws {CannotExecuteNotConnectedError} When the connection is closed.
     */
    public async synchronize(dropBeforeSync?: boolean): Promise<void> {
        return await this.datasource.synchronize(dropBeforeSync)
    }

    /**
     * Run the pending migrations (the `migrations` of the options not yet recorded in the migrations table), in their
     * timestamp order.
     * @param options The transactions of the migrations, and whether they are only recorded (`fake`).
     * @returns The migrations run, an empty array when none is pending.
     * @throws {CannotExecuteNotConnectedError} When the connection is closed.
     * @throws {Error} The error of a failed migration, once its transaction (`'all'` or `'each'`) is rolled back.
     */
    public async runMigrations(options?: MigrationRunOptions): Promise<Migration[]> {
        return await this.datasource.runMigrations(options)
    }

    /**
     * Revert the last migration run (its `down()`), and remove it from the migrations table. Does nothing when no
     * migration was run.
     * @param options The transaction of the migration (`'all'` by default, `migrationsTransactionMode` not applying),
     * and whether it is only removed from the migrations table (`fake`).
     * @returns Resolves once the migration is reverted.
     * @throws {CannotExecuteNotConnectedError} When the connection is closed.
     */
    public async undoLastMigration(options?: MigrationRunOptions): Promise<void> {
        return await this.datasource.undoLastMigration(options)
    }

    /**
     * Log each migration of the options with whether it was run (`[X]`) or not (`[ ]`), through the logger of the
     * connection (shown when its `logging` includes `schema`).
     * @returns Whether a migration is pending.
     */
    public async showMigrations(): Promise<boolean> {
        return await this.datasource.showMigrations()
    }

    /**
     * Whether an entity is registered on the connection.
     * @param target The entity class, its name, or its table name.
     * @returns `true` when the connection has its metadata.
     */
    public hasMetadata(target: EntityTarget<any>): boolean {
        return this.datasource.hasMetadata(target)
    }

    /**
     * The metadata of a registered entity: its table, columns, relations…
     * @param target The entity class, its name, or its table name.
     * @returns The metadata of the entity.
     * @throws {EntityMetadataNotFoundError} When the entity is not registered on the connection.
     */
    public getMetadata(target: EntityTarget<any>): EntityMetadata {
        return this.datasource.getMetadata(target)
    }

    /**
     * The repository of an entity, created once per entity: its `find`, `save`, `delete`… operations outside a
     * transaction (in a transaction, use the entity manager given to the callback).
     * @param target The entity class, its name, or its `EntitySchema`.
     * @returns The repository of the entity (a `MongoRepository` on a MongoDB connection).
     * @throws {EntityMetadataNotFoundError} From the repository operations, when the entity is not registered.
     */
    public getRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): Repository<Entity> {
        return this.datasource.getRepository<Entity>(target)
    }

    /**
     * The tree repository of an entity decorated with `@Tree()`: the operations on its ancestors and descendants
     * (`findTrees`, `findDescendants`…).
     * @param target The tree entity class, or its name.
     * @returns The tree repository of the entity.
     * @throws {TreeRepositoryNotSupportedError} On a driver without tree support (MongoDB).
     */
    public getTreeRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): TreeRepository<Entity> {
        return this.datasource.getTreeRepository<Entity>(target)
    }

    /**
     * The MongoDB repository of an entity: the repository operations plus the MongoDB ones (`aggregate`, `bulkWrite`…).
     * @param target The entity class, or its name.
     * @returns The MongoDB repository of the entity.
     * @throws {TypeORMError} When the connection is not a MongoDB one.
     */
    public getMongoRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): MongoRepository<Entity> {
        return this.datasource.getMongoRepository<Entity>(target)
    }

    /**
     * Run a function in a transaction, on one connection of the pool: committed when the function resolves, rolled
     * back when it rejects (its error rethrown). Every operation of the transaction goes through the entity manager given
     * to the function: the ones made through {@link Database.manager} or the repositories of this object run outside of
     * it.
     * @param runInTransaction The function, given the entity manager of the transaction.
     * @returns What the function resolves.
     * @throws {Error} The error of the function, or of the database, after the rollback.
     */
    public async transaction<T>(runInTransaction: (entityManager: EntityManager) => Promise<T>): Promise<T>
    /**
     * Run a function in a transaction with an isolation level, on one connection of the pool: committed when the
     * function resolves, rolled back when it rejects (its error rethrown). Every operation of the transaction goes
     * through the entity manager given to the function.
     * @param isolationLevel The isolation level: `'READ UNCOMMITTED'`, `'READ COMMITTED'`, `'REPEATABLE READ'` or
     * `'SERIALIZABLE'` (the levels the driver supports).
     * @param runInTransaction The function, given the entity manager of the transaction.
     * @returns What the function resolves.
     * @throws {Error} The error of the function, or of the database, after the rollback.
     */
    public async transaction<T>(isolationLevel: IsolationLevel, runInTransaction: (entityManager: EntityManager) => Promise<T>): Promise<T>
    public async transaction<T>(inp1: IsolationLevel | ((entityManager: EntityManager) => Promise<T>), inp2?: (entityManager: EntityManager) => Promise<T>): Promise<T> {
        return inp2 ? await this.datasource.transaction(<IsolationLevel>inp1, inp2) : await this.datasource.transaction(<(entityManager: EntityManager) => Promise<T>>inp1)
    }

    /**
     * Run a raw SQL query.
     * @param query The SQL, its parameters as placeholders: `$1`, `$2`… for PostgreSQL, `?` for MySQL and SQLite.
     * @param parameters The values of the placeholders, escaped by the driver.
     * @param queryRunner The query runner to run it on (a transaction of {@link Database.createQueryRunner}), a
     * connection of the pool otherwise.
     * @returns The raw result of the driver: the rows of a `SELECT` (an array of objects).
     * @throws {QueryFailedError} When the database rejects the query.
     */
    public async query<T = any>(query: string, parameters?: any[], queryRunner?: QueryRunner): Promise<T> {
        return await this.datasource.query(query, parameters, queryRunner)
    }

    /**
     * Create a query builder selecting an entity.
     * @param entityClass The entity class, its name, or its `EntitySchema`.
     * @param alias The alias of the entity in the query (`'user'` in `user.name`).
     * @param queryRunner The query runner to run the query on, a connection of the pool otherwise.
     * @returns The query builder, selecting the entity from its table.
     * @throws {EntityMetadataNotFoundError} When the entity is not registered.
     * @throws {TypeORMError} On a MongoDB connection, which has no query builder.
     */
    public createQueryBuilder<Entity extends ObjectLiteral>(entityClass: EntityTarget<Entity>, alias: string, queryRunner?: QueryRunner): SelectQueryBuilder<Entity>
    /**
     * Create an empty query builder, its selection and source set by its `select()` and `from()`.
     * @param queryRunner The query runner to run the query on, a connection of the pool otherwise.
     * @returns The query builder.
     * @throws {TypeORMError} On a MongoDB connection, which has no query builder.
     */
    public createQueryBuilder(queryRunner?: QueryRunner): SelectQueryBuilder<any>
    public createQueryBuilder<Entity extends ObjectLiteral>(inp1?: EntityTarget<Entity> | QueryRunner, inp2?: string, inp3?: QueryRunner): SelectQueryBuilder<Entity> {
        return arguments.length > 1 ? this.datasource.createQueryBuilder(<EntityTarget<Entity>>inp1, <string>inp2, <QueryRunner | undefined>inp3) : this.datasource.createQueryBuilder(<QueryRunner | undefined>inp1)
    }

    /**
     * Create a query runner: one connection taken from the pool, to run several queries on the same connection and
     * control its transaction by hand (`connect()`, `startTransaction()`, `commitTransaction()`,
     * `rollbackTransaction()`). The caller must `release()` it, or the connection stays taken.
     * @param mode With replication, `'master'` (the default) for the writes, `'slave'` for the reads on a replica.
     * @returns The query runner, not connected until its first query or `connect()`.
     */
    public createQueryRunner(mode?: ReplicationMode): QueryRunner {
        return this.datasource.createQueryRunner(mode)
    }

    /**
     * The metadata of the junction table of a many-to-many relation.
     * @param entityTarget The entity owning the relation.
     * @param relationPropertyPath The property of the relation (`'tags'`, or a path such as `'profile.tags'`).
     * @returns The metadata of the junction table.
     * @throws {EntityMetadataNotFoundError} When the entity is not registered.
     * @throws {TypeORMError} When the entity has no such relation, or the relation is not a many-to-many one.
     */
    public getManyToManyMetadata(entityTarget: EntityTarget<any>, relationPropertyPath: string): EntityMetadata | undefined {
        return this.datasource.getManyToManyMetadata(entityTarget, relationPropertyPath)
    }

    /**
     * Create an entity manager on the connection, bound to a query runner when given (its operations then run on the
     * runner's connection and transaction).
     * @param queryRunner The query runner the manager uses, a connection of the pool per operation otherwise.
     * @returns The entity manager.
     */
    public createEntityManager(queryRunner?: QueryRunner): EntityManager {
        return this.datasource.createEntityManager(queryRunner)
    }
}

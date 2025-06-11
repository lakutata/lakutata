import {Configurable} from '../decorators/di/Configurable.js'
import {Transient} from '../decorators/di/Lifetime.js'
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
import {Provider} from '../lib/core/Provider.js'
import {EntitySchema, type MixedList} from 'typeorm'

/**
 * Build database provider connection options
 * @param options
 * @constructor
 */
export const BuildDatabaseOptions: (options: Omit<DataSourceOptions, 'entities'>) => {
    class: typeof Database,
    options: Omit<DataSourceOptions, 'entities'>
} = (options: Omit<DataSourceOptions, 'entities'>) => ({
    class: Database,
    options: options
})

/**
 * Database component
 */
@Transient()
export class Database extends Provider {

    #datasource: DataSource

    /**
     * Connection options
     */
    @Configurable()
    protected readonly options: DataSourceOptions

    /**
     * Database entities
     * @protected
     */
    @Configurable()
    protected readonly entities: MixedList<Function | string | EntitySchema>

    /**
     * Datasource instance
     * @protected
     */
    protected get datasource(): DataSource {
        return this.#datasource
    }

    /**
     * Connection driver
     */
    public get driver(): Driver {
        return this.datasource.driver
    }

    /**
     * EntityManager of this connection.
     */
    public get manager(): EntityManager {
        return this.datasource.manager
    }

    /**
     * Set naming strategy used in the connection.
     * @param instance
     */
    public set namingStrategy(instance: NamingStrategyInterface) {
        this.datasource.namingStrategy = instance
    }

    /**
     * Get naming strategy used in the connection.
     */
    public get namingStrategy(): NamingStrategyInterface {
        return this.datasource.namingStrategy
    }

    /**
     * Entity subscriber instances that are registered for this connection.
     */
    public get subscribers(): EntitySubscriberInterface<any>[] {
        return this.datasource.subscribers
    }

    /**
     * All entity metadatas that are registered for this connection.
     */
    public get entityMetadatas(): EntityMetadata[] {
        return this.datasource.entityMetadatas
    }

    /**
     * All entity metadatas that are registered for this connection.
     * This is a copy of #.entityMetadatas property -> used for more performant searches.
     */
    public get entityMetadatasMap(): Map<EntityTarget<any>, EntityMetadata> {
        return this.datasource.entityMetadatasMap
    }

    /**
     * Used to work with query result cache.
     */
    public get queryResultCache(): QueryResultCache | undefined {
        return this.datasource.queryResultCache
    }

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        const entities: MixedList<Function | string | EntitySchema> = this.entities ? this.entities : []
        const options: DataSourceOptions = {
            ...this.options,
            entities: entities
        }
        this.#datasource = await (new DataSource(options)).initialize()
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        await this.datasource.destroy()
    }

    /**
     * Creates database schema for all entities registered in this connection.
     * Can be used only after connection to the database is established.
     *
     * @param dropBeforeSync If set to true then it drops the database with all its tables and data
     */
    public async synchronize(dropBeforeSync?: boolean): Promise<void> {
        return await this.datasource.synchronize(dropBeforeSync)
    }

    /**
     * Runs all pending migrations.
     * Can be used only after connection to the database is established.
     * @param options
     */
    public async runMigrations(options?: {
        transaction?: 'all' | 'none' | 'each'
        fake?: boolean
    }): Promise<Migration[]> {
        return await this.datasource.runMigrations(options)
    }

    /**
     * Reverts last executed migration.
     * Can be used only after connection to the database is established.
     * @param options
     */
    public async undoLastMigration(options?: {
        transaction?: 'all' | 'none' | 'each'
        fake?: boolean
    }): Promise<void> {
        return await this.datasource.undoLastMigration(options)
    }

    /**
     * Lists all migrations and whether they have been run.
     * Returns true if there are pending migrations
     */
    public async showMigrations(): Promise<boolean> {
        return await this.datasource.showMigrations()
    }

    /**
     * Checks if entity metadata exist for the given entity class, target name or table name.
     * @param target
     */
    public hasMetadata(target: EntityTarget<any>): boolean {
        return this.datasource.hasMetadata(target)
    }

    /**
     * Gets entity metadata for the given entity class or schema name.
     * @param target
     */
    public getMetadata(target: EntityTarget<any>): EntityMetadata {
        return this.datasource.getMetadata(target)
    }

    /**
     * Gets repository for the given entity.
     * @param target
     */
    public getRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): Repository<Entity> {
        return this.datasource.getRepository<Entity>(target)
    }

    /**
     * Gets tree repository for the given entity class or name.
     * Only tree-type entities can have a TreeRepository, like ones decorated with @Tree decorator.
     * @param target
     */
    public getTreeRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): TreeRepository<Entity> {
        return this.datasource.getTreeRepository<Entity>(target)
    }

    /**
     * Gets mongodb-specific repository for the given entity class or name.
     * Works only if connection is mongodb-specific.
     * @param target
     */
    public getMongoRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): MongoRepository<Entity> {
        return this.datasource.getMongoRepository<Entity>(target)
    }

    /**
     * Wraps given function execution (and all operations made there) into a transaction.
     * All database operations must be executed using provided entity manager.
     * @param runInTransaction
     */
    public async transaction<T>(runInTransaction: (entityManager: EntityManager) => Promise<T>): Promise<T>
    public async transaction<T>(isolationLevel: IsolationLevel, runInTransaction: (entityManager: EntityManager) => Promise<T>): Promise<T>
    public async transaction<T>(inp1: IsolationLevel | ((entityManager: EntityManager) => Promise<T>), inp2?: (entityManager: EntityManager) => Promise<T>): Promise<T> {
        return inp2 ? await this.datasource.transaction(<IsolationLevel>inp1, inp2) : await this.datasource.transaction(<(entityManager: EntityManager) => Promise<T>>inp1)
    }

    /**
     * Executes raw SQL query and returns raw database results.
     * @param query
     * @param parameters
     * @param queryRunner
     */
    public async query<T = any>(query: string, parameters?: any[], queryRunner?: QueryRunner): Promise<T> {
        return await this.datasource.query(query, parameters, queryRunner)
    }

    /**
     * Creates a new query builder that can be used to build a SQL query.
     * @param entityClass
     * @param alias
     * @param queryRunner
     */
    public createQueryBuilder<Entity extends ObjectLiteral>(entityClass: EntityTarget<Entity>, alias: string, queryRunner?: QueryRunner): SelectQueryBuilder<Entity>
    public createQueryBuilder(queryRunner?: QueryRunner): SelectQueryBuilder<any>
    public createQueryBuilder<Entity extends ObjectLiteral>(inp1?: EntityTarget<Entity> | QueryRunner, inp2?: string, inp3?: QueryRunner): SelectQueryBuilder<Entity> {
        return arguments.length > 1 ? this.datasource.createQueryBuilder(<EntityTarget<Entity>>inp1, <string>inp2, <QueryRunner | undefined>inp3) : this.datasource.createQueryBuilder(<QueryRunner | undefined>inp1)
    }

    /**
     * Creates a query runner used for perform queries on a single database connection.
     * Using query runners you can control your queries to execute using single database connection and
     * manually control your database transaction.
     *
     * Mode is used in replication mode and indicates whatever you want to connect
     * to master database or any of slave databases.
     * If you perform writes you must use master database,
     * if you perform reads you can use slave databases.
     *
     * @param mode
     */
    public createQueryRunner(mode?: ReplicationMode): QueryRunner {
        return this.datasource.createQueryRunner(mode)
    }

    /**
     * Gets entity metadata of the junction table (many-to-many table).
     * @param entityTarget
     * @param relationPropertyPath
     */
    public getManyToManyMetadata(entityTarget: EntityTarget<any>, relationPropertyPath: string): EntityMetadata | undefined {
        return this.datasource.getManyToManyMetadata(entityTarget, relationPropertyPath)
    }

    /**
     * Creates an Entity Manager for the current connection with the help of the EntityManagerFactory.
     * @param queryRunner
     */
    public createEntityManager(queryRunner?: QueryRunner): EntityManager {
        return this.datasource.createEntityManager(queryRunner)
    }
}

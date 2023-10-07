import {Component} from '../base/Component'
import {Configurable, Singleton} from '../../decorators/DependencyInjectionDecorators'
import {
    DataSource,
    type DataSourceOptions,
    type ObjectLiteral,
    type EntityTarget,
    Repository,
    TreeRepository,
    MongoRepository,
    EntityManager,
    type IsolationLevel,
    type QueryRunner,
    SelectQueryBuilder,
    type ReplicationMode,
    type QueryResultCache,
    type Driver,
    type NamingStrategyInterface,
    type EntitySubscriberInterface,
    EntityMetadata,
    Migration
} from '../../ORM'

@Singleton()
export class Database extends Component {

    /**
     * 连接参数
     */
    @Configurable()
    protected readonly options: DataSourceOptions

    /**
     * 数据源实例
     * @protected
     */
    protected get datasource(): DataSource {
        return this.getInternalProperty<DataSource>('datasource')
    }

    /**
     * 该连接使用的数据库驱动程序
     */
    public get driver(): Driver {
        return this.datasource.driver
    }

    /**
     * 该连接的实体管理器（EntityManager）
     */
    public get manager(): EntityManager {
        return this.datasource.manager
    }

    /**
     * 设置该连接使用的命名策略（Naming Strategy）
     * @param instance
     */
    public set namingStrategy(instance: NamingStrategyInterface) {
        this.datasource.namingStrategy = instance
    }

    /**
     * 获取该连接使用的命名策略（Naming Strategy）
     */
    public get namingStrategy(): NamingStrategyInterface {
        return this.datasource.namingStrategy
    }

    /**
     * 为该连接注册的实体订阅者实例（Entity Subscriber）
     */
    public get subscribers(): EntitySubscriberInterface<any>[] {
        return this.datasource.subscribers
    }

    /**
     * 为该连接注册的所有实体元数据（Entity Metadata）
     */
    public get entityMetadatas(): EntityMetadata[] {
        return this.datasource.entityMetadatas
    }

    /**
     * 为该连接注册的所有实体元数据。这是#.entityMetadatas属性的副本，用于更高效的搜索
     */
    public get entityMetadatasMap(): Map<EntityTarget<any>, EntityMetadata> {
        return this.datasource.entityMetadatasMap
    }

    /**
     * 用于操作查询结果缓存
     */
    public get queryResultCache(): QueryResultCache | undefined {
        return this.datasource.queryResultCache
    }

    /**
     * 组件内部初始化函数
     * @protected
     */
    protected async __init(): Promise<void> {
        await super.__init()
        const datasource: DataSource = new DataSource(this.options)
        this.setInternalProperty('datasource', await datasource.initialize())
    }

    /**
     * 组件内部销毁函数
     * @protected
     */
    protected async __destroy(): Promise<void> {
        await this.datasource.destroy()
        await super.__destroy()
    }

    /**
     * 为该连接中注册的所有实体创建数据库模式。只能在与数据库建立连接后使用
     * @param dropBeforeSync 如果设置为true，则删除包含所有表和数据的数据库
     */
    public async synchronize(dropBeforeSync?: boolean): Promise<void> {
        return await this.datasource.synchronize(dropBeforeSync)
    }

    /**
     * 运行所有待处理的迁移。只能在与数据库建立连接后使用
     * @param options
     */
    public async runMigrations(options?: {
        transaction?: 'all' | 'none' | 'each'
        fake?: boolean
    }): Promise<Migration[]> {
        return await this.datasource.runMigrations(options)
    }

    /**
     * 还原上次执行的迁移。只能在与数据库建立连接后使用
     * @param options
     */
    public async undoLastMigration(options?: {
        transaction?: 'all' | 'none' | 'each'
        fake?: boolean
    }): Promise<void> {
        return await this.datasource.undoLastMigration(options)
    }

    /**
     * 列出所有迁移，并指示它们是否已运行。如果有待处理的迁移，则返回true
     */
    public async showMigrations(): Promise<boolean> {
        return await this.datasource.showMigrations()
    }

    /**
     * 检查给定实体类、目标名称或表名称是否存在实体元数据（Entity Metadata）
     * @param target
     */
    public hasMetadata(target: EntityTarget<any>): boolean {
        return this.datasource.hasMetadata(target)
    }

    /**
     * 根据给定的实体类或模式名称获取实体元数据（Entity Metadata）
     * @param target
     */
    public getMetadata(target: EntityTarget<any>): EntityMetadata {
        return this.datasource.getMetadata(target)
    }

    /**
     * 获取给定实体的代码仓库
     * @param target
     */
    public getRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): Repository<Entity> {
        return this.datasource.getRepository<Entity>(target)
    }

    /**
     * 根据给定的实体类或名称获取树形代码仓库。只有树形实体才能拥有TreeRepository，例如被@Tree修饰的实体
     * @param target
     */
    public getTreeRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): TreeRepository<Entity> {
        return this.datasource.getTreeRepository<Entity>(target)
    }

    /**
     * 根据给定的实体类或名称获取针对MongoDB的特定代码仓库。只有在连接是针对MongoDB的情况下才有效
     * @param target
     */
    public getMongoRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): MongoRepository<Entity> {
        return this.datasource.getMongoRepository<Entity>(target)
    }

    /**
     * 将给定的函数执行（以及其中进行的所有操作）封装到一个事务中。所有数据库操作必须使用提供的实体管理器执行
     * @param runInTransaction
     */
    public async transaction<T>(runInTransaction: (entityManager: EntityManager) => Promise<T>): Promise<T>
    public async transaction<T>(isolationLevel: IsolationLevel, runInTransaction: (entityManager: EntityManager) => Promise<T>): Promise<T>
    public async transaction<T>(inp1: IsolationLevel | ((entityManager: EntityManager) => Promise<T>), inp2?: (entityManager: EntityManager) => Promise<T>): Promise<T> {
        return inp2 ? await this.datasource.transaction(<IsolationLevel>inp1, inp2) : await this.datasource.transaction(<(entityManager: EntityManager) => Promise<T>>inp1)
    }

    /**
     * 执行原始的SQL查询并返回数据库的原始结果
     * @param query
     * @param parameters
     * @param queryRunner
     */
    public async query<T = any>(query: string, parameters?: any[], queryRunner?: QueryRunner): Promise<T> {
        return await this.datasource.query(query, parameters, queryRunner)
    }

    /**
     * 创建一个新的查询构建器，用于构建SQL查询
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
     * 创建一个查询运行器，用于在单个数据库连接上执行查询。使用查询运行器，您可以控制查询使用单个数据库连接执行，并手动控制数据库事务
     * Mode参数用于指示您是要连接到主数据库还是其中一个从数据库。如果执行写操作，必须使用主数据库；如果执行读操作，可以使用从数据库
     * @param mode
     */
    public createQueryRunner(mode?: ReplicationMode): QueryRunner {
        return this.datasource.createQueryRunner(mode)
    }

    /**
     * 获取联接表（多对多关系表）的实体元数据（Entity Metadata）
     * @param entityTarget
     * @param relationPropertyPath
     */
    public getManyToManyMetadata(entityTarget: EntityTarget<any>, relationPropertyPath: string): EntityMetadata | undefined {
        return this.datasource.getManyToManyMetadata(entityTarget, relationPropertyPath)
    }

    /**
     * 使用EntityManagerFactory为当前连接创建一个实体管理器（EntityManager）
     * @param queryRunner
     */
    public createEntityManager(queryRunner?: QueryRunner): EntityManager {
        return this.datasource.createEntityManager(queryRunner)
    }
}

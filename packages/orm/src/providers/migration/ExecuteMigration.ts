import {Provider, DTO, Application} from '@lakutata/core'
import {Configurable, Transient} from '@lakutata/core/decorator/di'
import {type DataSourceOptions} from 'typeorm/data-source/DataSourceOptions.js'
import {DataSource} from 'typeorm/data-source/DataSource.js'
import {MigrationExecutor} from 'typeorm/migration/MigrationExecutor.js'
import {type Migration} from 'typeorm/migration/Migration.js'
import ansi from 'ansis'
import {connectionOptionsOf} from '../../lib/ConnectionOptions.js'

/**
 * The actions on the migrations of a database
 */
export type MigrationAction = 'run' | 'revert' | 'show'

/**
 * The executor of the migrations, giving the migrations of the options of the database
 */
class Executor extends MigrationExecutor {
    /**
     * The migrations of the options of the database, in their order
     */
    public sourceMigrations(): Migration[] {
        return this.getMigrations()
    }
}

/**
 * Run, revert or show the migrations of a database of the application, with its options (MIGRATION_RUN, MIGRATION_REVERT,
 * MIGRATION_SHOW): the database is connected without synchronizing its schema nor running its migrations, the action
 * done, then the application exits (with the code 1 when the action fails)
 */
@Transient()
export class ExecuteMigration extends Provider {

    @Configurable(DTO.String().valid('run', 'revert', 'show').required())
    protected readonly action: MigrationAction

    @Configurable(DTO.String().allow('').optional().default(''))
    protected readonly dataSourceName: string

    @Configurable()
    protected readonly dataSource: DataSourceOptions

    @Configurable(DTO.String().valid('all', 'none', 'each').optional())
    protected readonly transaction?: 'all' | 'none' | 'each'

    /**
     * The transactions of the migrations: MIGRATION_TRANSACTION, else the migrationsTransactionMode of the database, else
     * one for all
     */
    protected get transactionMode(): 'all' | 'none' | 'each' {
        return this.transaction ?? this.dataSource.migrationsTransactionMode ?? 'all'
    }

    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly fake: boolean

    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly exitProcess: boolean

    /**
     * The prefix of the messages: the name of the database
     */
    protected get prefix(): string {
        return this.dataSourceName ? `[${this.dataSourceName}] ` : ''
    }

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        const app: Application = await this.getObject(Application)
        const dataSource: DataSource = new DataSource(connectionOptionsOf({...this.dataSource, synchronize: false, migrationsRun: false, dropSchema: false} as DataSourceOptions))
        let failed: boolean = false
        try {
            await dataSource.initialize()
            await this.handle(dataSource)
        } catch (error) {
            console.error(ansi.red`${this.prefix}The migrations could not be ${this.action === 'show' ? 'shown' : this.action === 'run' ? 'run' : 'reverted'}:`, error)
            failed = true
        } finally {
            if (dataSource.isInitialized) await dataSource.destroy()
        }
        //A failure stops the actions on the other databases
        if (failed) return app.exit(1)
        if (this.exitProcess) return app.exit(0)
    }

    /**
     * Do the action on the database
     * @param dataSource
     * @protected
     */
    protected async handle(dataSource: DataSource): Promise<void> {
        const executor: Executor = new Executor(dataSource)
        switch (this.action) {
            case 'run': {
                const pending: Migration[] = await executor.getPendingMigrations()
                const ran: Migration[] = await dataSource.runMigrations({transaction: this.transactionMode, fake: this.fake})
                //The migrations marked as run are not given back by TypeORM
                const executed: Migration[] = this.fake ? pending : ran
                if (!executed.length) return console.log(ansi.green`${this.prefix}No pending migration`)
                for (const migration of executed) console.log(ansi.green`${this.prefix}Migration ${ansi.blue(migration.name)} has been ${this.fake ? 'marked as run' : 'run'}`)
                return
            }
            case 'revert': {
                const [last] = (await executor.getExecutedMigrations()).sort((a: Migration, b: Migration): number => (b.id ?? 0) - (a.id ?? 0))
                if (!last) return console.log(ansi.yellow`${this.prefix}No migration to revert`)
                await dataSource.undoLastMigration({transaction: this.transactionMode, fake: this.fake})
                return console.log(ansi.green`${this.prefix}Migration ${ansi.blue(last.name)} has been ${this.fake ? 'marked as reverted' : 'reverted'}`)
            }
            case 'show': {
                const executed: Set<string> = new Set((await executor.getExecutedMigrations()).map((migration: Migration): string => migration.name))
                const migrations: Migration[] = executor.sourceMigrations()
                if (!migrations.length) return console.log(ansi.yellow`${this.prefix}No migration in the options of the database`)
                for (const migration of migrations) console.log(`${this.prefix}${executed.has(migration.name) ? ansi.green`[X]` : ansi.yellow`[ ]`} ${migration.name}`)
                const pending: number = migrations.filter((migration: Migration): boolean => !executed.has(migration.name)).length
                return console.log(pending ? ansi.yellow`${this.prefix}${pending} pending migration${pending > 1 ? 's' : ''}` : ansi.green`${this.prefix}No pending migration`)
            }
        }
    }
}

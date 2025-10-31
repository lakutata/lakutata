import {Provider} from '../../lib/core/Provider.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {DTO} from '../../lib/core/DTO.js'
import {type DataSourceOptions} from 'typeorm/data-source/DataSourceOptions.js'
import path from 'path'
import {DataSource} from 'typeorm/data-source/DataSource.js'
import {SqlInMemory} from 'typeorm/driver/SqlInMemory.js'
import {format} from '@sqltools/formatter/lib/sqlFormatter.js'
import {camelCase} from 'typeorm/util/StringUtils.js'
import {PlatformTools} from 'typeorm/platform/PlatformTools.js'
import {CommandUtils} from 'typeorm/commands/CommandUtils.js'
import ansi from 'ansis'
import {Transient} from '../../decorators/di/Lifetime.js'
import {Application} from '../../lib/core/Application.js'
import {Inject} from '../../decorators/di/Inject.js'

@Transient()
export class GenerateMigration extends Provider {

    @Inject(Application)
    protected readonly app: Application

    @Configurable(DTO.String().required())
    protected readonly path: string

    @Configurable(DTO.String().allow('').optional().default(''))
    protected readonly dataSourceName: string

    @Configurable()
    protected readonly dataSource: DataSourceOptions

    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly pretty: boolean

    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly outputJs: boolean

    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly esm: boolean

    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly dryRun: boolean

    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly check: boolean

    @Configurable(DTO.Number().optional().default(() => Date.now()))
    protected readonly timestamp: number

    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly exitProcess: boolean

    protected get extension(): string {
        return this.outputJs ? '.js' : '.ts'
    }

    protected get filename(): string {
        return this.timestamp + '-' + (this.dataSourceName ? this.dataSourceName : path.basename(this.path)) + this.extension
    }

    #dataSource: DataSource

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        this.#dataSource = new DataSource(this.dataSource)
        this.#dataSource.setOptions({
            synchronize: false,
            migrationsRun: false,
            dropSchema: false,
            logging: false
        })
        this.#dataSource = await this.#dataSource.initialize()
        await this.handle()
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        await this.#dataSource?.destroy()
    }

    protected async handle(): Promise<void> {
        try {
            const upSqls: string[] = [],
                downSqls: string[] = []

            try {
                const sqlInMemory: SqlInMemory = await this.#dataSource.driver
                    .createSchemaBuilder()
                    .log()

                if (this.pretty) {
                    sqlInMemory.upQueries.forEach((upQuery) => {
                        upQuery.query = GenerateMigration.prettifyQuery(
                            upQuery.query
                        )
                    })
                    sqlInMemory.downQueries.forEach((downQuery) => {
                        downQuery.query =
                            GenerateMigration.prettifyQuery(
                                downQuery.query
                            )
                    })
                }

                sqlInMemory.upQueries.forEach((upQuery) => {
                    upSqls.push(
                        '        await queryRunner.query(`' +
                        upQuery.query.replaceAll('`', '\\`') +
                        '`' +
                        GenerateMigration.queryParams(
                            upQuery.parameters
                        ) +
                        ');'
                    )
                })
                sqlInMemory.downQueries.forEach((downQuery) => {
                    downSqls.push(
                        '        await queryRunner.query(`' +
                        downQuery.query.replaceAll('`', '\\`') +
                        '`' +
                        GenerateMigration.queryParams(
                            downQuery.parameters
                        ) +
                        ');'
                    )
                })
            } finally {
                await this.#dataSource.destroy()
            }

            if (!upSqls.length) {
                if (this.check) {
                    console.log(
                        ansi.green`No changes in database schema were found`
                    )
                    if (this.exitProcess) {
                        return this.app.exit(0)
                    } else {
                        return
                    }
                } else {
                    console.log(
                        ansi.yellow`No changes in database schema were found`
                    )
                    if (this.exitProcess) {
                        return this.app.exit(1)
                    } else {
                        return
                    }
                }
            } else if (!this.path) {
                console.log(ansi.yellow`Please specify a migration path`)
                return this.app.exit(1)
            }

            const fileContent: string = this.outputJs
                ? GenerateMigration.getJavascriptTemplate(
                    path.basename(this.path),
                    this.timestamp,
                    upSqls,
                    downSqls.reverse(),
                    this.esm
                )
                : GenerateMigration.getTemplate(
                    path.basename(this.path),
                    this.timestamp,
                    upSqls,
                    downSqls.reverse()
                )

            if (this.check) {
                console.log(
                    ansi.yellow`Unexpected changes in database schema were found in check mode:\n\n${ansi.white(
                        fileContent
                    )}`
                )
                if (this.exitProcess) {
                    return this.app.exit(0)
                } else {
                    return
                }
            }

            if (this.dryRun) {
                console.log(
                    ansi.green(
                        `Migration ${ansi.blue(
                            this.path + this.extension
                        )} has content:\n\n${ansi.white(fileContent)}`
                    )
                )
            } else {
                const migrationFileName: string = path.isAbsolute(this.path) ? path.join(this.path, this.filename) : path.join(process.cwd(), this.path, this.filename)
                await CommandUtils.createFile(migrationFileName, fileContent)

                console.log(
                    ansi.green`Migration ${ansi.blue(
                        migrationFileName
                    )} has been generated successfully.`
                )
                if (this.exitProcess) {
                    return this.app.exit(0)
                } else {
                    return
                }
            }
        } catch (err) {
            PlatformTools.logCmdErr('Error during migration generation:', err)
            return this.app.exit(1)
        }
    }

    /**
     * Formats query parameters for migration queries if parameters actually exist
     */
    protected static queryParams(parameters: any[] | undefined): string {
        if (!parameters || !parameters.length) {
            return ''
        }

        return `, ${JSON.stringify(parameters)}`
    }

    /**
     * Gets contents of the migration file.
     */
    protected static getTemplate(
        name: string,
        timestamp: number,
        upSqls: string[],
        downSqls: string[]
    ): string {
        const migrationName = `${camelCase(name, true)}${timestamp}`

        return `import { MigrationInterface, QueryRunner } from "lakutata/orm";

export class ${migrationName} implements MigrationInterface {
    name = '${migrationName}'

    public async up(queryRunner: QueryRunner): Promise<void> {
${upSqls.join(`
`)}
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
${downSqls.join(`
`)}
    }

}
`
    }

    /**
     * Gets contents of the migration file in Javascript.
     */
    protected static getJavascriptTemplate(
        name: string,
        timestamp: number,
        upSqls: string[],
        downSqls: string[],
        esm: boolean
    ): string {
        const migrationName = `${camelCase(name, true)}${timestamp}`

        const exportMethod = esm ? 'export' : 'module.exports ='

        return `/**
 * @typedef {import('lakutata/orm').MigrationInterface} MigrationInterface
 * @typedef {import('lakutata/orm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
${exportMethod} class ${migrationName} {
    name = '${migrationName}'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
${upSqls.join(`
`)}
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
${downSqls.join(`
`)}
    }
}
`
    }

    /**
     *
     */
    protected static prettifyQuery(query: string): string {
        const formattedQuery = format(query, {indent: '    '})
        return (
            '\n' + formattedQuery.replace(/^/gm, '            ') + '\n        '
        )
    }
}
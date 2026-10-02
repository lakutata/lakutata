import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {MigrationDTO} from '../dtos/MigrationDTO.js'
import {Done} from '../lib/Output.js'
import {CreateMigration, ExecuteMigrations, GenerateMigrations, type GenerateMigrationsResult} from '../lib/Migration.js'
import {Workspace, type WorkspacePackage} from '../lib/workspace/Workspace.js'

/**
 * The commands of the migrations of the databases of the application
 */
export class MigrationController extends Controller {

    @CLIAction('migration <action> [name]', MigrationDTO, {description: 'Generate, create, run, revert or show the migrations of the databases of the application'})
    public async migration(input: MigrationDTO): Promise<undefined> {
        let directory: string = process.cwd()
        if (input.package) {
            const workspace: Workspace = await Workspace.find()
            const pkg: WorkspacePackage | undefined = workspace.packages.find((candidate: WorkspacePackage): boolean => candidate.name === input.package)
            if (!pkg) throw new Error(`The workspace has no package ${input.package} (${workspace.packages.map((candidate: WorkspacePackage): string => candidate.name).join(', ')})`)
            directory = pkg.directory
        }
        const relative = (file: string): string => path.relative(process.cwd(), path.join(directory, file))
        switch (input.action) {
            case 'create': {
                if (!input.name) throw new Error('The name of the migration is required: lakutata migration create <name>')
                const file: string = await CreateMigration({directory: directory, dir: input.dir, name: input.name})
                Done(`Migration created: ${relative(file)} (given to the migrations of the options of its database)`)
                return undefined
            }
            case 'generate': {
                const result: GenerateMigrationsResult = await GenerateMigrations({directory: directory, dir: input.dir, script: input.script, database: input.database})
                if (result.files.length) {
                    Done(`Migrations generated: ${result.files.map(relative).join(', ')}`)
                    return undefined
                }
                //The application tells why (no change of the schema, the failure)
                if (result.code !== 0) throw new Error(`No migration generated (the application exited with the code ${result.code})`)
                Done('No migration generated: the application has no Database component or provider')
                return undefined
            }
            default: {
                //The application tells what it did
                const code: number = await ExecuteMigrations({directory: directory, script: input.script, database: input.database, action: input.action, transaction: input.transaction, fake: input.fake})
                if (code !== 0) throw new Error(`The command ${input.action} of the migrations failed (the application exited with the code ${code})`)
                return undefined
            }
        }
    }
}

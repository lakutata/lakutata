import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class MigrationDTO extends DTO {
    @Expect(DTO.String().valid('generate', 'create', 'run', 'revert', 'show').required().description('generate: the migrations of the changes of the entities; create <name>: an empty migration; run: the pending migrations; revert: the last migration run; show: the migrations run and pending'))
    public action: 'generate' | 'create' | 'run' | 'revert' | 'show'

    @Expect(DTO.String().pattern(/^[A-Za-z][A-Za-z0-9_-]*$/).optional().description('The name of the migration created (create)'))
    public name?: string

    @Expect(DTO.String().optional().default('src/migrations').description('The directory of the migrations, relative to the package (generate, create)'))
    public dir: string

    @Expect(DTO.String().optional().default('dev').description('The script of the package building and starting the application (generate, run, revert, show)'))
    public script: string

    @Expect(DTO.String().optional().description('The package of the workspace of the application (the current directory by default)'))
    public package?: string

    @Expect(DTO.String().optional().description('The database: the name of its Database component or provider (all by default; required to revert when the application has several)'))
    public database?: string

    @Expect(DTO.String().valid('all', 'none', 'each').optional().description('The transactions of the migrations run or reverted: all (one for all), each (one per migration) or none; by default the migrationsTransactionMode of the database, else all'))
    public transaction?: 'all' | 'none' | 'each'

    @Expect(DTO.Boolean().optional().default(false).description('Mark the migrations as run or reverted without executing them'))
    public fake: boolean
}

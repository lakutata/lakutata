import {existsSync} from 'node:fs'
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {camelCase} from 'lakutata/utils'
import {LaunchEnvironment} from './Environment.js'
import {projectPackageManager, spawnCommand} from './Processes.js'

/**
 * The application of a package, started by its script
 */
export type MigrationApplication = {
    /**
     * The directory of the package of the application
     */
    directory: string
    /**
     * The script of the package building and starting the application
     */
    script: string
    /**
     * The database of the command (the name of its Database component or provider), all by default
     */
    database?: string
}

/**
 * The options of the generation of the migrations
 */
export type GenerateMigrationsOptions = MigrationApplication & {
    /**
     * The directory of the migrations, relative to the package
     */
    dir: string
}

/**
 * The result of the generation of the migrations
 */
export type GenerateMigrationsResult = {
    /**
     * The exit code of the application (not 0: no change of the schema, or a failure)
     */
    code: number
    /**
     * The migrations generated, relative to the package
     */
    files: string[]
}

/**
 * The options of the commands running, reverting or showing the migrations
 */
export type ExecuteMigrationsOptions = MigrationApplication & {
    action: 'run' | 'revert' | 'show'
    /**
     * The transactions of the migrations run or reverted
     */
    transaction?: 'all' | 'none' | 'each'
    /**
     * The migrations marked as run or reverted without being executed
     */
    fake?: boolean
}

/**
 * The files of a directory, none when it does not exist
 * @param directory
 */
async function listFiles(directory: string): Promise<string[]> {
    return existsSync(directory) ? await readdir(directory) : []
}

/**
 * Start the application of a package by its script, with the environment of a command of the migrations: the
 * application does the command and exits
 * @param application
 * @param env
 * @return the exit code of the application
 */
async function startApplication(application: MigrationApplication, env: Record<string, string>): Promise<number> {
    const manifest: { scripts?: Record<string, string> } = JSON.parse(await readFile(path.join(application.directory, 'package.json'), 'utf8'))
    if (!manifest.scripts?.[application.script]) throw new Error(`The package ${application.directory} has no script "${application.script}" building and starting the application (--script)`)
    //The variables of a previous command are not inherited
    const base: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(LaunchEnvironment).filter(([name]): boolean => !name.toUpperCase().startsWith('MIGRATION_')))
    return await new Promise((resolve: (code: number) => void, reject: (error: Error) => void): void => {
        //The output of the application is the one of the command; the package managers are scripts on Windows
        const child = spawnCommand(projectPackageManager(application.directory), ['run', application.script], {
            cwd: application.directory,
            stdio: 'inherit',
            env: {...base, ...env, ...(application.database ? {MIGRATION_DATABASE: application.database} : {})}
        })
        child.once('error', reject)
        child.once('close', (exitCode: number | null): void => resolve(exitCode ?? 1))
    })
}

/**
 * Generate the migrations of an application: its script builds and starts it with MIGRATION_GENERATE, the application
 * compares the entities of its Database components and providers with their databases, writes the migrations of the
 * changes into the directory, and exits (as `cross-env MIGRATION_GENERATE=<dir> npm run <script>` in lakutata 2.x)
 * @param options
 */
export async function generateMigrations(options: GenerateMigrationsOptions): Promise<GenerateMigrationsResult> {
    const directory: string = path.resolve(options.directory, options.dir)
    const before: Set<string> = new Set(await listFiles(directory))
    const code: number = await startApplication(options, {MIGRATION_GENERATE: options.dir})
    const files: string[] = (await listFiles(directory)).filter((file: string): boolean => !before.has(file)).sort()
    return {code: code, files: files.map((file: string): string => path.join(options.dir, file))}
}

/**
 * Run, revert or show the migrations of the databases of an application: its script builds and starts it with
 * MIGRATION_RUN, MIGRATION_REVERT or MIGRATION_SHOW, the application connects its databases with their options (without
 * synchronizing their schemas nor running their migrations), does the command, tells what it did, and exits
 * @param options
 * @return the exit code of the application
 */
export async function executeMigrations(options: ExecuteMigrationsOptions): Promise<number> {
    return await startApplication(options, {
        [`MIGRATION_${options.action.toUpperCase()}`]: '1',
        ...(options.transaction ? {MIGRATION_TRANSACTION: options.transaction} : {}),
        ...(options.fake ? {MIGRATION_FAKE: '1'} : {})
    })
}

/**
 * The options of the creation of a migration
 */
export type CreateMigrationOptions = {
    /**
     * The directory of the package
     */
    directory: string
    /**
     * The directory of the migrations, relative to the package
     */
    dir: string
    /**
     * The name of the migration
     */
    name: string
    /**
     * The timestamp of the migration, now by default
     */
    timestamp?: number
}

/**
 * Create an empty migration, written by hand (the data of the tables, the changes the entities do not describe):
 * `<timestamp>-<name>.ts`, its class `<Name><timestamp>` importing its types from @lakutata/orm when the package depends
 * on it, otherwise from lakutata/orm (as the migrations generated)
 * @param options
 * @return the migration, relative to the package
 */
export async function createMigration(options: CreateMigrationOptions): Promise<string> {
    const timestamp: number = options.timestamp ?? Date.now()
    const manifest: Record<string, Record<string, string> | undefined> = JSON.parse(await readFile(path.join(options.directory, 'package.json'), 'utf8'))
    const module: string = manifest.dependencies?.['@lakutata/orm'] || manifest.devDependencies?.['@lakutata/orm'] ? '@lakutata/orm' : 'lakutata/orm'
    const camel: string = camelCase(options.name)
    const className: string = `${camel.charAt(0).toUpperCase()}${camel.slice(1)}${timestamp}`
    const file: string = path.join(options.dir, `${timestamp}-${options.name}.ts`)
    await mkdir(path.resolve(options.directory, options.dir), {recursive: true})
    await writeFile(path.resolve(options.directory, file), `import { MigrationInterface, QueryRunner } from "${module}";

export class ${className} implements MigrationInterface {
    name = '${className}'

    public async up(queryRunner: QueryRunner): Promise<void> {
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
`, {flag: 'wx'})
    return file
}

import {spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import {readdir, readFile} from 'node:fs/promises'
import path from 'node:path'
import {LaunchEnvironment} from './Environment.js'

/**
 * The options of the generation of the migrations
 */
export type GenerateMigrationsOptions = {
    /**
     * The directory of the package of the application
     */
    directory: string
    /**
     * The directory of the migrations, relative to the package
     */
    dir: string
    /**
     * The script of the package building and starting the application
     */
    script: string
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
 * The files of a directory, none when it does not exist
 * @param directory
 */
async function Files(directory: string): Promise<string[]> {
    return existsSync(directory) ? await readdir(directory) : []
}

/**
 * Generate the migrations of an application: its script builds and starts it with MIGRATION_GENERATE, the application
 * compares the entities of its Database components and providers with their databases, writes the migrations of the
 * changes into the directory, and exits (as `cross-env MIGRATION_GENERATE=<dir> npm run <script>` in lakutata 2.x)
 * @param options
 */
export async function GenerateMigrations(options: GenerateMigrationsOptions): Promise<GenerateMigrationsResult> {
    const manifest: { scripts?: Record<string, string> } = JSON.parse(await readFile(path.join(options.directory, 'package.json'), 'utf8'))
    if (!manifest.scripts?.[options.script]) throw new Error(`The package ${options.directory} has no script "${options.script}" building and starting the application (--script)`)
    const directory: string = path.resolve(options.directory, options.dir)
    const before: Set<string> = new Set(await Files(directory))
    const code: number = await new Promise((resolve: (code: number) => void, reject: (error: Error) => void): void => {
        //The output of the application is the one of the command; the package managers are scripts on Windows
        const child = spawn('npm', ['run', options.script], {
            cwd: options.directory,
            shell: process.platform === 'win32',
            stdio: 'inherit',
            env: {...LaunchEnvironment, MIGRATION_GENERATE: options.dir}
        })
        child.once('error', reject)
        child.once('close', (exitCode: number | null): void => resolve(exitCode ?? 1))
    })
    const files: string[] = (await Files(directory)).filter((file: string): boolean => !before.has(file)).sort()
    return {code: code, files: files.map((file: string): string => path.join(options.dir, file))}
}

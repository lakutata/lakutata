import {readdir, readFile, stat, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {Component} from 'lakutata'
import {Autoload, Inject, Singleton} from 'lakutata/decorator/di'
import {Templating} from 'lakutata/helper'
import {Settings} from './Settings.js'
import {type Template, TemplateCatalog} from './TemplateCatalog.js'
import {ExtractTarGz} from './Tar.js'
import {type PackageManager, Run} from './Processes.js'
import {Done, Step, Warn} from './Output.js'

/**
 * What a project is created with
 */
export type ProjectPlan = {
    name: string
    id: string
    description: string
    author: string
    license: string
    template: Template
    /**
     * The directory of the project
     */
    directory: string
    /**
     * The directory exists and is not empty: the project is created in it
     */
    init: boolean
    packageManager: PackageManager | 'none'
    git: boolean
}

/**
 * Whether a file is text: no NUL byte in its beginning
 * @param content
 */
function IsText(content: Buffer): boolean {
    return !content.subarray(0, 8000).includes(0)
}

/**
 * Create the projects from the templates
 */
@Autoload()
@Singleton()
export class ProjectCreator extends Component {

    @Inject(TemplateCatalog)
    protected readonly catalog: TemplateCatalog

    /**
     * Check the directory of a project
     * @param directory
     * @param init the project is created in an existing directory
     */
    public async checkDirectory(directory: string, init: boolean): Promise<void> {
        let exists: boolean = true
        try {
            if (!(await stat(directory)).isDirectory()) throw new Error(`${directory} is not a directory`)
        } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            exists = false
        }
        if (!exists) {
            if (init) throw new Error(`The directory ${directory} does not exist`)
            return
        }
        if (!init && (await readdir(directory)).length) throw new Error(`The directory ${directory} is not empty (--init creates the project in an existing directory)`)
    }

    /**
     * Download the template into the directory
     * @param template
     * @param directory
     */
    protected async pull(template: Template, directory: string): Promise<string[]> {
        const url: string = `${Settings.templateDownload}/${template.repository}/tar.gz/refs/heads/${template.branch}`
        const response: Response = await fetch(url, {headers: {'User-Agent': 'lakutata-cli'}, signal: AbortSignal.timeout(60000)})
        if (!response.ok) throw new Error(`The template ${template.name} cannot be downloaded from ${url}: ${response.status} ${response.statusText}`)
        return await ExtractTarGz(Buffer.from(await response.arrayBuffer()), directory, 1)
    }

    /**
     * Fill the information of the project into the files of the template ({$APP_NAME}…)
     * @param directory
     * @param files
     * @param fields
     */
    protected async fill(directory: string, files: string[], fields: Record<string, string>): Promise<void> {
        for (const file of files) {
            const target: string = path.join(directory, file)
            const content: Buffer = await readFile(target)
            if (!IsText(content)) continue
            const raw: string = content.toString('utf8')
            const filled: string = Templating(raw, fields, {ignoreMissing: true})
            if (filled !== raw) await writeFile(target, filled)
        }
    }

    /**
     * Create a project
     * @param plan
     */
    public async create(plan: ProjectPlan): Promise<void> {
        await this.checkDirectory(plan.directory, plan.init)
        Step(`Downloading the template ${plan.template.name}`)
        const files: string[] = await this.pull(plan.template, plan.directory)
        Done(`Template ${plan.template.name} downloaded (${files.length} files)`)
        await this.fill(plan.directory, files, {
            $APP_NAME: plan.name,
            $APP_ID: plan.id,
            $APP_DESC: plan.description,
            $APP_AUTHOR: plan.author,
            $APP_LICENSE: plan.license
        })
        Done('Project information filled')
        if (plan.packageManager !== 'none') {
            Step(`Installing the dependencies with ${plan.packageManager}`)
            let result: { code: number, output: string }
            try {
                result = await Run(plan.packageManager, ['install'], plan.directory)
            } catch (error: unknown) {
                throw new Error(`${plan.packageManager} cannot be run: ${(error as Error).message}`)
            }
            if (result.code !== 0) throw new Error(`${plan.packageManager} install failed:\n${result.output.trim().split('\n').slice(-20).join('\n')}`)
            Done('Dependencies installed')
        }
        if (plan.git) {
            try {
                const result = await Run('git', ['init'], plan.directory)
                if (result.code === 0) Done('Git repository initialized')
                else Warn(`git init failed: ${result.output.trim()}`)
            } catch {
                Warn('git is not installed, the git repository is not initialized')
            }
        }
    }
}

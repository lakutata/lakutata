import {cp, readdir, readFile, rename, stat, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {Component} from 'lakutata'
import {Autoload, Inject, Singleton} from 'lakutata/decorator/di'
import {Templating} from 'lakutata/helper'
import {type PreparedTemplate, TemplateCatalog, type TemplateSource} from './TemplateCatalog.js'
import {type PackageManager, Run} from './Processes.js'
import {Done, Step, Warn} from './Output.js'
import {FrameworkVersion} from './Versions.js'

/**
 * What a project is created with
 */
export type ProjectPlan = {
    name: string
    id: string
    description: string
    author: string
    license: string
    template: TemplateSource
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
 * The files the npm packages cannot hold under their name, kept as "_<name>" in the templates
 */
const DOTFILES: string[] = ['gitignore', 'npmrc', 'npmignore', 'gitattributes', 'editorconfig', 'dockerignore', 'nvmrc', 'env', 'eslintrc.json', 'prettierrc']

/**
 * The directories of a template which are not copied
 */
const SKIPPED: string[] = ['node_modules', '.git']

/**
 * Whether a file is text: no NUL byte in its beginning
 * @param content
 */
function IsText(content: Buffer): boolean {
    return !content.subarray(0, 8000).includes(0)
}

/**
 * The files of a directory, relative to it
 * @param directory
 * @param base
 */
async function ListFiles(directory: string, base: string = directory): Promise<string[]> {
    const files: string[] = []
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const target: string = path.join(directory, entry.name)
        if (entry.isDirectory()) files.push(...await ListFiles(target, base))
        else if (entry.isFile()) files.push(path.relative(base, target))
    }
    return files
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
     * Copy the files of a template into the directory of the project
     * @param template
     * @param directory
     * @return the paths of the files of the project, relative to its directory
     */
    protected async copy(template: PreparedTemplate, directory: string): Promise<string[]> {
        await cp(template.root, directory, {
            recursive: true,
            filter: (source: string): boolean => !SKIPPED.includes(path.basename(source))
        })
        const files: string[] = []
        for (const file of await ListFiles(directory)) {
            const name: string = path.basename(file)
            //"_gitignore" becomes ".gitignore"
            if (name.startsWith('_') && DOTFILES.includes(name.slice(1))) {
                const renamed: string = path.join(path.dirname(file), `.${name.slice(1)}`)
                await rename(path.join(directory, file), path.join(directory, renamed))
                files.push(renamed)
            } else {
                files.push(file)
            }
        }
        return files
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
        Step('Getting the template')
        const template: PreparedTemplate = await this.catalog.prepare(plan.template)
        let files: string[]
        try {
            files = await this.copy(template, plan.directory)
        } finally {
            await template.cleanup()
        }
        Done(`Template ${template.label} copied (${files.length} files)`)
        await this.fill(plan.directory, files, {
            $APP_NAME: plan.name,
            $APP_ID: plan.id,
            $APP_DESC: plan.description,
            $APP_AUTHOR: plan.author,
            $APP_LICENSE: plan.license,
            $LAKUTATA_VERSION: FrameworkVersion()
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

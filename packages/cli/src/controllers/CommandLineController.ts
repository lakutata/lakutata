import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {CreateProjectDTO} from '../dtos/CreateProjectDTO.js'
import {ListTemplatesDTO} from '../dtos/ListTemplatesDTO.js'
import {CleanDTO} from '../dtos/CleanDTO.js'
import {Clean, OutputDirectories, type CleanResult} from '../lib/Clean.js'
import {TemplateCatalog, type PreparedTemplate, type TemplateInfo, type TemplateSource} from '../lib/TemplateCatalog.js'
import {ProjectCreator, type ProjectPlan} from '../lib/ProjectCreator.js'
import {DetectPackageManager} from '../lib/Processes.js'
import {Done, Styled, Table} from '../lib/Output.js'
import {FrameworkVersion, LatestVersion, ProjectFrameworkVersion, ToolPackage} from '../lib/Versions.js'

/**
 * Whether the tool runs in a terminal, where it asks the questions
 */
function Interactive(): boolean {
    return !!process.stdin.isTTY && !!process.stdout.isTTY
}

export class CommandLineController extends Controller {

    @Inject(TemplateCatalog)
    protected readonly catalog: TemplateCatalog

    @Inject(ProjectCreator)
    protected readonly creator: ProjectCreator

    @CLIAction('create', CreateProjectDTO, {description: 'Create a lakutata project from a template'})
    public async create(input: CreateProjectDTO): Promise<string> {
        const template: TemplateSource = await this.catalog.resolve(input.template)
        const directory: string = input.init ? path.resolve(input.path) : path.resolve(input.path, input.name)
        await this.creator.checkDirectory(directory, input.init)
        const prepared: PreparedTemplate = await this.creator.prepare(template)
        try {
            return await this.createFrom(input, template, prepared, directory)
        } finally {
            await prepared.cleanup()
        }
    }

    /**
     * The features of the template enabled: the ones of --with, or the ones chosen in a terminal
     * @param input
     * @param template
     */
    protected async features(input: CreateProjectDTO, template: PreparedTemplate): Promise<string[]> {
        const available: string[] = Object.keys(template.features)
        if (input.with !== undefined) {
            const features: string[] = [...new Set(input.with.split(',').map((feature: string): string => feature.trim()).filter(Boolean))]
            const unknown: string[] = features.filter((feature: string): boolean => !available.includes(feature))
            if (unknown.length) throw new Error(`The template has no feature ${unknown.join(', ')} (${available.length ? `its features: ${available.join(', ')}` : 'it has no feature'})`)
            return features
        }
        if (!available.length || !Interactive() || input.yes) return []
        const {checkbox} = await import('@inquirer/prompts')
        return await checkbox({
            message: 'The features of the project',
            choices: available.map((feature: string): { name: string, value: string } => ({name: `${feature}: ${template.features[feature]}`, value: feature}))
        })
    }

    /**
     * Create a project from its template
     * @param input
     * @param template
     * @param prepared
     * @param directory
     */
    protected async createFrom(input: CreateProjectDTO, template: TemplateSource, prepared: PreparedTemplate, directory: string): Promise<string> {
        const features: string[] = await this.features(input, prepared)
        const plan: ProjectPlan = {
            name: input.name,
            id: input.id ?? input.name.toLowerCase(),
            description: input.description,
            author: input.author,
            license: input.license,
            template: template,
            directory: directory,
            init: input.init,
            packageManager: input.packageManager ?? DetectPackageManager(),
            git: input.git,
            features: features
        }
        process.stdout.write(Table([
            ['Name', plan.name],
            ['ID', plan.id],
            ['Description', plan.description || '-'],
            ['Author', plan.author || '-'],
            ['License', plan.license],
            ['Template', input.template],
            ...(Object.keys(prepared.features).length ? [['Features', features.length ? features.join(', ') : 'none'] as [string, string]] : []),
            ['Directory', directory],
            ['Dependencies', plan.packageManager === 'none' ? 'not installed' : `installed with ${plan.packageManager}`],
            ['Git', plan.git ? 'initialized' : 'not initialized']
        ], 'The project'))
        if (Interactive() && !input.yes) {
            const {confirm} = await import('@inquirer/prompts')
            if (!await confirm({message: 'Create the project?', default: true})) return 'The project is not created'
        }
        await this.creator.create(plan, prepared)
        //The path of the project from the current directory, or its absolute path when it is elsewhere
        const relative: string = path.relative(process.cwd(), directory)
        const location: string = !relative || relative.startsWith('..') ? directory : relative
        return `\n${Styled('green', 'The project is created')} in ${directory}\n${relative ? `\n  cd ${location}\n` : ''}`
    }

    @CLIAction('templates', ListTemplatesDTO, {description: 'List the project templates'})
    public async templates(input: ListTemplatesDTO): Promise<string> {
        const templates: TemplateInfo[] = await this.catalog.list(input.refresh)
        return `${Table(templates.map((template: TemplateInfo): [string, string] => [template.name, `${template.description}${template.features?.length ? ` (features: ${template.features.join(', ')})` : ''}`]), 'The templates (lakutata create --template <name>)')}
Other templates: --template npm:<package>, github:<owner>/<repo>, or a directory
The features of a template are enabled by lakutata create --with <features>
`
    }

    @CLIAction('clean [paths...]', CleanDTO, {description: 'Remove paths of the package of the current directory, on every platform (the outDir of its tsconfig.json by default)'})
    public async clean(input: CleanDTO): Promise<undefined> {
        const directory: string = process.cwd()
        const paths: string[] = input.paths?.length ? input.paths : await OutputDirectories(directory)
        const result: CleanResult = await Clean(directory, paths)
        Done(result.removed.length ? `Removed ${result.removed.join(', ')}` : `Nothing to remove (${result.missing.join(', ')})`)
        return undefined
    }

    @CLIAction('info', {description: 'Show the versions of the tool and of the framework'})
    public async info(): Promise<string> {
        const tool = ToolPackage()
        const [latestTool, latestFramework] = await Promise.all([LatestVersion(tool.name), LatestVersion('lakutata')])
        const project = await ProjectFrameworkVersion(process.cwd())
        const latest = (version: string | undefined): string => version ? ` (latest ${version})` : ''
        const rows: [string, string][] = [
            ['Tool', `${tool.name} ${tool.version}${latest(latestTool)}`],
            ['Framework', `lakutata ${FrameworkVersion()}${latest(latestFramework)}`],
            ['Node.js', `${process.version} (${process.platform} ${process.arch})`]
        ]
        if (project) rows.push(['Project', `${project.project}: lakutata ${project.installed ?? 'not installed'} (${project.declared})`])
        return Table(rows)
    }
}

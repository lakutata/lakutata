import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {CreateProjectDTO} from '../dtos/CreateProjectDTO.js'
import {ListTemplatesDTO} from '../dtos/ListTemplatesDTO.js'
import {type Template, TemplateCatalog} from '../lib/TemplateCatalog.js'
import {ProjectCreator, type ProjectPlan} from '../lib/ProjectCreator.js'
import {DetectPackageManager} from '../lib/Processes.js'
import {Styled, Table} from '../lib/Output.js'
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
        const template: Template = await this.catalog.find(input.template)
        const directory: string = input.init ? path.resolve(input.path) : path.resolve(input.path, input.name)
        await this.creator.checkDirectory(directory, input.init)
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
            git: input.git
        }
        process.stdout.write(Table([
            ['Name', plan.name],
            ['ID', plan.id],
            ['Description', plan.description || '-'],
            ['Author', plan.author || '-'],
            ['License', plan.license],
            ['Template', `${template.name} (${template.repository})`],
            ['Directory', directory],
            ['Dependencies', plan.packageManager === 'none' ? 'not installed' : `installed with ${plan.packageManager}`],
            ['Git', plan.git ? 'initialized' : 'not initialized']
        ], 'The project'))
        if (Interactive() && !input.yes) {
            const {confirm} = await import('@inquirer/prompts')
            if (!await confirm({message: 'Create the project?', default: true})) return 'The project is not created'
        }
        await this.creator.create(plan)
        //The path of the project from the current directory, or its absolute path when it is elsewhere
        const relative: string = path.relative(process.cwd(), directory)
        const location: string = !relative || relative.startsWith('..') ? directory : relative
        return `\n${Styled('green', 'The project is created')} in ${directory}\n${relative ? `\n  cd ${location}\n` : ''}`
    }

    @CLIAction('templates', ListTemplatesDTO, {description: 'List the project templates'})
    public async templates(input: ListTemplatesDTO): Promise<string> {
        const templates: Template[] = await this.catalog.list(input.refresh)
        return Table(templates.map((template: Template): [string, string] => [template.name, template.description]), 'The templates (lakutata create --template <name>)')
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

import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {RunScriptDTO} from '../dtos/RunScriptDTO.js'
import {VersionDTO} from '../dtos/VersionDTO.js'
import {AddPackageDTO} from '../dtos/AddPackageDTO.js'
import {AddPackage, type AddPackageResult, type NativeBuild} from '../lib/AddPackage.js'
import {Done, Styled, Table} from '../lib/Output.js'
import {Workspace, type WorkspacePackage} from '../lib/workspace/Workspace.js'
import {RunScript, type RunResult} from '../lib/workspace/Run.js'
import {ApplyVersion, PlanVersion, type VersionPlan} from '../lib/workspace/Version.js'

/**
 * The commands of the workspaces: the packages of a project (app, ui, proxy…) built in the order of their dependencies, and given a same version
 */
export class WorkspaceController extends Controller {

    @CLIAction('run <script>', RunScriptDTO, {description: 'Run a script in the packages of the workspace, in the order of their dependencies'})
    public async run(input: RunScriptDTO): Promise<string | undefined> {
        const workspace: Workspace = await Workspace.find()
        const result: RunResult = await RunScript(workspace, input.script, {concurrency: input.concurrency, bail: input.bail, parallel: input.parallel, scope: input.scope})
        if (!result.ran.length) return `No package has the script ${input.script}`
        Done(`${input.script} ran in ${result.ran.join(', ')}`)
        return undefined
    }

    @CLIAction('version <bump>', VersionDTO, {description: 'Give the packages of the workspace their next version, and update the dependencies between them'})
    public async version(input: VersionDTO): Promise<string | undefined> {
        const workspace: Workspace = await Workspace.find()
        const plan: VersionPlan = PlanVersion(workspace, input.bump, input.preid)
        process.stdout.write(Table(plan.packages.map(({name, from}): [string, string] => [name, `${from ?? '-'} → ${plan.to}`]), `Version ${plan.from} → ${Styled('green', plan.to)}`))
        if (process.stdin.isTTY && process.stdout.isTTY && !input.yes) {
            const {confirm} = await import('@inquirer/prompts')
            if (!await confirm({message: 'Give this version?', default: true})) return 'The version is not changed'
        }
        const files: string[] = await ApplyVersion(workspace, plan, {preid: input.preid, git: input.git})
        Done(`Version ${plan.to} given (${files.map((file: string): string => path.relative(workspace.root, file)).join(', ')})${input.git ? `, committed and tagged v${plan.to}` : ''}`)
        return undefined
    }

    @CLIAction('add <name>', AddPackageDTO, {description: 'Add a package to the workspace (packages/<name>): TypeScript, or a native addon with --native [gyp|cmake|rust]'})
    public async add(input: AddPackageDTO): Promise<undefined> {
        const native: NativeBuild | undefined = input.native === true ? 'gyp' : input.native || undefined
        const result: AddPackageResult = await AddPackage({name: input.name, native: native, to: input.to})
        Done(`${native ? `Native addon (${native})` : 'Package'} ${input.name} ${result.version} added: ${path.relative(process.cwd(), result.directory) || '.'} (${result.files.join(', ')})${result.to ? `, a dependency of ${result.to}` : ''}`)
        process.stdout.write(`Next: npm install (links the package${native ? ', builds the addon' : ''}), then npm run rebuild -w ${input.name}\n`)
        return undefined
    }

    @CLIAction('list', {description: 'List the packages of the workspace'})
    public async list(): Promise<string> {
        const workspace: Workspace = await Workspace.find()
        return Table(workspace.packages.map((pkg: WorkspacePackage): [string, string] => [
            pkg.name,
            `${pkg.version ?? '-'}${pkg.private ? ' (private)' : ''}  ${path.relative(workspace.root, pkg.directory)}${pkg.dependencies.length ? `  → ${pkg.dependencies.join(', ')}` : ''}`
        ]), `${workspace.packages.length} packages, version ${workspace.version ?? '-'}`)
    }
}

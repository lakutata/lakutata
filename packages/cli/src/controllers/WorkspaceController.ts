import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {RunScriptDTO} from '../dtos/RunScriptDTO.js'
import {VersionDTO} from '../dtos/VersionDTO.js'
import {AddPackageDTO} from '../dtos/AddPackageDTO.js'
import {addPackage, type AddPackageResult, type NativeBuild} from '../lib/AddPackage.js'
import {done, styled, table} from '../lib/Output.js'
import {Workspace, type WorkspacePackage} from '../lib/workspace/Workspace.js'
import {runScript, type RunResult} from '../lib/workspace/Run.js'
import {applyVersion, planVersion, type VersionPlan} from '../lib/workspace/Version.js'
import {Inject} from 'lakutata/decorator/di'
import {Translator} from 'lakutata/com/i18n'
import {localize} from '../lib/Language.js'

/**
 * The commands of the workspaces: the packages of a project (app, ui, proxy…) built in the order of their dependencies, and given a same version
 */
export class WorkspaceController extends Controller {

    /**
     * The prompts in the language of the user
     */
    @Inject(Translator)
    protected readonly i18n: Translator

    @CLIAction('run <script>', RunScriptDTO, {description: 'Run a script in the packages of the workspace, in the order of their dependencies'})
    public async run(input: RunScriptDTO): Promise<string | undefined> {
        const workspace: Workspace = await Workspace.find()
        const result: RunResult = await runScript(workspace, input.script, {concurrency: input.concurrency, bail: input.bail, parallel: input.parallel, scope: input.scope})
        if (!result.ran.length) return `No package has the script ${input.script}`
        done(`${input.script} ran in ${result.ran.join(', ')}`)
        return undefined
    }

    @CLIAction('version <bump>', VersionDTO, {description: 'Give the packages of the workspace their next version, and update the dependencies between them'})
    public async version(input: VersionDTO): Promise<string | undefined> {
        const workspace: Workspace = await Workspace.find()
        const plan: VersionPlan = planVersion(workspace, input.bump, input.preid)
        process.stdout.write(table(plan.packages.map(({name, from}): [string, string] => [name, `${from ?? '-'} → ${plan.to}`]), localize(this.i18n, 'plan.version', 'Version {from} → {to}', {from: plan.from, to: styled('green', plan.to)})))
        if (process.stdin.isTTY && process.stdout.isTTY && !input.yes) {
            const {confirm} = await import('@inquirer/prompts')
            if (!await confirm({message: localize(this.i18n, 'prompts.version', 'Give this version?'), default: true})) return localize(this.i18n, 'prompts.notVersioned', 'The version is not changed')
        }
        const files: string[] = await applyVersion(workspace, plan, {preid: input.preid, git: input.git})
        done(`Version ${plan.to} given (${files.map((file: string): string => path.relative(workspace.root, file)).join(', ')})${input.git ? `, committed and tagged v${plan.to}` : ''}`)
        return undefined
    }

    @CLIAction('add <name>', AddPackageDTO, {description: 'Add a package to the workspace (in its directory of packages: packages/<name>): TypeScript, or a native addon with --native [gyp|cmake|rust]'})
    public async add(input: AddPackageDTO): Promise<undefined> {
        const native: NativeBuild | undefined = input.native === true ? 'gyp' : input.native || undefined
        const result: AddPackageResult = await addPackage({name: input.name, native: native, to: input.to})
        done(`${native ? `Native addon (${native})` : 'Package'} ${input.name} ${result.version} added: ${path.relative(process.cwd(), result.directory) || '.'} (${result.files.join(', ')})${result.to ? `, a dependency of ${result.to}` : ''}`)
        //The command building the package, by the package manager of the workspace
        const rebuild: string = {npm: `npm run rebuild -w ${input.name}`, pnpm: `pnpm --filter ${input.name} run rebuild`, yarn: `yarn workspace ${input.name} run rebuild`}[result.packageManager]
        process.stdout.write(`Next: ${result.packageManager} install (links the package${native ? ', builds the addon' : ''}), then ${rebuild}\n`)
        return undefined
    }

    @CLIAction('list', {description: 'List the packages of the workspace'})
    public async list(): Promise<string> {
        const workspace: Workspace = await Workspace.find()
        return table(workspace.packages.map((pkg: WorkspacePackage): [string, string] => [
            pkg.name,
            `${pkg.version ?? '-'}${pkg.private ? ' (private)' : ''}  ${path.relative(workspace.root, pkg.directory)}${pkg.dependencies.length ? `  → ${pkg.dependencies.join(', ')}` : ''}`
        ]), `${workspace.packages.length} ${workspace.packages.length === 1 ? 'package' : 'packages'}, version ${workspace.version ?? '-'}`)
    }
}

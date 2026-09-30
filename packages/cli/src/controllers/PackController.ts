import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {BundleDTO} from '../dtos/BundleDTO.js'
import {ExecutableDTO} from '../dtos/ExecutableDTO.js'
import {Done, Step} from '../lib/Output.js'
import {BundleProject, type BundleResult} from '../lib/pack/Bundle.js'
import {BuildExecutables, type ExecutableResult} from '../lib/pack/Executable.js'
import {ParseTarget} from '../lib/pack/NodeBinary.js'

/**
 * A size in megabytes
 * @param size
 */
function Megabytes(size: number): string {
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The commands packing the application of the current directory: into one JavaScript file, or into executables
 */
export class PackController extends Controller {

    @CLIAction('bundle', BundleDTO, {description: 'Bundle the compiled application and its dependencies into one file run by node'})
    public async bundle(input: BundleDTO): Promise<undefined> {
        const result: BundleResult = await BundleProject({project: process.cwd(), entry: input.entry, outfile: input.outfile, minify: input.minify, external: input.external})
        Done(`${path.relative(process.cwd(), result.outfile)} (${Megabytes(result.size)}): node ${path.relative(process.cwd(), result.outfile)}`)
        //The native addons are next to the bundle, which is distributed with them
        if (result.nativeDirectory) Done(`${path.relative(process.cwd(), result.nativeDirectory)}: the native addons (${result.native!.modules.join(', ') || 'of the application'}), distributed with the bundle`)
        return undefined
    }

    @CLIAction('executable', ExecutableDTO, {description: 'Make the executables of the compiled application, which run without Node.js installed'})
    public async executable(input: ExecutableDTO): Promise<undefined> {
        const targets = input.target?.map(ParseTarget)
        Step(`Node.js ${process.version} embedded${targets ? `, for ${targets.map(({name}): string => name).join(', ')}` : ''}`)
        const result: ExecutableResult = await BuildExecutables({project: process.cwd(), entry: input.entry, outdir: input.outdir, minify: input.minify, external: input.external, targets: targets})
        if (result.native.length) Step(`Native addons embedded, extracted at the first run: ${result.native.join(', ')}`)
        for (const {target, file, size} of result.executables) Done(`${path.relative(process.cwd(), file)} (${target.name}, ${Megabytes(size)})`)
        return undefined
    }
}

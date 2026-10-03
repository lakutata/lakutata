import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {BundleDTO} from '../dtos/BundleDTO.js'
import {ExecutableDTO} from '../dtos/ExecutableDTO.js'
import {Done, Step} from '../lib/Output.js'
import {BundleProject, type BundleResult} from '../lib/pack/Bundle.js'
import {BuildExecutable, type ExecutableResult} from '../lib/pack/Executable.js'

/**
 * A size in megabytes
 * @param size
 */
function Megabytes(size: number): string {
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The commands packing the application of the current directory: into one JavaScript file, or into an executable
 */
export class PackController extends Controller {

    @CLIAction('bundle', BundleDTO, {description: 'Bundle the compiled application and its dependencies into one file run by node'})
    public async bundle(input: BundleDTO): Promise<undefined> {
        const result: BundleResult = await BundleProject({project: process.cwd(), entry: input.entry, outfile: input.outfile, minify: input.minify, external: input.external})
        Done(`${path.relative(process.cwd(), result.outfile)} (${Megabytes(result.size)}): node ${path.relative(process.cwd(), result.outfile)}`)
        //The native addons are next to the bundle, which is distributed with them
        if (result.nativeDirectory) Done(`${path.relative(process.cwd(), result.nativeDirectory)}: the native addons (${result.native!.modules.join(', ') || 'of the application'}), distributed with the bundle`)
        if (result.resourcesDirectory) Done(`${path.relative(process.cwd(), result.resourcesDirectory)}: the resources (${result.resources.join(', ')}), distributed with the bundle`)
        return undefined
    }

    @CLIAction('executable', ExecutableDTO, {description: 'Make the executable of the compiled application for this platform, which runs without Node.js installed'})
    public async executable(input: ExecutableDTO): Promise<undefined> {
        const result: ExecutableResult = await BuildExecutable({project: process.cwd(), entry: input.entry, outdir: input.outdir, minify: input.minify, external: input.external, runtime: input.runtime, layout: input.layout})
        Step(`${result.runtime} embedded`)
        if (result.native.length) Step(result.directory ? `Native addons next to the executable: ${result.native.join(', ')}` : `Native addons embedded, extracted at the first run: ${result.native.join(', ')}`)
        if (result.resources.length) Step(result.directory ? `Resources next to the executable: ${result.resources.join(', ')}` : `Resources embedded, extracted at the first run: ${result.resources.join(', ')}`)
        if (result.directory) Done(`${path.relative(process.cwd(), result.directory)}: the executable and what it loads, distributed together`)
        Done(`${path.relative(process.cwd(), result.file)} (${result.platform}, ${Megabytes(result.size)})`)
        return undefined
    }
}

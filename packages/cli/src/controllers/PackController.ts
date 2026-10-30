import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {BundleDTO} from '../dtos/BundleDTO.js'
import {ExecutableDTO} from '../dtos/ExecutableDTO.js'
import {InstallerDTO} from '../dtos/InstallerDTO.js'
import type {BundleResult, ExecutableResult, InstallerResult} from '@lakutata/builder'
import {loadBuilder} from '../lib/Builder.js'
import {done, step, warn} from '../lib/Output.js'

/**
 * A size in megabytes
 * @param size
 */
function megabytes(size: number): string {
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The commands packing the application of the current directory (lakutata package): into one JavaScript file, into an
 * executable, or into its installers
 */
export class PackController extends Controller {

    @CLIAction('package bundle', BundleDTO, {description: 'Bundle the compiled application and its dependencies into one file run by node'})
    public async bundle(input: BundleDTO): Promise<undefined> {
        const {bundleProject} = await loadBuilder(process.cwd())
        const result: BundleResult = await bundleProject({project: process.cwd(), entry: input.entry, outfile: input.outfile, minify: input.minify, external: input.external, node: input.node})
        done(`${path.relative(process.cwd(), result.outfile)} (${megabytes(result.size)}): node ${path.relative(process.cwd(), result.outfile)}`)
        //The native addons and the scripts of the workers are next to the bundle, which is distributed with them
        if (result.nativeDirectory) {
            const addons: boolean = !!result.native!.modules.length || result.native!.files.some((file): boolean => file.path.endsWith('.node'))
            const contents: string[] = [
                ...addons ? [`the native addons (${result.native!.modules.join(', ') || 'of the application'})`] : [],
                ...result.workers.length ? [`the scripts run on their own (${result.workers.join(', ')})`] : [],
                ...result.files.length ? [`the files read by their paths (${result.files.join(', ')})`] : []
            ]
            done(`${path.relative(process.cwd(), result.nativeDirectory)}: ${contents.join(' and ')}, distributed with the bundle`)
        }
        if (result.resourcesDirectory) done(`${path.relative(process.cwd(), result.resourcesDirectory)}: the resources (${result.resources.join(', ')}), distributed with the bundle`)
        for (const warning of result.warnings) warn(warning)
        return undefined
    }

    @CLIAction('package exe', ExecutableDTO, {description: 'Make the executable of the compiled application for this platform, which runs without Node.js installed'})
    public async executable(input: ExecutableDTO): Promise<undefined> {
        const {buildExecutable} = await loadBuilder(process.cwd())
        const result: ExecutableResult = await buildExecutable({project: process.cwd(), entry: input.entry, outdir: input.outdir, minify: input.minify, external: input.external, runtime: input.runtime, layout: input.layout, nodeProgram: input.nodeProgram})
        step(`${result.runtime} embedded`)
        if (result.native.length) step(result.directory ? `Native addons next to the executable: ${result.native.join(', ')}` : `Native addons embedded, extracted at the first run: ${result.native.join(', ')}`)
        if (result.resources.length) step(result.directory ? `Resources next to the executable: ${result.resources.join(', ')}` : `Resources embedded, extracted at the first run: ${result.resources.join(', ')}`)
        if (result.workers.length) step(result.directory ? `Scripts run on their own next to the executable: ${result.workers.join(', ')}` : `Scripts run on their own embedded, extracted at the first run: ${result.workers.join(', ')}`)
        if (result.files.length) step(result.directory ? `Files read by their paths next to the executable: ${result.files.join(', ')}` : `Files read by their paths embedded, extracted at the first run: ${result.files.join(', ')}`)
        for (const warning of result.warnings) warn(warning)
        if (result.directory) done(`${path.relative(process.cwd(), result.directory)}: the executable and what it loads, distributed together`)
        done(`${path.relative(process.cwd(), result.file)} (${result.platform}, ${megabytes(result.size)})`)
        return undefined
    }

    @CLIAction('package installer', InstallerDTO, {description: 'Make the installers of the compiled application for this platform: its executable, its native addons and its resources installed, its program in the PATH, its service registered'})
    public async installer(input: InstallerDTO): Promise<undefined> {
        const {buildInstaller} = await loadBuilder(process.cwd())
        const result: InstallerResult = await buildInstaller({project: process.cwd(), targets: input.target, outdir: input.outdir, entry: input.entry, minify: input.minify, external: input.external, nodeProgram: input.nodeProgram})
        step(`${result.executable.runtime} embedded`)
        if (result.executable.native.length) step(`Native addons: ${result.executable.native.join(', ')}`)
        if (result.executable.resources.length) step(`Resources: ${result.executable.resources.join(', ')}`)
        for (const warning of result.warnings) warn(warning)
        for (const file of result.files) done(`${path.relative(process.cwd(), file.file)} (${file.target}, ${megabytes(file.size)})`)
        return undefined
    }
}

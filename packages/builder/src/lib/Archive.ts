import {rm, stat} from 'node:fs/promises'
import path from 'node:path'
import {copyDirectory} from './Directories.js'
import {runCommand} from './Processes.js'
import type {InstallerPlan} from './Installer.js'

/**
 * The tar.gz archive of the directory of the executable (its native addons and its resources next to it), named after
 * the package, its version, its platform and its architecture
 * @param plan
 * @param arch
 * @param work
 * @param outdir
 */
export async function archiveDirectory(plan: InstallerPlan, arch: string, work: string, outdir: string): Promise<{ target: string, file: string, size: number }> {
    const base: string = `${plan.name}-${plan.version}-${process.platform}-${arch}`
    await rm(path.join(work, base), {recursive: true, force: true})
    await copyDirectory(plan.directory, path.join(work, base))
    const file: string = path.join(outdir, `${base}.tar.gz`)
    const archived = await runCommand('tar', ['-czf', file, base], work)
    if (archived.code !== 0) throw new Error(`The tar.gz archive cannot be made: ${archived.output.trim()}`)
    return {target: 'tar.gz', file: file, size: (await stat(file)).size}
}

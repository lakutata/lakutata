import {createHash} from 'node:crypto'
import {existsSync} from 'node:fs'
import {chmod, mkdir, mkdtemp, rename, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {Run} from './Processes.js'

/**
 * A tool the builder downloads (as electron-builder downloads its tools): its version, and the archives of its releases
 * by platform with their sha256, written here (the checksums are not downloaded with the archives)
 */
type Tool = {
    version: string
    executable: string
    url: (archive: string) => string
    archives: Record<string, { archive: string, sha256: string }>
}

/**
 * The tools of the builder
 */
const TOOLS: Record<'nfpm', Tool> = {
    //The packages of Linux (deb, rpm, apk, archlinux), made on Linux: https://nfpm.goreleaser.com
    nfpm: {
        version: '2.47.0',
        executable: 'nfpm',
        url: (archive: string): string => `https://github.com/goreleaser/nfpm/releases/download/v2.47.0/${archive}`,
        archives: {
            'linux-x64': {archive: 'nfpm_2.47.0_Linux_x86_64.tar.gz', sha256: '0660ca602b2d2d2ae4781a06c692b3eeb9d437ffea05b831d76e41f4a3188783'},
            'linux-arm64': {archive: 'nfpm_2.47.0_Linux_arm64.tar.gz', sha256: '1c0f5f2999b9a974bfb04fdb0cc3306096de530ac5dbb25d739cc5f5219c919c'}
        }
    }
}

/**
 * The directory of the cache of lakutata (the one of its tool): LAKUTATA_CACHE_DIR, else ~/.cache/lakutata
 */
export function CacheDirectory(): string {
    return process.env.LAKUTATA_CACHE_DIR ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'lakutata')
}

/**
 * A tool of the builder: the one given by its environment variable (LAKUTATA_NFPM), else the version of the builder,
 * downloaded once into the cache and checked with its sha256
 * @param name
 */
export async function EnsureTool(name: keyof typeof TOOLS): Promise<string> {
    const given: string | undefined = process.env[`LAKUTATA_${name.toUpperCase()}`]
    if (given) return given
    const tool: Tool = TOOLS[name]
    const platform: string = `${process.platform}-${process.arch}`
    const release = tool.archives[platform]
    if (!release) throw new Error(`${name} ${tool.version} has no release for ${platform}: give its executable (LAKUTATA_${name.toUpperCase()})`)
    const directory: string = path.join(CacheDirectory(), 'tools', `${name}-${tool.version}-${platform}`)
    const executable: string = path.join(directory, tool.executable)
    if (existsSync(executable)) return executable
    const response: Response = await fetch(tool.url(release.archive)).catch((error: Error): never => {
        throw new Error(`${name} cannot be downloaded (${error.message}): give its executable (LAKUTATA_${name.toUpperCase()})`)
    })
    if (!response.ok) throw new Error(`${name} cannot be downloaded (${tool.url(release.archive)}: ${response.status}): give its executable (LAKUTATA_${name.toUpperCase()})`)
    const archive: Buffer = Buffer.from(await response.arrayBuffer())
    const sha256: string = createHash('sha256').update(archive).digest('hex')
    if (sha256 !== release.sha256) throw new Error(`The archive of ${name} ${tool.version} downloaded is not the one of its release (sha256 ${sha256})`)
    //Extracted aside, then renamed: the builds running together do not see it partly written
    await mkdir(path.dirname(directory), {recursive: true})
    const temporary: string = await mkdtemp(`${directory}.`)
    try {
        await writeFile(path.join(temporary, release.archive), archive)
        const extracted = await Run('tar', ['-xzf', release.archive], temporary)
        if (extracted.code !== 0) throw new Error(`The archive of ${name} cannot be extracted: ${extracted.output.trim()}`)
        await rm(path.join(temporary, release.archive))
        await chmod(path.join(temporary, tool.executable), 0o755)
        await rename(temporary, directory).catch((error: Error): void => {
            //Extracted by another build
            if (!existsSync(executable)) throw error
        })
    } finally {
        await rm(temporary, {recursive: true, force: true})
    }
    return executable
}


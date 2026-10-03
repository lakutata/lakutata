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
    /**
     * The executable, in the archive (its path, "/" separated), or the file downloaded
     */
    executable: string
    url: (archive: string) => string
    archives: Record<string, { archive: string, sha256: string }>
}

/**
 * The tools of Windows: the same files on x64 and arm64 (x86 and .NET, emulated or AnyCPU)
 * @param archive
 * @param sha256
 */
function Windows(archive: string, sha256: string): Record<string, { archive: string, sha256: string }> {
    return {'win32-x64': {archive: archive, sha256: sha256}, 'win32-arm64': {archive: archive, sha256: sha256}}
}

/**
 * The tools of the builder
 */
const TOOLS: Record<'nfpm' | 'winsw' | 'nsis' | 'wix', Tool> = {
    //The packages of Linux (deb, rpm, apk, archlinux), made on Linux: https://nfpm.goreleaser.com
    nfpm: {
        version: '2.47.0',
        executable: 'nfpm',
        url: (archive: string): string => `https://github.com/goreleaser/nfpm/releases/download/v2.47.0/${archive}`,
        archives: {
            'linux-x64': {archive: 'nfpm_2.47.0_Linux_x86_64.tar.gz', sha256: '0660ca602b2d2d2ae4781a06c692b3eeb9d437ffea05b831d76e41f4a3188783'},
            'linux-arm64': {archive: 'nfpm_2.47.0_Linux_arm64.tar.gz', sha256: '1c0f5f2999b9a974bfb04fdb0cc3306096de530ac5dbb25d739cc5f5219c919c'}
        }
    },
    //The wrapper of the services of Windows (.NET Framework, AnyCPU): https://github.com/winsw/winsw
    winsw: {
        version: '2.12.0',
        executable: 'WinSW.NET461.exe',
        url: (archive: string): string => `https://github.com/winsw/winsw/releases/download/v2.12.0/${archive}`,
        archives: Windows('WinSW.NET461.exe', 'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f')
    },
    //The installers of Windows (.exe): https://nsis.sourceforge.io
    nsis: {
        version: '3.13',
        executable: 'nsis-3.13/makensis.exe',
        url: (archive: string): string => `https://sourceforge.net/projects/nsis/files/NSIS%203/3.13/${archive}/download`,
        archives: Windows('nsis-3.13.zip', 'ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8')
    },
    //The packages of Windows Installer (.msi), candle and light: https://github.com/wixtoolset/wix3
    wix: {
        version: '3.14.1',
        executable: 'candle.exe',
        url: (archive: string): string => `https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/${archive}`,
        archives: Windows('wix314-binaries.zip', '6ac824e1642d6f7277d0ed7ea09411a508f6116ba6fae0aa5f2c7daa2ff43d31')
    }
}

/**
 * The directory of the cache of lakutata (the one of its tool): LAKUTATA_CACHE_DIR, else ~/.cache/lakutata
 */
export function CacheDirectory(): string {
    return process.env.LAKUTATA_CACHE_DIR ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'lakutata')
}

/**
 * A tool of the builder: the one given by its environment variable (LAKUTATA_NFPM, LAKUTATA_WINSW, LAKUTATA_NSIS:
 * makensis.exe, LAKUTATA_WIX: candle.exe, next to light.exe), else the version of the builder, downloaded once into the
 * cache and checked with its sha256
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
    const executable: string = path.join(directory, ...tool.executable.split('/'))
    if (existsSync(executable)) return executable
    //SourceForge answers the browsers with its page, the tools with the file
    const response: Response = await fetch(tool.url(release.archive), {headers: {'user-agent': 'Wget'}}).catch((error: Error): never => {
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
        //An archive (tar.gz, zip: the tar of Windows reads them), or the executable itself
        if (/\.(tar\.gz|zip)$/.test(release.archive)) {
            const extracted = await Run('tar', ['-xf', release.archive], temporary)
            if (extracted.code !== 0) throw new Error(`The archive of ${name} cannot be extracted: ${extracted.output.trim()}`)
            await rm(path.join(temporary, release.archive))
        }
        await chmod(path.join(temporary, ...tool.executable.split('/')), 0o755)
        await rename(temporary, directory).catch((error: Error): void => {
            //Extracted by another build
            if (!existsSync(executable)) throw error
        })
    } finally {
        await rm(temporary, {recursive: true, force: true})
    }
    return executable
}


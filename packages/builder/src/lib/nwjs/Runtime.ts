import {createHash, type Hash} from 'node:crypto'
import {existsSync} from 'node:fs'
import {mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile, type FileHandle} from 'node:fs/promises'
import path from 'node:path'
import {runCommand} from '../Processes.js'
import {cacheDirectory} from '../Tools.js'

/**
 * A release of NW.js: its version and the ones of the Node.js and the Chromium it embeds, the systems it is built for
 */
export type NwjsRelease = {
    /**
     * The version of NW.js (0.119.2)
     */
    version: string
    /**
     * The day it was released (2026/10/22)
     */
    date: string
    /**
     * The version of the Node.js it embeds (26.12.1)
     */
    node: string
    /**
     * The version of the Chromium it embeds (156.0.8078.48)
     */
    chromium: string
    /**
     * The systems it is built for: win-x64, win-ia32, win-arm64, osx-x64, osx-arm64, linux-x64, linux-ia32, linux-arm64
     */
    platforms: string[]
}

/**
 * The flavors of NW.js: normal (the one shipped), sdk (with the developer tools, for the development)
 */
export type NwjsFlavor = 'normal' | 'sdk'

/**
 * The options of {@link downloadNwjs}
 */
export type NwjsRuntimeOptions = {
    /**
     * The version of NW.js: a version (0.72.0), latest (the latest release) or win7 (0.72.0, the last one running on
     * Windows 7, 8 and 8.1)
     */
    version: string
    /**
     * normal (by default) or sdk
     */
    flavor?: NwjsFlavor
    /**
     * The system (process.platform: win32, darwin, linux), the one of the machine by default
     */
    platform?: NodeJS.Platform
    /**
     * The architecture (process.arch: x64, ia32, arm64), the one of the machine by default. On a Mac with Apple silicon,
     * a release without osx-arm64 (before 0.77) is the x64 one, run by Rosetta
     */
    arch?: string
}

/**
 * A runtime of NW.js, downloaded into the cache
 */
export type NwjsRuntime = NwjsRelease & {
    flavor: NwjsFlavor
    /**
     * Its system and its architecture as NW.js names them (osx-arm64)
     */
    platform: string
    /**
     * The directory of the runtime: nw.exe and its libraries, nwjs.app, nw and its libraries
     */
    directory: string
    /**
     * Its executable: nw.exe, nwjs.app/Contents/MacOS/nwjs, nw
     */
    executable: string
}

/**
 * The oldest Node.js lakutata runs on: the releases of NW.js embedding an older one are refused
 */
const OLDEST_NODE: string = '18.10.0'

/**
 * The aliases of the versions
 */
const ALIASES: Record<string, string> = {win7: '0.72.0'}

/**
 * The releases are read again after a day
 */
const RELEASES_TTL: number = 24 * 60 * 60 * 1000

/**
 * Where the releases are downloaded from: LAKUTATA_NWJS_MIRROR (a mirror of dl.nwjs.io), else dl.nwjs.io
 */
function mirror(): string {
    return (process.env.LAKUTATA_NWJS_MIRROR ?? 'https://dl.nwjs.io').replace(/\/+$/, '')
}

/**
 * Compare two versions (1.2.3)
 * @param left
 * @param right
 */
export function compareVersions(left: string, right: string): number {
    const parts = (version: string): number[] => version.replace(/^v/, '').split('.').map((part: string): number => parseInt(part, 10) || 0)
    const [a, b] = [parts(left), parts(right)]
    for (let index: number = 0; index < Math.max(a.length, b.length); index++) {
        const difference: number = (a[index] ?? 0) - (b[index] ?? 0)
        if (difference) return difference
    }
    return 0
}

/**
 * The releases of NW.js, newest first: the list of nwjs.io (LAKUTATA_NWJS_VERSIONS), kept a day in the cache; the
 * cached one when it cannot be read
 * @example
 * import {nwjsReleases} from '@lakutata/builder'
 *
 * for (const release of (await nwjsReleases()).slice(0, 3)) console.log(release.version, release.node, release.chromium)
 */
export async function nwjsReleases(): Promise<NwjsRelease[]> {
    const cache: string = path.join(cacheDirectory(), 'nwjs', 'versions.json')
    const fresh: boolean = existsSync(cache) && Date.now() - (await stat(cache)).mtimeMs < RELEASES_TTL
    let list: unknown
    if (!fresh) {
        try {
            const response: Response = await fetch(process.env.LAKUTATA_NWJS_VERSIONS ?? 'https://nwjs.io/versions.json')
            if (!response.ok) throw new Error(`${response.status}`)
            list = await response.json()
            await mkdir(path.dirname(cache), {recursive: true})
            await writeFile(cache, JSON.stringify(list))
        } catch (error) {
            if (!existsSync(cache)) throw new Error(`The releases of NW.js cannot be read (${(error as Error).message}): LAKUTATA_NWJS_VERSIONS gives another list`, {cause: error})
        }
    }
    list ??= JSON.parse(await readFile(cache, 'utf8'))
    const versions: any[] = (list as { versions?: any[] }).versions ?? []
    return versions.map((entry: any): NwjsRelease => ({
        version: String(entry.version).replace(/^v/, ''),
        date: String(entry.date ?? ''),
        node: String(entry.components?.node ?? ''),
        chromium: String(entry.components?.chromium ?? ''),
        platforms: (entry.files ?? []).map((file: string): string => String(file).replace(/-symbol$/, '')).filter((file: string): boolean => /^(win|osx|linux)-/.test(file))
    })).sort((a: NwjsRelease, b: NwjsRelease): number => compareVersions(b.version, a.version))
}

/**
 * A release of NW.js: a version, latest (the latest release) or win7 (0.72.0, the last one running on Windows 7, 8
 * and 8.1). Refused when it embeds a Node.js older than the one lakutata runs on (18.10)
 * @param version
 * @example
 * import {nwjsRelease} from '@lakutata/builder'
 *
 * const release = await nwjsRelease('win7')
 * console.log(release.version, release.node, release.chromium) //0.72.0 19.3.0 109.0.5414.87
 */
export async function nwjsRelease(version: string): Promise<NwjsRelease> {
    const releases: NwjsRelease[] = await nwjsReleases()
    const wanted: string = ALIASES[version] ?? version.replace(/^v/, '')
    const release: NwjsRelease | undefined = wanted === 'latest' ? releases[0] : releases.find((item: NwjsRelease): boolean => item.version === wanted)
    if (!release) throw new Error(`NW.js ${version} is not a release of NW.js (the latest: ${releases[0]?.version})`)
    if (compareVersions(release.node, OLDEST_NODE) < 0) throw new Error(`NW.js ${release.version} embeds Node.js ${release.node}: lakutata runs on Node.js ${OLDEST_NODE} or later (NW.js 0.70.0 or later)`)
    return release
}

/**
 * The system and the architecture of a release as NW.js names them (osx-arm64), the x64 build on a Mac with Apple
 * silicon when the release has no arm64 one
 * @param release
 * @param platform
 * @param arch
 */
export function nwjsPlatform(release: NwjsRelease, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
    const system: string | undefined = {win32: 'win', darwin: 'osx', linux: 'linux'}[platform as string]
    if (!system) throw new Error(`NW.js has no build for ${platform}`)
    const name: string = `${system}-${arch}`
    if (release.platforms.includes(name)) return name
    if (system === 'osx' && arch === 'arm64' && release.platforms.includes('osx-x64')) return 'osx-x64'
    throw new Error(`NW.js ${release.version} has no build for ${name} (${release.platforms.join(', ')})`)
}

/**
 * The sha256 of the files of a release, from its SHASUMS256.txt
 * @param version
 */
async function checksums(version: string): Promise<Map<string, string>> {
    const url: string = `${mirror()}/v${version}/SHASUMS256.txt`
    const response: Response = await fetch(url)
    if (!response.ok) throw new Error(`The checksums of NW.js ${version} cannot be read (${url}: ${response.status})`)
    const sums: Map<string, string> = new Map()
    for (const line of (await response.text()).split('\n')) {
        const match: RegExpMatchArray | null = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/)
        if (match) sums.set(match[2], match[1])
    }
    return sums
}

/**
 * Download a file, its sha256 computed while it is written
 * @param url
 * @param file
 */
async function download(url: string, file: string): Promise<string> {
    const response: Response = await fetch(url)
    if (!response.ok || !response.body) throw new Error(`${url} cannot be downloaded (${response.status})`)
    const hash: Hash = createHash('sha256')
    const handle: FileHandle = await open(file, 'w')
    try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            hash.update(chunk)
            await handle.write(chunk)
        }
    } finally {
        await handle.close()
    }
    return hash.digest('hex')
}

/**
 * The executable of a runtime in its directory
 * @param platform
 */
function executableOf(platform: string): string {
    if (platform.startsWith('win-')) return 'nw.exe'
    if (platform.startsWith('osx-')) return path.join('nwjs.app', 'Contents', 'MacOS', 'nwjs')
    return 'nw'
}

/**
 * A runtime of NW.js for a system, downloaded once into the cache (~/.cache/lakutata/nwjs, LAKUTATA_CACHE_DIR) from
 * dl.nwjs.io (LAKUTATA_NWJS_MIRROR: a mirror of it) and checked with the SHASUMS256.txt of its release
 * @param options
 * @example
 * import {downloadNwjs} from '@lakutata/builder'
 *
 * //The NW.js of the development (its developer tools), for the machine
 * const runtime = await downloadNwjs({version: 'latest', flavor: 'sdk'})
 * console.log(runtime.executable, runtime.node)
 */
export async function downloadNwjs(options: NwjsRuntimeOptions): Promise<NwjsRuntime> {
    const release: NwjsRelease = await nwjsRelease(options.version)
    const flavor: NwjsFlavor = options.flavor ?? 'normal'
    const platform: string = nwjsPlatform(release, options.platform, options.arch)
    const name: string = `nwjs${flavor === 'sdk' ? '-sdk' : ''}-v${release.version}-${platform}`
    const archive: string = `${name}.${platform.startsWith('linux-') ? 'tar.gz' : 'zip'}`
    const target: string = path.join(cacheDirectory(), 'nwjs', name)
    const runtime: NwjsRuntime = {...release, flavor: flavor, platform: platform, directory: target, executable: path.join(target, executableOf(platform))}
    if (existsSync(runtime.executable)) return runtime
    const sum: string | undefined = (await checksums(release.version)).get(archive)
    if (!sum) throw new Error(`NW.js ${release.version} has no ${archive} in its checksums`)
    //Extracted aside, then renamed: the builds running together do not see it partly written
    await mkdir(path.dirname(target), {recursive: true})
    const temporary: string = await mkdtemp(`${target}.`)
    try {
        const file: string = path.join(temporary, archive)
        const downloaded: string = await download(`${mirror()}/v${release.version}/${archive}`, file)
        if (downloaded !== sum) throw new Error(`The ${archive} downloaded is not the one of NW.js ${release.version} (sha256 ${downloaded}, ${sum} expected)`)
        //ditto keeps the links of the frameworks of macOS; the tar of Windows reads the zip archives
        const extracted = process.platform === 'darwin' && archive.endsWith('.zip')
            ? await runCommand('ditto', ['-x', '-k', archive, '.'], temporary)
            : await runCommand('tar', ['-xf', archive], temporary)
        if (extracted.code !== 0) throw new Error(`${archive} cannot be extracted: ${extracted.output.trim()}`)
        if (!existsSync(path.join(temporary, name, executableOf(platform)))) throw new Error(`${archive} has no ${name}/${executableOf(platform).split(path.sep).join('/')}`)
        await rename(path.join(temporary, name), target).catch((error: Error): void => {
            //Extracted by another build
            if (!existsSync(runtime.executable)) throw error
        })
    } finally {
        await rm(temporary, {recursive: true, force: true})
    }
    return runtime
}

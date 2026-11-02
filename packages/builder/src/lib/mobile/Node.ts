import {existsSync, readFileSync} from 'node:fs'
import {cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {runCommand} from '../Processes.js'
import {cacheDirectory, downloadFile, moveIntoCache} from '../Tools.js'

/**
 * The version of Node.js of the mobile applications when their libnode does not tell it: the one of the release of
 * lakutata/libnode they download (MOBILE_NODE_RELEASE)
 */
export const MOBILE_NODE_VERSION: string = '24.20.0'

/**
 * The systems of the mobile applications of React Native
 */
export type MobilePlatform = 'android' | 'ios' | 'harmony'

/**
 * The architectures of Android of a libnode built for them (the arch of Node.js names the native tree of the
 * architecture, the target names the compilers of the NDK)
 */
export const ANDROID_ABIS = {
    'arm64-v8a': {arch: 'arm64', target: 'aarch64-linux-android'},
    'armeabi-v7a': {arch: 'arm', target: 'armv7a-linux-androideabi'},
    'x86_64': {arch: 'x64', target: 'x86_64-linux-android'}
} as const

/**
 * An architecture of Android (an ABI): arm64-v8a, armeabi-v7a or x86_64
 */
export type AndroidAbi = keyof typeof ANDROID_ABIS

/**
 * The version of Node.js of a libnode: the one of its headers (include/node/node_version.h)
 * @param directory the export of the libnode
 * @internal
 */
export function mobileNodeVersion(directory: string): string {
    const header: string = readFileSync(path.join(directory, 'include', 'node', 'node_version.h'), 'utf8')
    const part = (name: string): string | undefined => new RegExp(`#define NODE_${name}_VERSION (\\d+)`).exec(header)?.[1]
    const [major, minor, patch] = [part('MAJOR'), part('MINOR'), part('PATCH')]
    if (!major || !minor || !patch) throw new Error(`${directory} holds no version of Node.js (include/node/node_version.h)`)
    return `${major}.${minor}.${patch}`
}

/**
 * The architectures of Android a libnode is built for (libs/<abi>/libnode.so)
 * @param directory the export of the libnode of Android
 * @internal
 */
export function mobileNodeAbis(directory: string): AndroidAbi[] {
    return (Object.keys(ANDROID_ABIS) as AndroidAbi[]).filter((abi: AndroidAbi): boolean => existsSync(path.join(directory, 'libs', abi, 'libnode.so')))
}

/**
 * Check the export of a libnode of a system: its headers, and its libraries (Android: libs/<abi>/libnode.so, HarmonyOS:
 * libs/arm64-v8a/libnode.so) or its framework (iOS: NodeMobile.xcframework)
 * @param platform
 * @param directory
 * @internal
 */
export function checkMobileNode(platform: MobilePlatform, directory: string): void {
    const missing = (what: string): Error => new Error(`${directory} is not the libnode of ${platform} (${what} missing): download it (lakutata mobile node ${platform})`)
    if (!existsSync(path.join(directory, 'include', 'node', 'node_api.h'))) throw missing('include/node/node_api.h')
    if (platform === 'ios' && !existsSync(path.join(directory, 'NodeMobile.xcframework', 'Info.plist'))) throw missing('NodeMobile.xcframework')
    if (platform === 'android' && !mobileNodeAbis(directory).length) throw missing('libs/<abi>/libnode.so')
    if (platform === 'harmony' && !existsSync(path.join(directory, 'libs', 'arm64-v8a', 'libnode.so'))) throw missing('libs/arm64-v8a/libnode.so')
}

/**
 * The release of lakutata/libnode the mobile applications download their libnode from: its tag is v<release> (the
 * version of Node.js, then -<revision> for a release of the same version built again)
 */
export const MOBILE_NODE_RELEASE: string = '24.20.0'

/**
 * The architectures of HarmonyOS the mobile applications ship (the libs/arm64-v8a of their HAP)
 */
const HARMONY_ABIS = {'arm64-v8a': {arch: 'arm64'}} as const

/**
 * The options of {@link downloadMobileNode}
 */
export type MobileNodeDownloadOptions = {
    /**
     * The system downloaded for
     */
    platform: MobilePlatform
    /**
     * The architectures of Android downloaded for, arm64-v8a and x86_64 by default (the devices, the emulators of the
     * computers of Intel)
     */
    abis?: AndroidAbi[]
    /**
     * Called with what is being downloaded
     */
    progress?: (line: string) => void
}

/**
 * Where the releases of lakutata/libnode are downloaded from: LAKUTATA_LIBNODE_MIRROR (a mirror of them, its files laid
 * out as the ones of GitHub: v<release>/<archive>), else the releases of the repository on GitHub
 */
function libnodeMirror(): string {
    return (process.env.LAKUTATA_LIBNODE_MIRROR ?? 'https://github.com/lakutata/libnode/releases/download').replace(/\/+$/, '')
}

/**
 * An archive of the release, downloaded once into the cache (~/.cache/lakutata/mobile/libnode, LAKUTATA_CACHE_DIR),
 * checked with the SHA256SUMS of the release and extracted
 * @param name the archive without its extension: libnode_<platform>_<arch>
 * @param sums the sha256 of the archives of the release, by their names
 * @param progress
 * @returns the directory extracted: lib/libnode.so or NodeMobile.xcframework, include/node, LICENSE, libnode.json
 */
async function libnodeArchive(name: string, sums: () => Promise<Map<string, string>>, progress?: (line: string) => void): Promise<string> {
    const directory: string = path.join(cacheDirectory(), 'mobile', 'libnode', MOBILE_NODE_RELEASE, name)
    if (existsSync(path.join(directory, '.complete'))) return directory
    const archive: string = `${name}.tar.gz`
    const url: string = `${libnodeMirror()}/v${MOBILE_NODE_RELEASE}/${archive}`
    const sum: string | undefined = (await sums()).get(archive)
    if (!sum) throw new Error(`The release ${MOBILE_NODE_RELEASE} of libnode has no ${archive} in its SHA256SUMS`)
    progress?.(`${archive} (libnode ${MOBILE_NODE_RELEASE})`)
    //Extracted aside, then moved into the cache: the builds running together do not see it partly written
    await mkdir(path.dirname(directory), {recursive: true})
    const temporary: string = await mkdtemp(`${directory}.`)
    try {
        const file: string = path.join(temporary, archive)
        const downloaded: string = await downloadFile(url, file).catch((error: Error): never => {
            throw new Error(`${error.message}: a mirror of the releases of lakutata/libnode is given by LAKUTATA_LIBNODE_MIRROR, a libnode of your own by LAKUTATA_MOBILE_NODE_DIR`)
        })
        if (downloaded !== sum) throw new Error(`The ${archive} downloaded is not the one of the release ${MOBILE_NODE_RELEASE} of libnode (sha256 ${downloaded}, ${sum} expected)`)
        const extracted = await runCommand('tar', ['-xf', archive], temporary)
        if (extracted.code !== 0) throw new Error(`${archive} cannot be extracted: ${extracted.output.trim()}`)
        await rm(file)
        const root: string = path.join(temporary, name)
        if (!existsSync(path.join(root, 'include', 'node', 'node_api.h'))) throw new Error(`${archive} has no ${name}/include/node`)
        await writeFile(path.join(root, '.complete'), '')
        await moveIntoCache(root, directory, (): boolean => existsSync(path.join(directory, '.complete')))
    } finally {
        await rm(temporary, {recursive: true, force: true})
    }
    return directory
}

/**
 * Download the libnode of a mobile system from the releases of lakutata/libnode (LAKUTATA_LIBNODE_MIRROR: a mirror of
 * them), once: its archives are checked with the SHA256SUMS of the release and kept in the cache
 * (~/.cache/lakutata/mobile, LAKUTATA_CACHE_DIR). LAKUTATA_MOBILE_NODE_DIR gives exports of a libnode of your own instead
 * (a directory per system: android, ios, harmony; built with the repository of lakutata/libnode)
 * @param options
 * @returns the directory of the export: its headers (include/node) and its libraries (libs/<abi>/libnode.so) or its
 * framework (NodeMobile.xcframework)
 * @example
 * import {downloadMobileNode} from '@lakutata/builder'
 *
 * const directory = await downloadMobileNode({platform: 'android', abis: ['arm64-v8a'], progress: console.log})
 * console.log(directory)
 */
export async function downloadMobileNode(options: MobileNodeDownloadOptions): Promise<string> {
    const given: string | undefined = process.env.LAKUTATA_MOBILE_NODE_DIR
    if (given) {
        const directory: string = path.resolve(given, options.platform)
        checkMobileNode(options.platform, directory)
        return directory
    }
    //The archives by architecture: the ABI of their library in the export
    const archives: [string, string | undefined][] = options.platform === 'ios'
        ? [['libnode_ios_arm64', undefined]]
        : options.platform === 'harmony'
            ? Object.entries(HARMONY_ABIS).map(([abi, {arch}]): [string, string] => [`libnode_harmony_${arch}`, abi])
            : [...new Set(options.abis ?? ['arm64-v8a', 'x86_64'] as AndroidAbi[])].map((abi: AndroidAbi): [string, string] => {
                if (!ANDROID_ABIS[abi]) throw new Error(`${abi} is not an architecture of Android (${Object.keys(ANDROID_ABIS).join(', ')})`)
                return [`libnode_android_${ANDROID_ABIS[abi].arch}`, abi]
            })
    const target: string = path.join(cacheDirectory(), 'mobile', 'node', MOBILE_NODE_RELEASE, [options.platform, ...archives.map(([, abi]): string => abi ?? '')].filter(Boolean).join('-'))
    if (existsSync(path.join(target, '.complete'))) return target
    //The checksums of the release, read once and only when an archive is downloaded
    let sums: Promise<Map<string, string>> | undefined
    const checksums = (): Promise<Map<string, string>> => sums ??= (async (): Promise<Map<string, string>> => {
        const response: Response = await fetch(`${libnodeMirror()}/v${MOBILE_NODE_RELEASE}/SHA256SUMS`).catch((error: Error): never => {
            throw new Error(`The checksums of the release ${MOBILE_NODE_RELEASE} of libnode cannot be downloaded (${error.message}): a mirror of the releases of lakutata/libnode is given by LAKUTATA_LIBNODE_MIRROR`)
        })
        if (!response.ok) throw new Error(`The checksums of the release ${MOBILE_NODE_RELEASE} of libnode cannot be downloaded (${response.url}: ${response.status})`)
        return new Map((await response.text()).split('\n').map((line: string): RegExpExecArray | null => /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim())).filter((match): match is RegExpExecArray => !!match).map((match: RegExpExecArray): [string, string] => [match[2], match[1]]))
    })()
    const extracted: [string, string | undefined][] = []
    for (const [name, abi] of archives) extracted.push([await libnodeArchive(name, checksums, options.progress), abi])
    //The export: the headers and the description of the first archive, the library of each architecture
    await mkdir(path.dirname(target), {recursive: true})
    const temporary: string = await mkdtemp(`${target}.`)
    try {
        const [first] = extracted[0]
        await cp(path.join(first, 'include'), path.join(temporary, 'include'), {recursive: true})
        for (const file of ['LICENSE', 'libnode.json']) if (existsSync(path.join(first, file))) await cp(path.join(first, file), path.join(temporary, file))
        for (const [directory, abi] of extracted) {
            if (abi) {
                await mkdir(path.join(temporary, 'libs', abi), {recursive: true})
                await cp(path.join(directory, 'lib', 'libnode.so'), path.join(temporary, 'libs', abi, 'libnode.so'))
            } else await cp(path.join(directory, 'NodeMobile.xcframework'), path.join(temporary, 'NodeMobile.xcframework'), {recursive: true, verbatimSymlinks: true})
        }
        checkMobileNode(options.platform, temporary)
        await writeFile(path.join(temporary, '.complete'), '')
        await moveIntoCache(temporary, target, (): boolean => existsSync(path.join(target, '.complete')))
    } finally {
        await rm(temporary, {recursive: true, force: true})
    }
    return target
}

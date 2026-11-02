import {createHash, type Hash} from 'node:crypto'
import {existsSync, readFileSync, realpathSync} from 'node:fs'
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {runCommand, spawnCommand} from '../Processes.js'
import {cacheDirectory, moveIntoCache} from '../Tools.js'

/**
 * The version of Node.js of the mobile applications when their libnode does not tell it: the one the Dockerfile of the
 * mobile-react template builds for Android, iOS and HarmonyOS
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
    const missing = (what: string): Error => new Error(`${directory} is not the libnode of ${platform} (${what} missing): build it with the Dockerfile of the project (lakutata mobile node ${platform})`)
    if (!existsSync(path.join(directory, 'include', 'node', 'node_api.h'))) throw missing('include/node/node_api.h')
    if (platform === 'ios' && !existsSync(path.join(directory, 'NodeMobile.xcframework', 'Info.plist'))) throw missing('NodeMobile.xcframework')
    if (platform === 'android' && !mobileNodeAbis(directory).length) throw missing('libs/<abi>/libnode.so')
    if (platform === 'harmony' && !existsSync(path.join(directory, 'libs', 'arm64-v8a', 'libnode.so'))) throw missing('libs/arm64-v8a/libnode.so')
}

/**
 * The options of {@link buildMobileNode}
 */
export type MobileNodeBuildOptions = {
    /**
     * The directory of the Dockerfile building libnode (native/node in the projects of the mobile-react template), its
     * target named after the system: harmony, android or ios
     */
    dockerfile: string
    /**
     * The system built for
     */
    platform: MobilePlatform
    /**
     * The architectures of Android built for (the ABIS argument of the Dockerfile), arm64-v8a and x86_64 by default (the
     * devices, the emulators of the computers of Intel); one takes over an hour
     */
    abis?: AndroidAbi[]
    /**
     * The jobs of make: by default, those the memory of Docker allows (V8 takes about 2 GB per job), at most its
     * processors
     */
    jobs?: number
    /**
     * Called with the lines of the build that tell how far it is
     */
    progress?: (line: string) => void
}

/**
 * The SDKs of iOS of Xcode, which the Dockerfile builds against (given as build contexts: Apple does not allow its SDKs
 * to be redistributed): their directories and their build versions
 * @internal
 */
export async function iosSdks(): Promise<{ iphoneos: string, iphonesimulator: string, versions: string }> {
    if (process.platform !== 'darwin') throw new Error('libnode is built for iOS against the SDKs of Xcode, on macOS')
    const sdk = async (name: string, item: string): Promise<string> => {
        const result = await runCommand('xcrun', ['--sdk', name, item], process.cwd())
        if (result.code !== 0) throw new Error(`Xcode has no SDK ${name} (xcrun --sdk ${name} ${item}): ${result.output.trim()}`)
        return result.output.trim()
    }
    const iphoneos: string = realpathSync(await sdk('iphoneos', '--show-sdk-path'))
    const iphonesimulator: string = realpathSync(await sdk('iphonesimulator', '--show-sdk-path'))
    return {iphoneos: iphoneos, iphonesimulator: iphonesimulator, versions: `${await sdk('iphoneos', '--show-sdk-build-version')} ${await sdk('iphonesimulator', '--show-sdk-build-version')}`}
}

/**
 * The files of the directory of a Dockerfile, its exports (out) and the hidden files left out
 * @param directory
 * @param base
 */
async function dockerFiles(directory: string, base: string = directory): Promise<string[]> {
    const files: string[] = []
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const file: string = path.join(directory, entry.name)
        const relative: string = path.relative(base, file).split(path.sep).join('/')
        if (entry.name.startsWith('.') || relative === 'out') continue
        if (entry.isDirectory()) files.push(...await dockerFiles(file, base))
        else if (entry.isFile()) files.push(relative)
    }
    return files.sort()
}

/**
 * The key of a libnode in the cache: the files of the directory of its Dockerfile, the system, the architectures of
 * Android, and for iOS the versions of the SDKs it is built against (a build input outside of the Dockerfile)
 * @param options
 * @param sdkVersions the build versions of the SDKs of iOS
 * @internal
 */
export async function mobileNodeKey(options: MobileNodeBuildOptions, sdkVersions: string = ''): Promise<string> {
    const hash: Hash = createHash('sha256').update(JSON.stringify({platform: options.platform, abis: options.platform === 'android' ? [...options.abis ?? ['arm64-v8a', 'x86_64']].sort() : [], sdks: options.platform === 'ios' ? sdkVersions : ''}))
    for (const file of await dockerFiles(options.dockerfile)) {
        hash.update(`${file}\0`)
        hash.update(await readFile(path.join(options.dockerfile, ...file.split('/'))))
        hash.update('\0')
    }
    return `${options.platform}-${hash.digest('hex').slice(0, 24)}`
}

/**
 * The arguments of the docker build of a libnode, exported into a directory
 * @param options
 * @param output
 * @param jobs
 * @param sdks the SDKs of iOS
 * @internal
 */
export function mobileNodeBuildArgs(options: MobileNodeBuildOptions, output: string, jobs: number, sdks?: { iphoneos: string, iphonesimulator: string }): string[] {
    const args: string[] = ['build', '--progress=plain', '--target', options.platform, '--build-arg', `JOBS=${jobs}`]
    //The toolchains of Android and HarmonyOS run on Linux x86_64; iOS is built on the architecture of the machine
    if (options.platform !== 'ios') args.push('--platform', 'linux/amd64')
    if (options.platform === 'android') args.push('--build-arg', `ABIS=${(options.abis ?? ['arm64-v8a', 'x86_64']).join(' ')}`)
    if (options.platform === 'ios') args.push('--build-context', `ios-sdk=${sdks!.iphoneos}`, '--build-context', `ios-simulator-sdk=${sdks!.iphonesimulator}`)
    args.push('--output', `type=local,dest=${output}`, options.dockerfile)
    return args
}

/**
 * The jobs of make the memory of Docker allows: about 2 GB per job, at most its processors
 */
async function dockerJobs(): Promise<number> {
    const info = await runCommand('docker', ['info', '--format', '{{.NCPU}} {{.MemTotal}}'], process.cwd())
    if (info.code !== 0) throw new Error(`Docker builds libnode: ${info.output.trim() || 'docker info failed'}`)
    const [processors, memory] = info.output.trim().split(/\s+/).map(Number)
    return Math.max(1, Math.min(processors || 1, Math.floor((memory || 0) / (2 * 1024 ** 3)) || 1))
}

/**
 * Build the libnode of a mobile system with the Dockerfile of the project, once: the export is kept in the cache
 * (~/.cache/lakutata/mobile/node, LAKUTATA_CACHE_DIR) by the key of its inputs, and taken from there afterwards.
 * LAKUTATA_MOBILE_NODE_DIR gives exports made before instead (a directory per system: android, ios, harmony). Android
 * and HarmonyOS are built in containers of Linux x86_64 (emulated on the Macs of Apple silicon), iOS on the
 * architecture of the machine against the SDKs of Xcode; a build takes from one to three hours
 * @param options
 * @returns the directory of the export: its headers (include/node) and its libraries (libs) or its framework
 * (NodeMobile.xcframework)
 * @example
 * import {buildMobileNode} from '@lakutata/builder'
 *
 * const directory = await buildMobileNode({dockerfile: 'native/node', platform: 'android', abis: ['arm64-v8a'], progress: console.log})
 * console.log(directory)
 */
export async function buildMobileNode(options: MobileNodeBuildOptions): Promise<string> {
    const given: string | undefined = process.env.LAKUTATA_MOBILE_NODE_DIR
    if (given) {
        const directory: string = path.resolve(given, options.platform)
        checkMobileNode(options.platform, directory)
        return directory
    }
    const dockerfile: string = path.resolve(options.dockerfile)
    if (!existsSync(path.join(dockerfile, 'Dockerfile'))) throw new Error(`${dockerfile} has no Dockerfile building libnode`)
    const sdks = options.platform === 'ios' ? await iosSdks() : undefined
    const key: string = await mobileNodeKey({...options, dockerfile: dockerfile}, sdks?.versions)
    const target: string = path.join(cacheDirectory(), 'mobile', 'node', key)
    if (existsSync(path.join(target, '.complete'))) return target
    const jobs: number = options.jobs ?? await dockerJobs()
    //Exported aside, then renamed: the builds running together do not see it partly written
    await mkdir(path.dirname(target), {recursive: true})
    const temporary: string = await mkdtemp(`${target}.`)
    try {
        const args: string[] = mobileNodeBuildArgs({...options, dockerfile: dockerfile}, temporary, jobs, sdks)
        await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
            const child = spawnCommand('docker', args, {cwd: dockerfile, env: {...process.env, DOCKER_BUILDKIT: '1'}})
            let pending: string = ''
            const tail: string[] = []
            const read = (chunk: Buffer): void => {
                pending += chunk.toString()
                const lines: string[] = pending.split('\n')
                pending = lines.pop()!
                for (const line of lines) {
                    tail.push(line)
                    if (tail.length > 40) tail.shift()
                    //The steps of the build and the messages of the Dockerfile
                    if (/^#\d+ \[|^#\d+ \d+(\.\d+)? (Building|Built)/.test(line)) options.progress?.(line.replace(/^#\d+ (\d+(\.\d+)? )?/, ''))
                }
            }
            child.stdout!.on('data', read)
            child.stderr!.on('data', read)
            child.once('error', reject)
            child.once('close', (exit: number | null): void => {
                if (exit !== 0) reject(new Error(`libnode cannot be built for ${options.platform} (docker build): ${tail.slice(-20).join('\n')}`))
                else resolve()
            })
        })
        checkMobileNode(options.platform, temporary)
        await writeFile(path.join(temporary, '.complete'), '')
        await moveIntoCache(temporary, target, (): boolean => existsSync(path.join(target, '.complete')))
    } finally {
        await rm(temporary, {recursive: true, force: true})
    }
    return target
}

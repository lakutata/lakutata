import {constants, existsSync, readdirSync, readFileSync} from 'node:fs'
import {cp, mkdir, mkdtemp, readFile, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type {NativeFile} from '../Native.js'
import {runCommand} from '../Processes.js'
import {binaryArchitectures, nodeFiles, nodeGyp, packageOf} from '../nwjs/Addons.js'
import {compareVersions} from '../nwjs/Runtime.js'
import {nodejsMobile} from './Runtime.js'

/**
 * The architectures of Android the native addons are built for, the ones of the libraries of nodejs-mobile: the name
 * of the architecture in Node.js (process.arch, which names the native tree of the architecture) and the target of
 * the compilers of the NDK
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
 * The version of Android the addons are built for: the minSdkVersion of the projects of Capacitor 8
 */
const ANDROID_API: number = 24

/**
 * What was done to the native addons of a mobile application
 */
export type MobileAddons = {
    /**
     * The packages built from their sources, with the target built for: `@lakutata/math (arm64-v8a)`
     */
    built: string[]
    /**
     * The packages whose prebuilt addons of the system were kept (prebuilds/android-<arch>)
     */
    prebuilt: string[]
}

/**
 * The options of the native addons of a mobile application
 */
export type MobileAddonOptions = {
    /**
     * The architectures of Android built for, the ones of nodejs-mobile by default (arm64-v8a, armeabi-v7a, x86_64)
     */
    abis?: AndroidAbi[]
    /**
     * Called with what is done, the builds taking a while
     */
    progress?: (message: string) => void
}

/**
 * A package of the native tree holding addons
 */
type AddonPackage = {
    /**
     * Its name
     */
    name: string
    /**
     * Its directory in the project
     */
    source: string
    /**
     * Its directory in the native tree (empty when its addons are outside of it in the tree)
     */
    target: string
    /**
     * Its addons in the native tree
     */
    files: string[]
}

/**
 * The packages of the addons of the native tree: built again from their sources, a package is the unit
 * @param files the files of the tree
 */
function addonPackages(files: NativeFile[]): AddonPackage[] {
    const packages: Map<string, AddonPackage> = new Map()
    for (const file of files.filter((item: NativeFile): boolean => item.path.endsWith('.node'))) {
        const source: string | undefined = packageOf(file.source)
        if (!source) throw new Error(`${file.path} is in no package: the native addons are built for iOS and Android from the sources of their packages`)
        const relative: string = path.relative(source, file.source).split(path.sep).join('/')
        let item: AddonPackage | undefined = packages.get(source)
        if (!item) {
            const manifest: { name?: string } = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'))
            item = {name: manifest.name ?? path.basename(source), source: source, target: '', files: []}
            packages.set(source, item)
        }
        if (file.path.endsWith(`/${relative}`)) item.target = file.path.slice(0, file.path.length - relative.length - 1)
        item.files.push(file.path)
    }
    return [...packages.values()]
}

/**
 * The NDK of Android: ANDROID_NDK_HOME, ANDROID_NDK_ROOT, else the latest one of the SDK (ANDROID_HOME, ANDROID_SDK_ROOT,
 * else the directory Android Studio installs it into)
 * @returns the directory of its compilers and its revision
 */
function androidNdk(): { bin: string, revision: string } {
    let ndk: string | undefined = [process.env.ANDROID_NDK_HOME, process.env.ANDROID_NDK_ROOT].find((directory: string | undefined): boolean => !!directory && existsSync(path.join(directory, 'source.properties')))
    if (!ndk) {
        const sdk: string = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(os.homedir(), ...process.platform === 'darwin' ? ['Library', 'Android', 'sdk'] : ['Android', 'Sdk'])
        const root: string = path.join(sdk, 'ndk')
        const latest: string | undefined = existsSync(root) ? readdirSync(root).filter((version: string): boolean => existsSync(path.join(root, version, 'source.properties'))).sort(compareVersions).at(-1) : undefined
        if (latest) ndk = path.join(root, latest)
    }
    if (!ndk) throw new Error('The NDK of Android builds the native addons for Android: install it (the SDK Manager of Android Studio, or sdkmanager "ndk;27.0.12077973"), or give its directory (ANDROID_NDK_HOME)')
    const bin: string = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', `${process.platform === 'darwin' ? 'darwin' : 'linux'}-x86_64`, 'bin')
    if (!existsSync(bin)) throw new Error(`The NDK ${ndk} has no compilers for this system (${bin})`)
    const revision: string = /Pkg\.Revision\s*=\s*(\S+)/.exec(readFileSync(path.join(ndk, 'source.properties'), 'utf8'))?.[1] ?? 'unknown'
    return {bin: bin, revision: revision}
}

/**
 * The modules the build of a package loads (node-addon-api), found where the package is
 * @param source
 */
function buildModules(source: string): string {
    return [...createRequire(path.join(source, 'package.json')).resolve.paths('x') ?? [], process.env.NODE_PATH].filter(Boolean).join(path.delimiter)
}

/**
 * Build the addons of a package for an architecture of Android with node-gyp (a copy of the package), cross-compiled
 * by the NDK against the headers and the library of nodejs-mobile
 * @param project
 * @param item
 * @param abi
 * @param runtime the release of nodejs-mobile of Android
 * @param bin the compilers of the NDK
 * @param work a directory of the build
 * @returns the addons built (in build/Release of the copy)
 */
async function buildAndroid(project: string, item: AddonPackage, abi: AndroidAbi, runtime: string, bin: string, work: string): Promise<string[]> {
    const copy: string = path.join(work, path.basename(item.source))
    await cp(item.source, copy, {recursive: true, filter: (file: string): boolean => path.relative(item.source, file) !== 'build'})
    const compiler: string = path.join(bin, `${ANDROID_ABIS[abi].target}${ANDROID_API}-clang`)
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_PATH: buildModules(item.source),
        GYP_CROSSCOMPILE: '1',
        CC: compiler,
        CXX: `${compiler}++`,
        LINK: `${compiler}++`,
        AR: path.join(bin, 'llvm-ar'),
        CC_target: compiler,
        CXX_target: `${compiler}++`,
        LINK_target: `${compiler}++`,
        AR_target: path.join(bin, 'llvm-ar'),
        CC_host: process.env.CC_host ?? 'cc',
        CXX_host: process.env.CXX_host ?? 'c++',
        LINK_host: process.env.LINK_host ?? 'c++',
        AR_host: process.env.AR_host ?? 'ar',
        //The addons load the Node.js of the application (libnode.so); the pages of 16 KB of Android 15
        LDFLAGS: `-L${path.join(runtime, 'bin', abi)} -lnode -Wl,-z,max-page-size=16384`
    }
    const args: string[] = [nodeGyp(project), 'rebuild', `--arch=${ANDROID_ABIS[abi].arch}`, `--nodedir=${runtime}`, '--jobs=max', '--', '-f', 'make-android', '-DOS=android']
    const built = await runCommand(process.execPath, args, copy, env)
    if (built.code !== 0) throw new Error(`The addons of ${item.name} cannot be built for Android (${abi}): ${built.output.trim().split('\n').slice(-8).join('\n')}`)
    const addons: string[] = await nodeFiles(path.join(copy, 'build', 'Release'))
    if (!addons.length) throw new Error(`The build of ${item.name} for Android (${abi}) made no addon (build/Release)`)
    for (const addon of addons) {
        if (!binaryArchitectures(await readFile(addon)).includes(ANDROID_ABIS[abi].arch)) throw new Error(`${path.basename(addon)} of ${item.name} is not built for ${abi}`)
    }
    return addons
}

/**
 * Give an addon package of a native tree the addons of an architecture: each addon of the package takes the one built of
 * its name (in build/Release, or where node-pre-gyp puts it), the others (the addons of other systems) are removed
 * @param tree
 * @param item
 * @param built
 * @param kept the addons of the tree kept as they are (the prebuilt ones of the architecture)
 */
async function giveAddons(tree: string, item: AddonPackage, built: string[], kept: (file: string) => boolean): Promise<void> {
    const names: Map<string, string> = new Map(built.map((file: string): [string, string] => [path.basename(file), file]))
    for (const file of item.files) {
        if (kept(file)) continue
        const target: string = path.join(tree, ...file.split('/'))
        const addon: string | undefined = names.get(path.basename(file))
        if (addon) await cp(addon, target)
        else await rm(target, {force: true})
    }
    //The ones of build/Release, which the loaders look for first
    if (item.target) {
        for (const [name, addon] of names) {
            const target: string = path.join(tree, ...item.target.split('/'), 'build', 'Release', name)
            await mkdir(path.dirname(target), {recursive: true})
            await cp(addon, target)
        }
    }
}

/**
 * Build the native addons of a mobile application of Android: a native tree per architecture (<directory>-<arch>, the
 * one of process.arch loaded by the bundle), each package of addons built for it from its sources (node-gyp, the NDK,
 * the headers and the library of nodejs-mobile), or keeping its prebuilt addons of the architecture
 * (prebuilds/android-<arch>, node-gyp-build). The tree of the build is removed once they are made
 * @param project
 * @param directory the native tree
 * @param files the files of the tree
 * @param options
 * @internal
 */
export async function prepareAndroidAddons(project: string, directory: string, files: NativeFile[], options: MobileAddonOptions = {}): Promise<MobileAddons> {
    if (process.platform === 'win32') throw new Error('The native addons are built for Android on macOS and on Linux (node-gyp, make and the NDK)')
    const abis: AndroidAbi[] = options.abis ?? Object.keys(ANDROID_ABIS) as AndroidAbi[]
    const packages: AddonPackage[] = addonPackages(files)
    const result: MobileAddons = {built: [], prebuilt: []}
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-mobile-addons-'))
    const trees: string[] = []
    try {
        //The release of nodejs-mobile and the NDK, once a package is built
        let toolchain: { runtime: string, bin: string, revision: string } | undefined
        for (const abi of abis) {
            const arch: string = ANDROID_ABIS[abi].arch
            const tree: string = `${directory}-${arch}`
            await rm(tree, {recursive: true, force: true})
            await cp(directory, tree, {recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE})
            trees.push(tree)
            for (const item of packages) {
                //The prebuilt addons of the architecture (node-gyp-build loads them), when the package keeps its addons in its tree
                const prebuilds: string = `${item.target}/prebuilds/android-${arch}/`
                if (item.target && existsSync(path.join(item.source, 'prebuilds', `android-${arch}`))) {
                    await giveAddons(tree, {...item, target: ''}, [], (file: string): boolean => file.startsWith(prebuilds))
                    result.prebuilt.push(`${item.name} (${abi})`)
                    continue
                }
                if (!existsSync(path.join(item.source, 'binding.gyp'))) throw new Error(`${item.name} has no sources to build its addons for Android (binding.gyp), and no prebuilt addons of Android (prebuilds/android-${arch})`)
                options.progress?.(`The addons of ${item.name} built for Android (${abi})`)
                toolchain ??= {...androidNdk(), runtime: await nodejsMobile('android')}
                const build: string = path.join(work, `${result.built.length}`)
                await mkdir(build, {recursive: true})
                await giveAddons(tree, item, await buildAndroid(project, item, abi, toolchain.runtime, toolchain.bin, build), (): boolean => false)
                result.built.push(`${item.name} (${abi})`)
            }
        }
        await rm(directory, {recursive: true, force: true})
    } catch (error) {
        //Nothing half made
        for (const tree of trees) await rm(tree, {recursive: true, force: true})
        throw error
    } finally {
        await rm(work, {recursive: true, force: true})
    }
    return result
}

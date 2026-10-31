import {existsSync} from 'node:fs'
import {cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type {NativeFile} from '../Native.js'
import {runCommand} from '../Processes.js'
import {cacheDirectory} from '../Tools.js'
import {compareVersions, type NwjsRelease} from './Runtime.js'

/**
 * The name of the Node.js the addons of Windows import their functions from, as node-gyp links them (node.lib), and
 * the library NW.js holds them in
 */
const HOST: string = 'node.exe'
const NWJS_NODE: string = 'node.dll'

/**
 * A section of a portable executable: where its data is in memory (relative to the image) and in the file
 */
type Section = {
    address: number
    size: number
    offset: number
}

/**
 * The offset in the file of an address relative to the image, undefined outside the sections
 * @param sections
 * @param address
 */
function offsetOf(sections: Section[], address: number): number | undefined {
    const section: Section | undefined = sections.find((item: Section): boolean => address >= item.address && address < item.address + item.size)
    return section && address - section.address + section.offset
}

/**
 * The string ending with a zero at an offset of a file
 * @param file
 * @param offset
 */
function stringAt(file: Buffer, offset: number): string {
    const end: number = file.indexOf(0, offset)
    return file.toString('latin1', offset, end < 0 ? file.length : end)
}

/**
 * Make an addon of Windows load in NW.js: the libraries it imports (imported or delay-loaded) named node.exe are named
 * node.dll, the library of NW.js holding the functions of Node.js (Node-API). The delay-load hook of node-gyp gives an
 * addon the executable when it loads node.exe, which in NW.js does not export them: the addon fails to load ("A dynamic
 * link library (DLL) initialization routine failed"), or blocks NW.js. Named node.dll, the library is the one NW.js
 * loaded. The addon is changed in place (its other bytes are kept); it then loads in NW.js only, not in Node.js.
 * @param file the content of the addon (a .node file of Windows)
 * @returns the names changed: 0 when it imports no node.exe (an addon built for NW.js, or loading Node.js otherwise)
 * @internal
 */
export function nameNwjsNode(file: Buffer): number {
    if (file.length < 64 || file.readUInt16LE(0) !== 0x5a4d) throw new Error('Not a portable executable (no MZ header)')
    const header: number = file.readUInt32LE(0x3c)
    if (file.readUInt32LE(header) !== 0x4550) throw new Error('Not a portable executable (no PE signature)')
    const coff: number = header + 4
    const sectionCount: number = file.readUInt16LE(coff + 2)
    const optionalSize: number = file.readUInt16LE(coff + 16)
    const optional: number = coff + 20
    const magic: number = file.readUInt16LE(optional)
    if (magic !== 0x10b && magic !== 0x20b) throw new Error(`Not a portable executable (optional header ${magic.toString(16)})`)
    //The data directories: after 96 bytes (PE32), 112 bytes (PE32+); the image base, for the old delay-load tables (addresses)
    const directories: number = optional + (magic === 0x10b ? 96 : 112)
    const imageBase: number = magic === 0x10b ? file.readUInt32LE(optional + 28) : Number(file.readBigUInt64LE(optional + 24))
    const sections: Section[] = []
    for (let index: number = 0, table: number = optional + optionalSize; index < sectionCount; index++, table += 40) {
        sections.push({address: file.readUInt32LE(table + 12), size: Math.max(file.readUInt32LE(table + 8), file.readUInt32LE(table + 16)), offset: file.readUInt32LE(table + 20)})
    }
    let changed: number = 0
    const rename = (address: number): void => {
        const offset: number | undefined = offsetOf(sections, address)
        if (offset === undefined || stringAt(file, offset).toLowerCase() !== HOST) return
        file.write(NWJS_NODE, offset, 'latin1')
        changed++
    }
    //The imports (directory 1): descriptors of 20 bytes, the name at 12, ending with an empty one
    const imports: number | undefined = offsetOf(sections, file.readUInt32LE(directories + 8))
    if (imports !== undefined && file.readUInt32LE(directories + 12)) {
        for (let descriptor: number = imports; descriptor + 20 <= file.length && file.readUInt32LE(descriptor + 12); descriptor += 20) rename(file.readUInt32LE(descriptor + 12))
    }
    //The delay-loaded imports (directory 13): descriptors of 32 bytes, the name at 4 (an address before the RVA attribute)
    const delayed: number | undefined = offsetOf(sections, file.readUInt32LE(directories + 13 * 8))
    if (delayed !== undefined && file.readUInt32LE(directories + 13 * 8 + 4)) {
        for (let descriptor: number = delayed; descriptor + 32 <= file.length && file.readUInt32LE(descriptor + 4); descriptor += 32) {
            const name: number = file.readUInt32LE(descriptor + 4)
            rename(file.readUInt32LE(descriptor) & 1 ? name : name - imageBase)
        }
    }
    return changed
}

/**
 * The architectures of a native binary (Mach-O, possibly universal; ELF; PE) as node names them: x64, ia32, arm64, arm
 * @param file
 * @internal
 */
export function binaryArchitectures(file: Buffer): string[] {
    const names: Record<number, string> = {0x01000007: 'x64', 0x0100000c: 'arm64', 7: 'ia32', 12: 'arm'}
    if (file.length >= 8 && file.readUInt32BE(0) === 0xcafebabe) {
        const count: number = file.readUInt32BE(4)
        return Array.from({length: count}, (_: unknown, index: number): string => names[file.readUInt32BE(8 + index * 20)] ?? 'unknown')
    }
    if (file.length >= 8 && (file.readUInt32LE(0) === 0xfeedfacf || file.readUInt32LE(0) === 0xfeedface)) return [names[file.readUInt32LE(4)] ?? 'unknown']
    if (file.length >= 20 && file.readUInt32BE(0) === 0x7f454c46) return [({62: 'x64', 183: 'arm64', 3: 'ia32', 40: 'arm'} as Record<number, string>)[file.readUInt16LE(18)] ?? 'unknown']
    if (file.length >= 64 && file.readUInt16LE(0) === 0x5a4d) {
        const machine: number = file.readUInt16LE(file.readUInt32LE(0x3c) + 4)
        return [({0x8664: 'x64', 0x14c: 'ia32', 0xaa64: 'arm64'} as Record<number, string>)[machine] ?? 'unknown']
    }
    return ['unknown']
}

/**
 * Whether an addon uses the C++ API of V8 (NAN, v8.h) rather than Node-API: the names of the functions of V8 it imports
 * (mangled by the Itanium ABI or by MSVC). Built for the V8 of Node.js, it does not run in the one of NW.js (Chromium)
 * @param file
 * @internal
 */
export function usesV8Api(file: Buffer): boolean {
    return file.includes('_ZN2v8') || file.includes('@v8@@')
}

/**
 * The first release of NW.js whose headers node-gyp builds the addons with (--target, --dist-url)
 */
const NODE_GYP_HEADERS: string = '0.111.3'

/**
 * What {@link prepareNwjsAddons} did to the addons of the native tree
 */
export type NwjsAddons = {
    /**
     * The addons whose node.exe was named node.dll (Windows)
     */
    renamed: string[]
    /**
     * The packages built again from their sources: for the architecture of the runtime, or with the headers of NW.js
     */
    rebuilt: string[]
}

/**
 * node-gyp: the one of the project, of the builder, else the one of npm
 * @param project
 */
function nodeGyp(project: string): string {
    for (const base of [path.join(project, 'package.json'), import.meta.url]) {
        try {
            return createRequire(base).resolve('node-gyp/bin/node-gyp.js')
        } catch {
            //Not installed there
        }
    }
    //The node-gyp of npm, next to the node running the build
    const prefix: string = process.platform === 'win32' ? path.dirname(process.execPath) : path.join(path.dirname(process.execPath), '..', 'lib')
    const bundled: string = path.join(prefix, 'node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
    if (existsSync(bundled)) return bundled
    throw new Error('node-gyp builds the addons for NW.js: install it in the project (npm install --save-dev node-gyp)')
}

/**
 * The headers of a release of NW.js for node-gyp, in a directory of their own (--devdir) of the cache: downloaded once,
 * their common.gypi without the linker of Chromium (lld, which the compilers of macOS and of the Linux systems do not
 * have: the linker of the system links the addons as well)
 * @param project
 * @param release
 * @returns the directory given to node-gyp (--devdir)
 */
async function nwjsHeaders(project: string, release: NwjsRelease): Promise<string> {
    const devdir: string = path.join(cacheDirectory(), 'nwjs', 'node-gyp')
    const common: string = path.join(devdir, release.version, 'common.gypi')
    if (!existsSync(common)) {
        const installed = await runCommand(process.execPath, [nodeGyp(project), 'install', `--target=${release.version}`, `--dist-url=${mirror()}`, `--devdir=${devdir}`], project)
        if (installed.code !== 0 || !existsSync(common)) throw new Error(`The headers of NW.js ${release.version} cannot be downloaded: ${installed.output.trim().split('\n').slice(-3).join(' ')}`)
    }
    const content: string = await readFile(common, 'utf8')
    const linked: string = content.replace(/,\s*'-fuse-ld=lld'/g, '').replace(/-fuse-ld=lld\s*/g, '')
    if (linked !== content) await writeFile(common, linked)
    return devdir
}

/**
 * Where the releases of NW.js are downloaded from (LAKUTATA_NWJS_MIRROR, else dl.nwjs.io)
 */
function mirror(): string {
    return (process.env.LAKUTATA_NWJS_MIRROR ?? 'https://dl.nwjs.io').replace(/\/+$/, '')
}

/**
 * The directory of the package of a file (the one holding its package.json)
 * @param file
 */
function packageOf(file: string): string | undefined {
    for (let directory: string = path.dirname(file); directory !== path.dirname(directory); directory = path.dirname(directory)) {
        if (existsSync(path.join(directory, 'package.json'))) return directory
    }
    return undefined
}

/**
 * The .node files under a directory
 * @param directory
 */
async function nodeFiles(directory: string): Promise<string[]> {
    if (!existsSync(directory)) return []
    const found: string[] = []
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const file: string = path.join(directory, entry.name)
        if (entry.isDirectory()) found.push(...await nodeFiles(file))
        else if (entry.isFile() && entry.name.endsWith('.node')) found.push(file)
    }
    return found
}

/**
 * Build a package of addons again from its sources (a copy of it), its addons written into build/Release of its copy
 * in the native tree
 * @param project
 * @param source the directory of the package, in the node_modules of the project
 * @param target the directory of the package in the native tree
 * @param arch
 * @param headers the release of NW.js whose headers the addons are built with (the ones using V8)
 */
async function rebuild(project: string, source: string, target: string, arch: string, headers?: NwjsRelease): Promise<void> {
    if (!existsSync(path.join(source, 'binding.gyp'))) throw new Error(`${path.basename(source)} has no sources to build its addons for NW.js (binding.gyp): its addons are not for ${arch}${headers ? ` or use V8` : ''}`)
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-nwjs-addon-'))
    try {
        const copy: string = path.join(work, path.basename(source))
        await cp(source, copy, {recursive: true, filter: (file: string): boolean => path.relative(source, file) !== 'build'})
        //The modules of its build (node-addon-api) found where the package is
        const modules: string[] = (createRequire(path.join(source, 'package.json')).resolve.paths('x') ?? [])
        const args: string[] = [nodeGyp(project), 'rebuild', `--arch=${arch}`, ...headers ? [`--target=${headers.version}`, `--dist-url=${mirror()}`, `--devdir=${await nwjsHeaders(project, headers)}`] : []]
        const previous: string | undefined = process.env.NODE_PATH
        process.env.NODE_PATH = [...modules, previous].filter(Boolean).join(path.delimiter)
        try {
            const built = await runCommand(process.execPath, args, copy)
            if (built.code !== 0) throw new Error(`The addons of ${path.basename(source)} cannot be built for NW.js (node-gyp ${args.slice(1).join(' ')}): ${built.output.trim().split('\n').slice(-5).join(' ')}`)
        } finally {
            if (previous === undefined) delete process.env.NODE_PATH
            else process.env.NODE_PATH = previous
        }
        await mkdir(path.join(target, 'build', 'Release'), {recursive: true})
        for (const file of await nodeFiles(path.join(copy, 'build', 'Release'))) await cp(file, path.join(target, 'build', 'Release', path.basename(file)))
    } finally {
        await rm(work, {recursive: true, force: true})
    }
}

/**
 * Make the addons of the native tree of an application of NW.js load in its runtime: the packages whose addons are not
 * for the architecture of the runtime, or use V8 (NW.js 0.111.3 and later: the headers of NW.js), built again from their
 * sources; on Windows, the node.exe they import named node.dll
 * @param project
 * @param directory the native tree
 * @param files the files of the tree (their sources)
 * @param release
 * @param platform the build of NW.js (win-x64, osx-arm64…)
 * @internal
 */
export async function prepareNwjsAddons(project: string, directory: string, files: NativeFile[], release: NwjsRelease, platform: string): Promise<NwjsAddons> {
    const arch: string = platform.slice(platform.indexOf('-') + 1)
    const result: NwjsAddons = {renamed: [], rebuilt: []}
    const done: Set<string> = new Set()
    for (const file of files.filter((item: NativeFile): boolean => item.path.endsWith('.node'))) {
        const target: string = path.join(directory, ...file.path.split('/'))
        const content: Buffer = await readFile(target)
        const v8: boolean = usesV8Api(content)
        if (v8 && compareVersions(release.version, NODE_GYP_HEADERS) < 0) throw new Error(`${file.path} uses the API of V8 (not Node-API): it runs in NW.js ${NODE_GYP_HEADERS} or later, built with its headers; NW.js ${release.version} needs a package of Node-API instead`)
        if (!v8 && binaryArchitectures(content).includes(arch)) continue
        const source: string | undefined = packageOf(file.source)
        if (!source) throw new Error(`${file.path} is not for ${arch} and is not in a package: build it for NW.js ${release.version} (${platform})`)
        const relative: string = path.relative(source, file.source).split(path.sep).join('/')
        const packageTarget: string = path.join(directory, ...file.path.slice(0, file.path.length - relative.length).split('/'))
        if (done.has(packageTarget)) continue
        done.add(packageTarget)
        await rebuild(project, source, packageTarget, arch, v8 ? release : undefined)
        result.rebuilt.push(path.basename(source))
    }
    if (platform.startsWith('win-')) {
        for (const file of await nodeFiles(directory)) {
            const content: Buffer = await readFile(file)
            //The addons of Windows only (portable executables)
            if (content.length > 64 && content.readUInt16LE(0) === 0x5a4d && nameNwjsNode(content)) {
                await writeFile(file, content)
                result.renamed.push(path.relative(directory, file).split(path.sep).join('/'))
            }
        }
    }
    return result
}

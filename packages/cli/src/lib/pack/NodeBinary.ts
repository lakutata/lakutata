import {createHash} from 'node:crypto'
import {existsSync} from 'node:fs'
import {chmod, mkdir, rename, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'
import {Settings} from '../Settings.js'
import {ReadTar, type TarEntry} from '../Tar.js'

/**
 * A platform of the executables: "<platform>-<arch>" as the Node.js distributions name them (linux-x64, linux-arm64,
 * darwin-arm64, win-x64…)
 */
export type Target = {
    name: string
    platform: 'linux' | 'darwin' | 'win'
    arch: string
}

/**
 * The target of the running Node.js
 */
export function HostTarget(): Target {
    const platform: string = process.platform === 'win32' ? 'win' : process.platform
    //The 32-bit ARM builds are armv7l
    const arch: string = process.arch === 'arm' ? 'armv7l' : process.arch
    return ParseTarget(`${platform}-${arch}`)
}

/**
 * A target from its name
 * @param name "linux-x64", "darwin-arm64", "win-x64"…
 */
export function ParseTarget(name: string): Target {
    const matched: RegExpExecArray | null = /^(linux|darwin|win)-([a-z0-9]+)$/.exec(name)
    if (!matched) throw new Error(`Invalid target "${name}": <platform>-<arch>, the platform linux, darwin or win (linux-x64, linux-arm64, darwin-arm64, win-x64…)`)
    return {name: name, platform: matched[1] as Target['platform'], arch: matched[2]}
}

/**
 * The file of the executable of a target
 * @param target
 * @param name the name of the program
 */
export function ExecutableName(target: Target, name: string): string {
    return target.platform === 'win' ? `${name}.exe` : name
}

/**
 * Fetch a file of the distributions of Node.js
 * @param url
 */
async function Download(url: string): Promise<Buffer> {
    const response: Response = await fetch(url, {signal: AbortSignal.timeout(10 * 60 * 1000)})
    if (!response.ok) throw new Error(`${url} cannot be downloaded: ${response.status} ${response.statusText}`)
    return Buffer.from(await response.arrayBuffer())
}

/**
 * The Node.js binary of a target, of the version of the running Node.js (the one which prepares the executables):
 * downloaded from the mirror of the Node.js distributions (LAKUTATA_NODE_MIRROR) and checked, then cached
 * @param target
 * @return the path of the binary
 */
export async function NodeBinary(target: Target): Promise<string> {
    const version: string = process.version
    if (target.name === HostTarget().name) return process.execPath
    const binaryName: string = target.platform === 'win' ? 'node.exe' : 'node'
    const cached: string = path.join(Settings.cacheDirectory, 'node', version, target.name, binaryName)
    if (existsSync(cached)) return cached
    const base: string = `${Settings.nodeMirror}/${version}`
    //Windows has its node.exe, the other platforms their archives
    const file: string = target.platform === 'win' ? `${target.name}/node.exe` : `node-${version}-${target.name}.tar.gz`
    const sums: string = (await Download(`${base}/SHASUMS256.txt`)).toString()
    const expected: string | undefined = sums.split('\n').map((line: string): string[] => line.trim().split(/\s+/)).find(([, name]): boolean => name === file)?.[0]
    if (!expected) throw new Error(`Node.js ${version} has no build for ${target.name} on ${Settings.nodeMirror} (${file} is not in its SHASUMS256.txt)`)
    const downloaded: Buffer = await Download(`${base}/${file}`)
    const actual: string = createHash('sha256').update(downloaded).digest('hex')
    if (actual !== expected) throw new Error(`${base}/${file} is corrupted: its SHA-256 is ${actual}, ${expected} expected`)
    let binary: Buffer = downloaded
    if (target.platform !== 'win') {
        const entry: TarEntry | undefined = ReadTar(gunzipSync(downloaded)).find((candidate: TarEntry): boolean => candidate.name === `node-${version}-${target.name}/bin/node`)
        if (!entry) throw new Error(`${base}/${file} has no bin/node`)
        binary = entry.data
    }
    await mkdir(path.dirname(cached), {recursive: true})
    //Written then renamed: an interrupted download leaves no binary
    await writeFile(`${cached}.part`, binary)
    await chmod(`${cached}.part`, 0o755)
    await rename(`${cached}.part`, cached)
    return cached
}

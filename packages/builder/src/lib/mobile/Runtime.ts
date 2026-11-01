import {createHash, type Hash} from 'node:crypto'
import {createReadStream, existsSync} from 'node:fs'
import {mkdir, mkdtemp, open, rename, rm, type FileHandle} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {runCommand} from '../Processes.js'
import {cacheDirectory} from '../Tools.js'
import type {MobilePlatform} from './Stage.js'

/**
 * The release of nodejs-mobile that @capawesome/capacitor-nodejs embeds in the mobile applications (the fork of
 * capawesome: Node.js 18.20.4), whose headers and libraries build the native addons for them
 */
export const NODEJS_MOBILE_RELEASE: string = '18.20.4-capawesome.3'

/**
 * The sha256 of the archives of the release, the ones the plugin checks
 */
const ARCHIVES: Record<MobilePlatform, string> = {
    android: '0a8d094d3f60bcd3b8ff0ad98e4aafeeb59c933fbf53af82eb7cdeab015c503f',
    ios: 'da54bb43c2257aadccfd88798452c2f6a838fbefba8de44917764cefa6365484'
}

/**
 * Where the releases are downloaded from (LAKUTATA_NODEJS_MOBILE_MIRROR, else the releases of the fork)
 */
function mirror(): string {
    return (process.env.LAKUTATA_NODEJS_MOBILE_MIRROR ?? 'https://github.com/capawesome-team/nodejs-mobile/releases/download').replace(/\/+$/, '')
}

/**
 * The sha256 of a file
 * @param file
 */
function sha256Of(file: string): Promise<string> {
    return new Promise((resolve: (sum: string) => void, reject: (error: Error) => void): void => {
        const hash: Hash = createHash('sha256')
        createReadStream(file).on('data', (chunk: Buffer | string): unknown => hash.update(chunk)).once('error', reject).once('end', (): void => resolve(hash.digest('hex')))
    })
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
 * The archive of the release the plugin downloaded already, when it is the one of the release: Gradle keeps the one of
 * Android in its caches, the installation of the plugin the one of iOS in ~/.cache
 * @param archive
 * @param sum
 */
async function downloadedArchive(archive: string, sum: string): Promise<string | undefined> {
    const gradle: string = process.env.GRADLE_USER_HOME ?? path.join(os.homedir(), '.gradle')
    for (const file of [path.join(gradle, 'caches', 'capawesome-capacitor-nodejs', archive), path.join(os.homedir(), '.cache', 'capawesome-capacitor-nodejs', archive)]) {
        if (existsSync(file) && await sha256Of(file) === sum) return file
    }
    return undefined
}

/**
 * The release of nodejs-mobile of a mobile system, extracted once into the cache (~/.cache/lakutata/mobile,
 * LAKUTATA_CACHE_DIR): the archive the plugin downloaded already, else downloaded and checked with its sha256. Its
 * directory holds the headers of its Node.js (include/node) and, for Android, its libraries (bin/<abi>/libnode.so), for
 * iOS, its framework (NodeMobile.xcframework)
 * @param platform
 * @returns its directory
 * @internal
 */
export async function nodejsMobile(platform: MobilePlatform): Promise<string> {
    const name: string = `nodejs-mobile-v${NODEJS_MOBILE_RELEASE}-${platform}`
    const target: string = path.join(cacheDirectory(), 'mobile', name)
    if (existsSync(path.join(target, 'include', 'node', 'node_api.h'))) return target
    //Extracted aside, then renamed: the builds running together do not see it partly written
    await mkdir(path.dirname(target), {recursive: true})
    const temporary: string = await mkdtemp(`${target}.`)
    try {
        const archive: string = `${name}.zip`
        let file: string | undefined = await downloadedArchive(archive, ARCHIVES[platform])
        if (!file) {
            file = path.join(temporary, archive)
            const url: string = `${mirror()}/v${NODEJS_MOBILE_RELEASE}/${archive}`
            const sum: string = await download(url, file)
            if (sum !== ARCHIVES[platform]) throw new Error(`The ${archive} downloaded from ${url} is not the one of nodejs-mobile ${NODEJS_MOBILE_RELEASE} (sha256 ${sum}, ${ARCHIVES[platform]} expected)`)
        }
        //ditto keeps the links of the frameworks of macOS
        const extracted: string = path.join(temporary, name)
        await mkdir(extracted)
        const result = process.platform === 'darwin'
            ? await runCommand('ditto', ['-x', '-k', file, extracted], temporary)
            : await runCommand('tar', ['-xf', file, '-C', extracted], temporary)
        if (result.code !== 0) throw new Error(`${archive} cannot be extracted: ${result.output.trim()}`)
        if (!existsSync(path.join(extracted, 'include', 'node', 'node_api.h'))) throw new Error(`${archive} has no headers of Node.js (include/node)`)
        await rename(extracted, target).catch((error: Error): void => {
            //Extracted by another build
            if (!existsSync(path.join(target, 'include', 'node', 'node_api.h'))) throw error
        })
    } finally {
        await rm(temporary, {recursive: true, force: true})
    }
    return target
}

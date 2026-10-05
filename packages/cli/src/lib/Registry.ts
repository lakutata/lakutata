import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {Settings} from './Settings.js'

/**
 * A version of a package on the registry
 */
export type PackageVersion = {
    name: string
    version: string
    tarball: string
}

/**
 * The URL of a package on the registry (the scope separator is encoded)
 * @param name
 */
function packageURL(name: string): string {
    return `${Settings.registry}/${name.replace('/', '%2f')}`
}

/**
 * The parts of a version
 * @param version
 */
function versionParts(version: string): { numbers: number[], prerelease: string[] } | undefined {
    const matched: RegExpExecArray | null = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version)
    return matched ? {numbers: [Number(matched[1]), Number(matched[2]), Number(matched[3])], prerelease: matched[4] ? matched[4].split('.') : []} : undefined
}

/**
 * Compare two versions as semver does: a prerelease is before its release, its identifiers are compared one by one
 * (the numbers as numbers, before the words)
 * @param a
 * @param b
 */
export function compareVersions(a: string, b: string): number {
    const [x, y] = [versionParts(a)!, versionParts(b)!]
    const numbers: number = x.numbers[0] - y.numbers[0] || x.numbers[1] - y.numbers[1] || x.numbers[2] - y.numbers[2]
    if (numbers) return numbers
    if (!x.prerelease.length || !y.prerelease.length) return y.prerelease.length - x.prerelease.length
    for (let index: number = 0; index < Math.max(x.prerelease.length, y.prerelease.length); index++) {
        const [left, right] = [x.prerelease[index], y.prerelease[index]]
        if (left === undefined || right === undefined) return left === undefined ? -1 : 1
        if (left === right) continue
        const [leftNumber, rightNumber] = [/^\d+$/.test(left), /^\d+$/.test(right)]
        if (leftNumber && rightNumber) return Number(left) - Number(right)
        if (leftNumber !== rightNumber) return leftNumber ? -1 : 1
        return left < right ? -1 : 1
    }
    return 0
}

/**
 * The newest version of a major version (the prereleases only when the major version has no release)
 * @param versions
 * @param major any major version when undefined
 */
export function newestVersion(versions: string[], major?: number): string | undefined {
    const candidates: string[] = versions.filter((version: string): boolean => {
        const parts = versionParts(version)
        return !!parts && (major === undefined || parts.numbers[0] === major)
    })
    const releases: string[] = candidates.filter((version: string): boolean => !versionParts(version)!.prerelease.length)
    return (releases.length ? releases : candidates).sort(compareVersions).at(-1)
}

/**
 * The manifest of the newest version of a major version of a package (the prereleases when the major version has no
 * release: the tags do not tell the major versions), undefined when it cannot be fetched
 * @param name
 * @param major
 */
export async function majorManifest(name: string, major: number): Promise<Record<string, any> | undefined> {
    try {
        const pkg: PackageVersion | undefined = await resolvePackage(name, major)
        if (!pkg) return undefined
        const response: Response = await fetch(`${packageURL(name)}/${encodeURIComponent(pkg.version)}`, {signal: AbortSignal.timeout(15000)})
        return response.ok ? await response.json() as Record<string, any> : undefined
    } catch {
        return undefined
    }
}

/**
 * The directory of the cached archives of a package
 * @param name
 */
function cacheDirectory(name: string): string {
    return path.join(Settings.cacheDirectory, 'packages', name)
}

/**
 * The version of a package to download: the newest of the major version, or the given version
 * @param name
 * @param wanted a version ("1.2.3"), a major version (3) or the newest version (undefined)
 * @return undefined when the package does not exist
 */
export async function resolvePackage(name: string, wanted?: string | number): Promise<PackageVersion | undefined> {
    const response: Response = await fetch(packageURL(name), {headers: {Accept: 'application/vnd.npm.install-v1+json'}, signal: AbortSignal.timeout(15000)})
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`The package ${name} cannot be fetched from ${Settings.registry}: ${response.status} ${response.statusText}`)
    const metadata: { versions: Record<string, { dist: { tarball: string } }> } = await response.json() as any
    const versions: string[] = Object.keys(metadata.versions ?? {})
    const version: string | undefined = typeof wanted === 'string' ? (versions.includes(wanted) ? wanted : undefined) : newestVersion(versions, wanted)
    if (!version) throw new Error(`The package ${name} has no version ${typeof wanted === 'number' ? `${wanted}.x` : wanted} (${versions.join(', ') || 'no version'})`)
    return {name: name, version: version, tarball: metadata.versions[version].dist.tarball}
}

/**
 * The archive of a version of a package, downloaded once and cached
 * @param pkg
 */
export async function downloadPackage(pkg: PackageVersion): Promise<Buffer> {
    const file: string = path.join(cacheDirectory(pkg.name), `${pkg.version}.tgz`)
    try {
        return await readFile(file)
    } catch {
        //Not cached
    }
    const response: Response = await fetch(pkg.tarball, {signal: AbortSignal.timeout(60000)})
    if (!response.ok) throw new Error(`The package ${pkg.name}@${pkg.version} cannot be downloaded: ${response.status} ${response.statusText}`)
    const archive: Buffer = Buffer.from(await response.arrayBuffer())
    await mkdir(path.dirname(file), {recursive: true})
    await writeFile(file, archive)
    return archive
}

/**
 * The newest cached archive of a package, when the registry cannot be reached
 * @param name
 * @param major
 */
export async function cachedPackage(name: string, major?: number): Promise<{ version: string, archive: Buffer } | undefined> {
    let files: string[]
    try {
        files = await readdir(cacheDirectory(name))
    } catch {
        return undefined
    }
    const version: string | undefined = newestVersion(files.filter((file: string): boolean => file.endsWith('.tgz')).map((file: string): string => file.slice(0, -4)), major)
    return version ? {version: version, archive: await readFile(path.join(cacheDirectory(name), `${version}.tgz`))} : undefined
}

/**
 * The package.json of the latest version of a package, undefined when it cannot be fetched
 * @param name
 */
export async function latestManifest(name: string): Promise<Record<string, any> | undefined> {
    try {
        const response: Response = await fetch(`${packageURL(name)}/latest`, {signal: AbortSignal.timeout(5000)})
        return response.ok ? await response.json() as Record<string, any> : undefined
    } catch {
        return undefined
    }
}

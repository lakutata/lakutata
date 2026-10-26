import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {latestManifest} from './Registry.js'

const require: NodeJS.Require = createRequire(import.meta.url)

/**
 * The package.json of the tool
 */
export function toolPackage(): { name: string, version: string, description: string } {
    return require('../../../package.json')
}

/**
 * The version of the framework used by the tool
 */
export function frameworkVersion(): string {
    return require('lakutata/package.json').version
}

/**
 * The version of the packages of lakutata written in the projects created, after a ^: the minor version of the
 * framework (3.1.0 for 3.1.2), since a patch releases only the packages it changes; a prerelease as it is, since all
 * the packages are released with it
 */
export function templateVersion(): string {
    const version: string = frameworkVersion()
    const release: RegExpExecArray | null = /^(\d+)\.(\d+)\.\d+$/.exec(version)
    return release ? `${release[1]}.${release[2]}.0` : version
}

/**
 * The latest version of a package on the registry, undefined when it cannot be fetched
 * @param name
 */
export async function latestVersion(name: string): Promise<string | undefined> {
    return (await latestManifest(name))?.version
}

/**
 * The major version of the tool: the templates of the same major version are used
 */
export function toolMajor(): number {
    return Number(toolPackage().version.split('.')[0])
}

/**
 * The version of the framework of the project of a directory (its dependency, and the installed one)
 * @param directory
 */
export async function projectFrameworkVersion(directory: string): Promise<{ project: string, declared?: string, installed?: string } | undefined> {
    for (let current: string = path.resolve(directory); ; current = path.dirname(current)) {
        try {
            const pkg: Record<string, any> = JSON.parse(await readFile(path.join(current, 'package.json'), 'utf8'))
            const declared: string | undefined = pkg.dependencies?.lakutata ?? pkg.devDependencies?.lakutata
            if (!declared) return undefined
            let installed: string | undefined
            try {
                installed = createRequire(path.join(current, 'package.json'))('lakutata/package.json').version
            } catch {
                installed = undefined
            }
            return {project: pkg.name ?? path.basename(current), declared: declared, installed: installed}
        } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
        }
        if (path.dirname(current) === current) return undefined
    }
}

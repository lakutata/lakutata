import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {LatestManifest} from './Registry.js'

const require: NodeJS.Require = createRequire(import.meta.url)

/**
 * The package.json of the tool
 */
export function ToolPackage(): { name: string, version: string, description: string } {
    return require('../../../package.json')
}

/**
 * The version of the framework used by the tool
 */
export function FrameworkVersion(): string {
    return require('lakutata/package.json').version
}

/**
 * The latest version of a package on the registry, undefined when it cannot be fetched
 * @param name
 */
export async function LatestVersion(name: string): Promise<string | undefined> {
    return (await LatestManifest(name))?.version
}

/**
 * The major version of the tool: the templates of the same major version are used
 */
export function ToolMajor(): number {
    return Number(ToolPackage().version.split('.')[0])
}

/**
 * The version of the framework of the project of a directory (its dependency, and the installed one)
 * @param directory
 */
export async function ProjectFrameworkVersion(directory: string): Promise<{ project: string, declared?: string, installed?: string } | undefined> {
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

import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {Settings} from './Settings.js'

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
    try {
        const response: Response = await fetch(`${Settings.registry}/${name}/latest`, {signal: AbortSignal.timeout(5000)})
        return response.ok ? ((await response.json()) as { version?: string }).version : undefined
    } catch {
        return undefined
    }
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

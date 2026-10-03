import {createRequire} from 'node:module'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

/**
 * The builder of the applications (@lakutata/builder): their bundles and their executables
 */
export type Builder = typeof import('@lakutata/builder')

/**
 * The builder of a project: the one installed in the project (its node_modules, the ones of its workspace), else the one
 * installed with the tool
 * @param project
 */
export async function LoadBuilder(project: string): Promise<Builder> {
    for (const base of [path.join(project, 'package.json'), import.meta.url]) {
        let entry: string
        try {
            entry = createRequire(base).resolve('@lakutata/builder')
        } catch {
            continue
        }
        return await import(pathToFileURL(entry).href) as Builder
    }
    throw new Error('The builder of the applications is not installed: install it in the project (npm install --save-dev @lakutata/builder)')
}

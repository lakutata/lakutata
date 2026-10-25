import {createRequire} from 'node:module'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

/**
 * The generator of the classes of native libraries (@lakutata/ffi/generator)
 */
export type Generator = typeof import('@lakutata/ffi/generator')

/**
 * The generator of a project: the one of the @lakutata/ffi installed in the project (its node_modules, the ones of its
 * workspace), else the one installed with the tool
 * @param project
 */
export async function loadGenerator(project: string): Promise<Generator> {
    for (const base of [path.join(project, 'package.json'), import.meta.url]) {
        let entry: string
        try {
            entry = createRequire(base).resolve('@lakutata/ffi/generator')
        } catch {
            continue
        }
        return await import(pathToFileURL(entry).href) as Generator
    }
    throw new Error('@lakutata/ffi is not installed: install it in the project (npm install @lakutata/ffi)')
}

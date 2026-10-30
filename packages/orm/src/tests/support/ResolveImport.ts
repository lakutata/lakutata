import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

/**
 * The URL of the ES module of a package the scripts the tests write import: import.meta.resolve (Node.js 18.19, 20.6 and
 * later), else the "import" entry of the exports of its package.json
 * @param name
 */
export function resolveImport(name: string): string {
    if (typeof import.meta.resolve === 'function') return import.meta.resolve(name)
    const manifest: string = createRequire(import.meta.url).resolve(`${name}/package.json`)
    const exported: unknown = JSON.parse(readFileSync(manifest, 'utf8')).exports?.['.']
    const entry: unknown = typeof exported === 'string' ? exported : (exported as { import?: unknown, default?: unknown } | undefined)?.import ?? (exported as { default?: unknown } | undefined)?.default
    const file: unknown = typeof entry === 'string' ? entry : (entry as { default?: unknown } | undefined)?.default
    if (typeof file !== 'string') throw new Error(`${name} exports no ES module`)
    return pathToFileURL(path.join(path.dirname(manifest), file)).href
}

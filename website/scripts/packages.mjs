import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * The published packages: their directories, names and descriptions
 */
export function publishedPackages() {
    return readdirSync(join(ROOT, 'packages'))
        .filter((directory) => existsSync(join(ROOT, 'packages', directory, 'package.json')))
        .map((directory) => ({directory, ...JSON.parse(readFileSync(join(ROOT, 'packages', directory, 'package.json'), 'utf8'))}))
        .filter((manifest) => !manifest.private && !manifest.name.startsWith('@lakutata/template'))
        .sort((a, b) => a.name === 'lakutata' ? -1 : b.name === 'lakutata' ? 1 : a.name.localeCompare(b.name))
}

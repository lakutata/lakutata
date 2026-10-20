/**
 * The fixture files of the protocol-engine suites: tsc copies no files but the TypeScript ones into dist, so the suites
 * read them from src/tests/engine of the package
 */
import {existsSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

function packageRoot(): string {
    let directory: string = dirname(fileURLToPath(import.meta.url))
    for (; ;) {
        const manifest: string = join(directory, 'package.json')
        if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === '@lakutata/webrtc') return directory
        const parent: string = dirname(directory)
        if (parent === directory) throw new Error('The package.json of @lakutata/webrtc is not found above the test support')
        directory = parent
    }
}

const root: string = join(packageRoot(), 'src', 'tests', 'engine')

/**
 * The path of a fixture file, relative to src/tests/engine (sctp/data/sctp_init.bin)
 * @param path
 */
export function fixture(path: string): string {
    return join(root, path)
}

/**
 * The content of a fixture file, relative to src/tests/engine
 * @param path
 */
export function readFixture(path: string): Buffer {
    return readFileSync(fixture(path))
}

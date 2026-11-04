import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

//The package from its build (dist/esm/tests)
const VENDOR: URL = new URL('../../../vendor/', import.meta.url)

describe('The vendored SQLite', (): void => {

    it('is the amalgamation of its release, unchanged (vendor/UPSTREAM.json)', (): void => {
        const upstream: { sqlite: { version: string, files: Record<string, string> } } = JSON.parse(readFileSync(new URL('UPSTREAM.json', VENDOR), 'utf8'))
        assert.strictEqual(upstream.sqlite.version, '3.53.2')
        for (const [file, sha256] of Object.entries(upstream.sqlite.files)) {
            assert.strictEqual(createHash('sha256').update(readFileSync(fileURLToPath(new URL(file, VENDOR)))).digest('hex'), sha256, file)
        }
    })
})

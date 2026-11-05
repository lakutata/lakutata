import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

//The package from its build (dist/esm/tests)
const PACKAGE: URL = new URL('../../../', import.meta.url)

describe('The vendored SQLite', (): void => {

    it('is the amalgamation of its release, unchanged (vendor/UPSTREAM.json)', (): void => {
        const upstream: { sqlite: { version: string, files: Record<string, { from: string, sha256: string }> } } = JSON.parse(readFileSync(new URL('vendor/UPSTREAM.json', PACKAGE), 'utf8'))
        assert.strictEqual(upstream.sqlite.version, '3.53.2')
        assert.deepStrictEqual(Object.keys(upstream.sqlite.files), ['native/engine/engine.c', 'native/engine/engine.h'])
        for (const [file, {sha256}] of Object.entries(upstream.sqlite.files)) {
            assert.strictEqual(createHash('sha256').update(readFileSync(fileURLToPath(new URL(file, PACKAGE)))).digest('hex'), sha256, file)
        }
    })
})

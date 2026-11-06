import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createHash} from 'node:crypto'
import {readdirSync, readFileSync} from 'node:fs'
import path from 'node:path'
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

describe('The vendored ICU', (): void => {

    it('is the part of the sources of its release the collators use, unchanged, with the data built for them (vendor/UPSTREAM.json)', (): void => {
        type Upstream = { icu: { version: string, into: string, files: Record<string, string>, license: { into: string, sha256: string }, data: { into: string, built: string } } }
        const {icu}: Upstream = JSON.parse(readFileSync(new URL('vendor/UPSTREAM.json', PACKAGE), 'utf8'))
        const hash = (file: string): string => createHash('sha256').update(readFileSync(fileURLToPath(new URL(file, PACKAGE)))).digest('hex')
        assert.strictEqual(icu.version, '77.1')
        //Every file of vendor/icu/source is one of the release, of its checksum
        const root: string = fileURLToPath(new URL(`${icu.into}/`, PACKAGE))
        const found: string[] = (readdirSync(root, {recursive: true}) as string[])
            .map((file: string): string => file.split(path.sep).join('/'))
            .filter((file: string): boolean => /\.(cpp|h)$/.test(file))
            .sort()
        assert.deepStrictEqual(found, Object.keys(icu.files).sort())
        for (const [file, sha256] of Object.entries(icu.files)) assert.strictEqual(hash(`${icu.into}/${file}`), sha256, file)
        assert.strictEqual(hash(icu.license.into), icu.license.sha256)
        assert.strictEqual(hash(icu.data.into), icu.data.built)
    })
})

describe('The vendored Snowball and Unicode Character Database', (): void => {
    it('are the files of their releases, unchanged (vendor/UPSTREAM.json)', (): void => {
        type Upstream = { libstemmer_c: { version: string, files: Record<string, string> }, ucd: { version: string, files: Record<string, string> } }
        const {libstemmer_c: snowball, ucd}: Upstream = JSON.parse(readFileSync(new URL('vendor/UPSTREAM.json', PACKAGE), 'utf8'))
        const hash = (file: string): string => createHash('sha256').update(readFileSync(fileURLToPath(new URL(file, PACKAGE)))).digest('hex')
        assert.deepStrictEqual([snowball.version, ucd.version], ['2014-04', '8.0.0'])
        const found: string[] = (readdirSync(fileURLToPath(new URL('vendor/libstemmer_c/', PACKAGE)), {recursive: true}) as string[])
            .map((file: string): string => file.split(path.sep).join('/'))
            .filter((file: string): boolean => /\.[ch]$|LICENSE$/.test(file))
            .sort()
        assert.deepStrictEqual(found, Object.keys(snowball.files).sort())
        for (const [file, sha256] of Object.entries(snowball.files)) assert.strictEqual(hash(`vendor/libstemmer_c/${file}`), sha256, file)
        for (const [file, sha256] of Object.entries(ucd.files)) assert.strictEqual(hash(`vendor/ucd/${file}`), sha256, file)
    })
})

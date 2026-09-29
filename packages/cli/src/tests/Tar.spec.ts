import {describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {gzipSync} from 'node:zlib'
import {ExtractTarGz, Under} from '../lib/Tar.js'

describe('Tar', (): void => {

    it('extracts the archives made by tar, without their root directory', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-tar-'))
        const source: string = path.join(work, 'repo-main')
        const long: string = `${'deep/'.repeat(30)}file-with-a-long-name.txt`
        mkdirSync(path.join(source, path.dirname(long)), {recursive: true})
        writeFileSync(path.join(source, 'package.json'), '{"name": "{$APP_ID}"}')
        writeFileSync(path.join(source, long), 'long')
        writeFileSync(path.join(source, 'run.sh'), '#!/bin/sh\n')
        chmodSync(path.join(source, 'run.sh'), 0o755)
        const archive: string = path.join(work, 'repo.tar.gz')
        //Without the AppleDouble files of macOS, as the archives of GitHub
        execFileSync('tar', ['-czf', archive, '-C', work, 'repo-main'], {env: {...process.env, COPYFILE_DISABLE: '1'}})
        const target: string = path.join(work, 'out')
        const files: string[] = await ExtractTarGz(readFileSync(archive), target, Under(1))
        assert.deepStrictEqual(files.sort(), [long, 'package.json', 'run.sh'].sort())
        assert.strictEqual(readFileSync(path.join(target, long), 'utf8'), 'long')
        assert.ok(statSync(path.join(target, 'run.sh')).mode & 0o100)
        rmSync(work, {recursive: true, force: true})
    })

    it('selects the entries under a path', (): void => {
        assert.strictEqual(Under('package/template')('package/template/src/App.ts'), 'src/App.ts')
        assert.strictEqual(Under('package/template')('package/package.json'), undefined)
        assert.strictEqual(Under(1)('repo-main/src/App.ts'), 'src/App.ts')
        assert.strictEqual(Under(1)('repo-main'), undefined)
    })

    it('refuses the entries outside of the target directory', async (): Promise<void> => {
        //A header of a file named "../evil.txt"
        const header: Buffer = Buffer.alloc(512)
        header.write('root/../../evil.txt', 0)
        header.write('0000644\0', 100)
        header.write('00000000004\0', 124)
        header.write('0', 156)
        const data: Buffer = Buffer.alloc(512)
        data.write('evil')
        const archive: Buffer = gzipSync(Buffer.concat([header, data, Buffer.alloc(1024)]))
        const target: string = mkdtempSync(path.join(tmpdir(), 'lakutata-tar-'))
        await assert.rejects(ExtractTarGz(archive, target, Under(1)), /outside of the target directory/)
        rmSync(target, {recursive: true, force: true})
    })
})

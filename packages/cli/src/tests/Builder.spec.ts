import {describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {loadBuilder} from '../lib/Builder.js'

describe('The builder of the pack commands', (): void => {
    it('is the one installed in the project, else the one installed with the tool', async (): Promise<void> => {
        const project: string = mkdtempSync(path.join(tmpdir(), 'lakutata-builder-'))
        try {
            writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'project', version: '1.0.0'}))
            //Without builder in the project: the one of the tool
            assert.strictEqual(typeof (await loadBuilder(project)).buildExecutable, 'function')
            const installed: string = path.join(project, 'node_modules', '@lakutata', 'builder')
            mkdirSync(installed, {recursive: true})
            writeFileSync(path.join(installed, 'package.json'), JSON.stringify({name: '@lakutata/builder', version: '9.9.9', type: 'module', exports: './index.js'}))
            writeFileSync(path.join(installed, 'index.js'), `export const installedInProject = true`)
            assert.strictEqual((await loadBuilder(project) as unknown as { installedInProject: boolean }).installedInProject, true)
        } finally {
            rmSync(project, {recursive: true, force: true})
        }
    })
})

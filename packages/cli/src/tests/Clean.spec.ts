import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, type ExecFileException} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {stripVTControlCharacters} from 'node:util'

const CLI: string = fileURLToPath(new URL('../CLIApp.js', import.meta.url))

let work: string

/**
 * Run the tool
 * @param args
 * @param cwd
 */
function Run(args: string[], cwd: string, env: Record<string, string> = {}): Promise<{ code: number, output: string }> {
    return new Promise((resolve: (result: { code: number, output: string }) => void): void => {
        execFile(process.execPath, [CLI, ...args], {cwd: cwd, env: {...process.env, npm_config_user_agent: '', ...env}}, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            output: stripVTControlCharacters(`${stdout}${stderr}`)
        }))
    })
}

/**
 * A package with files
 * @param name
 * @param files the files, by path relative to the package
 */
function Package(name: string, files: Record<string, string>): string {
    const directory: string = path.join(work, name)
    for (const [file, content] of Object.entries({'package.json': JSON.stringify({name: name}), 'src/App.ts': 'export {}', ...files})) {
        mkdirSync(path.dirname(path.join(directory, file)), {recursive: true})
        writeFileSync(path.join(directory, file), content)
    }
    return directory
}

describe('lakutata clean', (): void => {
    before((): void => {
        work = mkdtempSync(path.join(tmpdir(), 'lakutata-clean-'))
    })

    after((): void => rmSync(work, {recursive: true, force: true}))

    it('removes the paths given, the missing ones skipped', async (): Promise<void> => {
        const project: string = Package('paths', {'build/App.js': '', 'dist/app.cjs': '', '.next/cache/a': '', 'coverage.json': ''})
        const removed = await Run(['clean', 'build', 'dist', '.next', 'coverage.json', 'missing'], project)
        assert.strictEqual(removed.code, 0, removed.output)
        assert.match(removed.output, /Removed build, dist, \.next, coverage\.json/)
        for (const file of ['build', 'dist', '.next', 'coverage.json']) assert.ok(!existsSync(path.join(project, file)), file)
        assert.ok(existsSync(path.join(project, 'src', 'App.ts')))
        const nothing = await Run(['clean', 'build'], project)
        assert.strictEqual(nothing.code, 0, nothing.output)
        assert.match(nothing.output, /Nothing to remove \(build\)/)
    })

    it('removes the outDir and the declarationDir of the tsconfig.json by default, its comments and trailing commas read', async (): Promise<void> => {
        const project: string = Package('tsconfig', {
            'tsconfig.json': '{\n  // The output\n  "$schema": "https://json.schemastore.org/tsconfig", /* the schema */\n  "compilerOptions": {\n    "outDir": "build",\n    "declarationDir": "types",\n  },\n}\n',
            'build/App.js': '',
            'types/App.d.ts': ''
        })
        const removed = await Run(['clean'], project)
        assert.strictEqual(removed.code, 0, removed.output)
        assert.match(removed.output, /Removed build, types/)
        assert.ok(!existsSync(path.join(project, 'build')) && !existsSync(path.join(project, 'types')))
    })

    it('reads the outDir of the configurations extended, relative to the one giving it, the closest winning', async (): Promise<void> => {
        const project: string = Package('extends', {
            'configs/base.json': '{"compilerOptions": {"outDir": "../out", "declarationDir": "../declarations"}}',
            'node_modules/shared-config/package.json': JSON.stringify({name: 'shared-config'}),
            'node_modules/shared-config/tsconfig.json': '{"compilerOptions": {"strict": true}}',
            'tsconfig.json': '{"extends": ["shared-config/tsconfig.json", "./configs/base"], "compilerOptions": {"declarationDir": "typings"}}',
            'out/App.js': '',
            'declarations/App.d.ts': '',
            'typings/App.d.ts': ''
        })
        const removed = await Run(['clean'], project)
        assert.strictEqual(removed.code, 0, removed.output)
        assert.match(removed.output, /Removed out, typings/)
        //The declarationDir of the base is replaced by the one of the package
        assert.ok(existsSync(path.join(project, 'declarations')))
    })

    it('cleans in the scripts of an application run by a migration command (the tool ignores the commands of the migrations)', async (): Promise<void> => {
        for (const env of [{MIGRATION_GENERATE: 'src/migrations'}, {MIGRATION_SHOW: '1'}, {migration_run: '1'}] as Record<string, string>[]) {
            const project: string = Package(`migration-${Object.keys(env)[0]}`, {'tsconfig.json': '{"compilerOptions": {"outDir": "build"}}', 'build/App.js': ''})
            const removed = await Run(['clean'], project, env)
            assert.strictEqual(removed.code, 0, removed.output)
            assert.match(removed.output, /Removed build/)
            assert.ok(!existsSync(path.join(project, 'build')))
        }
    })

    it('asks for the paths without tsconfig.json or outDir', async (): Promise<void> => {
        const none = await Run(['clean'], Package('none', {}))
        assert.notStrictEqual(none.code, 0)
        assert.match(none.output, /has no tsconfig\.json: give the paths removed/)
        const noOutDir = await Run(['clean'], Package('noOutDir', {'tsconfig.json': '{"compilerOptions": {"noEmit": true}}'}))
        assert.notStrictEqual(noOutDir.code, 0)
        assert.match(noOutDir.output, /gives no outDir: give the paths removed/)
    })

    it('removes nothing outside of the package, nor the package, its sources, its dependencies or its manifest', async (): Promise<void> => {
        const project: string = Package('safe', {'build/App.js': '', 'node_modules/x/index.js': ''})
        writeFileSync(path.join(work, 'outside.txt'), '')
        for (const target of ['../outside.txt', path.join(work, 'outside.txt'), '.', 'src', 'src/App.ts', 'node_modules', 'node_modules/x', 'package.json']) {
            const refused = await Run(['clean', 'build', target], project)
            assert.notStrictEqual(refused.code, 0, target)
            assert.match(refused.output, /is not inside the package|is protected/, target)
        }
        //Refused before anything is removed
        assert.ok(existsSync(path.join(project, 'build', 'App.js')))
        assert.ok(existsSync(path.join(work, 'outside.txt')) && existsSync(path.join(project, 'node_modules', 'x')) && existsSync(path.join(project, 'src', 'App.ts')))
    })
})

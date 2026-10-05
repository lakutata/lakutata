import {afterEach, beforeEach, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, execFileSync, type ExecFileException, execSync, spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {nextVersion, updateRange} from '../lib/workspace/Version.js'

const CLI: string = fileURLToPath(new URL('../CLIApp.js', import.meta.url))

let root: string

/**
 * A script appending "<event> <package> <time>" to the log of the workspace, after a delay
 * @param name
 * @param delay
 * @param code the exit code
 */
function loggingScript(name: string, delay: number, code: number = 0): string {
    return `node -e "const f=require('node:fs');const log=require('node:path').resolve('../../events.log');f.appendFileSync(log,'start ${name} '+Date.now()+'\\n');setTimeout(()=>{f.appendFileSync(log,'end ${name} '+Date.now()+'\\n');console.log('built ${name}');process.exit(${code})},${delay})"`
}

/**
 * Write a package of the workspace
 * @param directory
 * @param manifest
 * @param indent
 */
function writePackage(directory: string, manifest: Record<string, unknown>, indent: string | number = 2): void {
    mkdirSync(path.join(root, directory), {recursive: true})
    writeFileSync(path.join(root, directory, 'package.json'), `${JSON.stringify(manifest, null, indent)}\n`)
}

/**
 * The workspace of sic-service: ui ← app ← proxy, with an independent package and a package without the script
 * @param failing the package whose script fails
 */
function sicService(failing?: string): void {
    writePackage('.', {name: 'root', private: true, workspaces: ['packages/*']})
    writeFileSync(path.join(root, 'lerna.json'), JSON.stringify({$schema: 'node_modules/lerna/schemas/lerna-schema.json', version: '0.0.16'}, null, 2))
    writePackage('packages/ui', {name: 'ui', version: '0.0.16', scripts: {rebuild: loggingScript('ui', 300, failing === 'ui' ? 1 : 0)}})
    writePackage('packages/app', {name: 'app', version: '0.0.16', dependencies: {ui: '^0.0.16', express: '^5.0.0'}, scripts: {rebuild: loggingScript('app', 100, failing === 'app' ? 1 : 0)}}, 4)
    writePackage('packages/proxy', {name: '@x/sic', version: '0.0.16', dependencies: {app: '^0.0.16'}, devDependencies: {ui: '0.0.16'}, scripts: {rebuild: loggingScript('proxy', 50)}})
    writePackage('packages/tools', {name: 'tools', version: '0.0.16', scripts: {rebuild: loggingScript('tools', 50)}})
    writePackage('packages/types', {name: 'types', version: '0.0.16'})
}

/**
 * The events of the scripts: when each package started and ended
 */
function scriptEvents(): Map<string, { start: number, end?: number }> {
    const events: Map<string, { start: number, end?: number }> = new Map()
    const file: string = path.join(root, 'events.log')
    if (!existsSync(file)) return events
    for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
        const [event, name, time] = line.split(' ')
        if (event === 'start') events.set(name, {start: Number(time)})
        else events.get(name)!.end = Number(time)
    }
    return events
}

/**
 * Run the tool in the workspace
 * @param args
 * @param cwd
 */
function runCommand(args: string[], cwd: string = root): Promise<{ code: number, stdout: string, stderr: string }> {
    return new Promise((resolve: (result: { code: number, stdout: string, stderr: string }) => void): void => {
        execFile(process.execPath, [CLI, ...args], {cwd: cwd}, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: stdout, stderr: stderr}))
    })
}

/**
 * A package.json of the workspace
 * @param directory
 */
function readManifest(directory: string): Record<string, any> {
    return JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'))
}

describe('The workspace commands', (): void => {

    beforeEach((): void => {
        root = mkdtempSync(path.join(tmpdir(), 'lakutata-workspace-'))
    })

    afterEach((): void => rmSync(root, {recursive: true, force: true}))

    it('lists the packages and their dependencies', async (): Promise<void> => {
        sicService()
        const listed = await runCommand(['list'], path.join(root, 'packages', 'app'))
        assert.strictEqual(listed.code, 0, listed.stderr)
        assert.match(listed.stdout, /5 packages, version 0\.0\.16/)
        assert.match(listed.stdout, /@x\/sic\s+0\.0\.16\s+packages[\\/]proxy\s+→ app, ui/)
    })

    it('runs a script in the order of the dependencies, the independent packages at the same time', async (): Promise<void> => {
        sicService()
        const result = await runCommand(['run', 'rebuild'])
        assert.strictEqual(result.code, 0, result.stderr)
        const events = scriptEvents()
        assert.deepStrictEqual([...events.keys()].sort(), ['app', 'proxy', 'tools', 'ui'])
        assert.ok(events.get('ui')!.end! <= events.get('app')!.start)
        assert.ok(events.get('app')!.end! <= events.get('proxy')!.start)
        //tools depends on nothing: it runs while ui runs
        assert.ok(events.get('tools')!.start < events.get('ui')!.end!)
        //The output is prefixed by the name of the package; the package without the script is skipped
        assert.match(result.stdout, /app\s+│ built app/)
        assert.match(result.stdout, /rebuild ran in /)
        assert.doesNotMatch(result.stdout, /types/)
    })

    it('runs one package at a time and only the packages in scope', async (): Promise<void> => {
        sicService()
        assert.strictEqual((await runCommand(['run', 'rebuild', '--concurrency', '1'])).code, 0)
        const events = scriptEvents()
        const spans = [...events.values()].sort((a, b): number => a.start - b.start)
        for (let index: number = 1; index < spans.length; index++) assert.ok(spans[index - 1].end! <= spans[index].start)
        rmSync(path.join(root, 'events.log'))
        assert.strictEqual((await runCommand(['run', 'rebuild', '--scope', 'a*', 't*'])).code, 0)
        assert.deepStrictEqual([...scriptEvents().keys()].sort(), ['app', 'tools'])
    })

    it('gives the scripts the environment of the user, not the one of the application of the tool', async (): Promise<void> => {
        writePackage('.', {name: 'root', private: true, workspaces: ['packages/*']})
        writePackage('packages/a', {name: 'a', version: '1.0.0', scripts: {env: 'node -e "console.log(\'NODE_ENV=\'+process.env.NODE_ENV)"'}})
        const result = await runCommand(['run', 'env'])
        assert.strictEqual(result.code, 0, result.stderr)
        assert.match(result.stdout, /NODE_ENV=undefined/)
    })

    it('runs all the packages at once with --parallel', async (): Promise<void> => {
        sicService()
        assert.strictEqual((await runCommand(['run', 'rebuild', '--parallel'])).code, 0)
        const events = scriptEvents()
        //app starts before ui, which it depends on, ended
        assert.ok(events.get('app')!.start < events.get('ui')!.end!)
    })

    it('stops at the first failure, or runs the packages which do not depend on it', async (): Promise<void> => {
        sicService('app')
        const failed = await runCommand(['run', 'rebuild', '--concurrency', '1'])
        assert.strictEqual(failed.code, 1)
        assert.match(failed.stderr, /rebuild failed in app, not run in @x\/sic/)
        assert.ok(!scriptEvents().has('proxy'))
        rmSync(path.join(root, 'events.log'))
        const continued = await runCommand(['run', 'rebuild', '--no-bail'])
        assert.strictEqual(continued.code, 1)
        assert.ok(scriptEvents().has('tools') && !scriptEvents().has('proxy'))
    })

    it('gives the packages the next version and updates the dependencies between them and the lock file', async (): Promise<void> => {
        sicService()
        //npm.cmd on Windows, run by the shell
        execSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund --prefer-offline', {cwd: root, stdio: 'ignore'})
        const result = await runCommand(['version', 'patch', '--yes'])
        assert.strictEqual(result.code, 0, result.stderr)
        assert.match(result.stdout, /Version 0\.0\.16 → 0\.0\.17/)
        assert.strictEqual(JSON.parse(readFileSync(path.join(root, 'lerna.json'), 'utf8')).version, '0.0.17')
        for (const directory of ['ui', 'app', 'proxy', 'tools', 'types']) assert.strictEqual(readManifest(`packages/${directory}`).version, '0.0.17')
        assert.deepStrictEqual(readManifest('packages/app').dependencies, {ui: '^0.0.17', express: '^5.0.0'})
        assert.deepStrictEqual(readManifest('packages/proxy').dependencies, {app: '^0.0.17'})
        assert.deepStrictEqual(readManifest('packages/proxy').devDependencies, {ui: '0.0.17'})
        //The indentation of the files is kept
        assert.match(readFileSync(path.join(root, 'packages/app/package.json'), 'utf8'), /^ {4}"name"/m)
        //npm ci accepts the lock file
        const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
        assert.strictEqual(lock.packages['packages/app'].version, '0.0.17')
        assert.strictEqual(lock.packages['packages/app'].dependencies.ui, '^0.0.17')
    })

    it('keeps the version in the root package.json without lerna.json, and commits and tags it', async (): Promise<void> => {
        writePackage('.', {name: 'root', private: true, version: '1.2.3', workspaces: ['packages/*']})
        writePackage('packages/a', {name: 'a', version: '1.2.3'})
        writePackage('packages/b', {name: 'b', version: '1.2.3', dependencies: {a: '~1.2.3'}})
        const hasGit: boolean = spawnSync('git', ['--version']).status === 0
        if (hasGit) {
            for (const args of [['init', '-q'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test'], ['add', '-A'], ['commit', '-q', '-m', 'init']]) execFileSync('git', args, {cwd: root})
        }
        const result = await runCommand(['version', 'preminor', '--preid', 'beta', '--yes', ...(hasGit ? ['--git'] : [])])
        assert.strictEqual(result.code, 0, result.stderr)
        assert.strictEqual(readManifest('.').version, '1.3.0-beta.0')
        assert.deepStrictEqual(readManifest('packages/b').dependencies, {a: '~1.3.0-beta.0'})
        if (hasGit) {
            assert.strictEqual(execFileSync('git', ['tag'], {cwd: root}).toString().trim(), 'v1.3.0-beta.0')
            assert.strictEqual(execFileSync('git', ['status', '--porcelain'], {cwd: root}).toString().trim(), '')
        }
    })

    it('fails outside of a workspace', async (): Promise<void> => {
        writePackage('.', {name: 'alone'})
        const result = await runCommand(['list'])
        assert.strictEqual(result.code, 1)
        assert.match(result.stderr, /is not in a workspace/)
    })

    it('computes the next versions and the ranges', (): void => {
        assert.strictEqual(nextVersion('0.0.16', 'patch'), '0.0.17')
        assert.strictEqual(nextVersion('1.2.3', 'minor'), '1.3.0')
        assert.strictEqual(nextVersion('1.2.3', 'major'), '2.0.0')
        assert.strictEqual(nextVersion('1.2.3', 'prerelease', 'rc'), '1.2.4-rc.0')
        assert.strictEqual(nextVersion('1.2.4-rc.0', 'prerelease'), '1.2.4-rc.1')
        assert.strictEqual(nextVersion('1.2.4-rc.1', 'patch'), '1.2.4')
        assert.strictEqual(nextVersion('1.2.3', '4.0.0'), '4.0.0')
        assert.throws((): string => nextVersion('1.2.3', 'huge'), /Invalid bump/)
        assert.strictEqual(updateRange('^0.0.16', '0.0.17'), '^0.0.17')
        assert.strictEqual(updateRange('workspace:^1.0.0', '1.1.0'), 'workspace:^1.1.0')
        assert.strictEqual(updateRange('*', '1.1.0'), '*')
        assert.strictEqual(updateRange('file:../a', '1.1.0'), 'file:../a')
    })
})

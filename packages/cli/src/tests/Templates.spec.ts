import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, type ExecFileException} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * The root of the repository
 */
const ROOT: string = fileURLToPath(new URL('../../../../../', import.meta.url))

const CLI: string = fileURLToPath(new URL('../CLIApp.js', import.meta.url))

const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-templates-'))

/**
 * Run a command
 * @param command
 * @param args
 * @param cwd
 */
function Run(command: string, args: string[], cwd: string): Promise<{ code: number, output: string }> {
    return new Promise((resolve: (result: { code: number, output: string }) => void): void => {
        //The tests of the project run on their own, not as tests nested in the running ones
        const {NODE_TEST_CONTEXT, ...env} = process.env
        void NODE_TEST_CONTEXT
        execFile(command, args, {cwd: cwd, env: {...env, LAKUTATA_CACHE_DIR: path.join(work, 'cache'), NEXT_TELEMETRY_DISABLED: '1'}}, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, output: `${stdout}${stderr}`}))
    })
}

/**
 * Link a package of the repository into the node_modules of a project
 * @param project
 * @param name
 * @param target
 */
function Link(project: string, name: string, target: string): void {
    const link: string = path.join(project, 'node_modules', name)
    mkdirSync(path.dirname(link), {recursive: true})
    symlinkSync(target, link, 'dir')
}

/**
 * Install the dependencies of a project from the repository: the framework and the tool are its packages, the others its dependencies
 * @param project
 * @param names the third-party dependencies
 * @param typescript the directory of the TypeScript of the project, the one of the repository by default
 */
function Install(project: string, names: string[], typescript: string = path.join(ROOT, 'node_modules', 'typescript')): void {
    Link(project, 'lakutata', path.join(ROOT, 'packages', 'lakutata'))
    Link(project, '@lakutata/cli', path.join(ROOT, 'packages', 'cli'))
    Link(project, 'typescript', typescript)
    for (const name of names) Link(project, name, path.join(ROOT, 'node_modules', name))
    //The commands of the scripts
    mkdirSync(path.join(project, 'node_modules', '.bin'), {recursive: true})
    symlinkSync(path.join(typescript, 'bin', 'tsc'), path.join(project, 'node_modules', '.bin', 'tsc'))
    symlinkSync(CLI, path.join(project, 'node_modules', '.bin', 'lakutata'))
}

/**
 * Link the packages of the workspace of a project into its node_modules, as npm does
 * @param project
 * @param names
 */
function LinkWorkspace(project: string, names: string[]): void {
    for (const name of names) Link(project, name, path.join(project, 'packages', name))
}

/**
 * Create a project from a template of the repository
 * @param template
 * @param name
 */
async function Create(template: string, name: string): Promise<string> {
    const created = await Run(process.execPath, [CLI, 'create', '--name', name, '--template', path.join(ROOT, 'packages', `template-${template}`), '--package-manager', 'none', '--no-git', '--yes'], work)
    assert.strictEqual(created.code, 0, created.output)
    const project: string = path.join(work, name)
    assert.ok(existsSync(path.join(project, '.gitignore')))
    return project
}

describe('The templates of the repository', (): void => {

    after((): void => rmSync(work, {recursive: true, force: true}))

    it('keeps the files the templates share identical', (): void => {
        //The service templates share their workspace and their app, the web ones serving their ui besides
        const shared: string[] = [
            'package.json', 'Dockerfile', '_dockerignore', '_gitignore',
            'packages/app/tsconfig.json', 'packages/app/src/App.ts', 'packages/app/src/middlewares/Authenticate.ts',
            'packages/app/src/controllers/HealthController.ts', 'packages/app/src/dtos/GreetDTO.ts'
        ]
        //The development of web-next compiles the handler of its pages before starting the app
        const differences: Record<string, (manifest: Record<string, any>) => void> = {
            'web-next': (manifest: Record<string, any>): unknown => delete manifest.scripts.dev
        }
        for (const template of ['web-react', 'web-next', 'web-vue', 'web-nuxt']) {
            for (const file of shared) {
                let service: string = readFileSync(path.join(ROOT, 'packages', 'template-service', 'template', file), 'utf8')
                let other: string = readFileSync(path.join(ROOT, 'packages', `template-${template}`, 'template', file), 'utf8')
                if (file === 'package.json' && differences[template]) {
                    const [a, b] = [JSON.parse(service), JSON.parse(other)]
                    differences[template](a)
                    differences[template](b)
                    ;[service, other] = [JSON.stringify(a), JSON.stringify(b)]
                }
                assert.strictEqual(other, service, `${file} of ${template} differs from the one of service`)
            }
        }
    })

    it('creates a project from the default template which builds and passes its tests with the framework of the repository', async (): Promise<void> => {
        const project: string = await Create('default', 'Demo')
        assert.doesNotMatch(readFileSync(path.join(project, 'src', 'config', 'Config.ts'), 'utf8'), /\{\$APP_/)
        //The dependencies of the project are the packages of the repository
        Link(project, 'lakutata', path.join(ROOT, 'packages', 'lakutata'))
        for (const name of ['express', '@types/express', '@types/node']) Link(project, name, path.join(ROOT, 'node_modules', name))
        const built = await Run(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', project], project)
        assert.strictEqual(built.code, 0, built.output)
        const tested = await Run(process.execPath, ['--test', 'build/tests/App.spec.js'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 1/)
    })

    it('creates a command line tool which passes its tests, and is bundled and made into an executable', async (): Promise<void> => {
        const project: string = await Create('cli', 'Greeter')
        assert.doesNotMatch(readFileSync(path.join(project, 'src', 'config', 'Config.ts'), 'utf8'), /\{\$APP_/)
        assert.strictEqual(JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8')).bin.greeter, 'build/App.js')
        Install(project, ['@types/node'])
        const tested = await Run('npm', ['test'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 4/)
        //The bundle and the executable have the dependencies and the version of the tool
        const bundled = await Run('npm', ['run', 'bundle'], project)
        assert.strictEqual(bundled.code, 0, bundled.output)
        const bundle = await Run(process.execPath, [path.join(project, 'dist', 'greeter.cjs'), 'greet', '--name', 'bundle'], work)
        assert.strictEqual(bundle.output.trim(), 'Hello, bundle!')
        const made = await Run('npm', ['run', 'executable'], project)
        assert.strictEqual(made.code, 0, made.output)
        const executable: string = path.join(project, 'dist', process.platform === 'win32' ? 'greeter.exe' : 'greeter')
        assert.strictEqual((await Run(executable, ['greet', '--name', 'executable', '--loud'], work)).output.trim(), 'HELLO, EXECUTABLE!')
        assert.strictEqual((await Run(executable, ['--version'], work)).output.trim(), '0.0.1')
    })

    it('creates a service whose workspace builds and passes its tests', async (): Promise<void> => {
        const project: string = await Create('service', 'Orders')
        assert.ok(existsSync(path.join(project, '.dockerignore')))
        assert.ok(existsSync(path.join(project, 'Dockerfile')))
        assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'app', 'src', 'config', 'Config.ts'), 'utf8'), /\{\$APP_/)
        Install(project, ['express', 'compression', '@types/express', '@types/compression', '@types/node'])
        //The scripts of the workspace: its packages built in order, then tested
        const built = await Run(process.execPath, [CLI, 'run', 'rebuild'], project)
        assert.strictEqual(built.code, 0, built.output)
        const tested = await Run(process.execPath, [CLI, 'run', 'test'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 3/)
    })

    it('creates a React web application whose workspace builds the ui then the app, which serves it', async (): Promise<void> => {
        const project: string = await Create('web-react', 'Portal')
        assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'ui', 'src', 'App.tsx'), 'utf8'), /\{\$APP_/)
        Install(project, ['express', 'compression', '@types/express', '@types/compression', '@types/node', 'vite', '@vitejs/plugin-react', 'react', 'react-dom', '@types/react', '@types/react-dom'])
        LinkWorkspace(project, ['ui'])
        symlinkSync(path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), path.join(project, 'node_modules', '.bin', 'vite'))
        const built = await Run(process.execPath, [CLI, 'run', 'rebuild', '--concurrency', '1'], project)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(project, 'packages', 'ui', 'dist', 'index.html')))
        //ui is built before app, which depends on it
        assert.ok(built.output.indexOf('ui ') < built.output.indexOf('app '), built.output)
        const tested = await Run(process.execPath, [CLI, 'run', 'test'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 4/)
        //The ui is type checked with the TypeScript of the template (vite does not check the types)
        const checked = await Run(process.execPath, [path.join(ROOT, 'packages', 'template-web-react', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(project, 'packages', 'ui')], project)
        assert.strictEqual(checked.code, 0, checked.output)
    })

    it('creates a Next.js web application whose workspace builds the ui then the app, which renders its pages', async (): Promise<void> => {
        const project: string = await Create('web-next', 'Console')
        assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'ui', 'app', 'page.tsx'), 'utf8'), /\{\$APP_/)
        Install(project, ['express', 'compression', '@types/express', '@types/compression', '@types/node', 'next', 'react', 'react-dom', '@types/react', '@types/react-dom'], path.join(ROOT, 'packages', 'template-web-next', 'node_modules', 'typescript'))
        LinkWorkspace(project, ['ui'])
        symlinkSync(path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), path.join(project, 'node_modules', '.bin', 'next'))
        //The dependencies are linked to the repository, outside of the project: turbopack resolves them from the root of the filesystem
        //(an installed project has them in its node_modules)
        const nextConfig: string = path.join(project, 'packages', 'ui', 'next.config.ts')
        writeFileSync(nextConfig, readFileSync(nextConfig, 'utf8').replace('const nextConfig: NextConfig = {}', `const nextConfig: NextConfig = {turbopack: {root: ${JSON.stringify(path.parse(project).root)}}}`))
        const built = await Run(process.execPath, [CLI, 'run', 'rebuild', '--concurrency', '1'], project)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(project, 'packages', 'ui', '.next')))
        assert.ok(existsSync(path.join(project, 'packages', 'ui', 'server', 'build', 'index.js')))
        const tested = await Run(process.execPath, [CLI, 'run', 'test'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 4/)
    })
    it('creates a Vue web application whose workspace builds the ui then the app, which serves it', async (): Promise<void> => {
        const project: string = await Create('web-vue', 'Studio')
        assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'ui', 'src', 'App.vue'), 'utf8'), /\{\$APP_/)
        Install(project, ['express', 'compression', '@types/express', '@types/compression', '@types/node', 'vite', '@vitejs/plugin-vue', 'vue'])
        LinkWorkspace(project, ['ui'])
        symlinkSync(path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), path.join(project, 'node_modules', '.bin', 'vite'))
        const built = await Run(process.execPath, [CLI, 'run', 'rebuild', '--concurrency', '1'], project)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(project, 'packages', 'ui', 'dist', 'index.html')))
        const tested = await Run(process.execPath, [CLI, 'run', 'test'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 4/)
        //The ui is type checked by vue-tsc (vite does not check the types), with the TypeScript of the template
        const vueTsc: string = `require(${JSON.stringify(path.join(ROOT, 'node_modules', 'vue-tsc'))}).run(${JSON.stringify(path.join(ROOT, 'packages', 'template-web-vue', 'node_modules', 'typescript', 'lib', 'tsc.js'))})`
        const checked = await Run(process.execPath, ['-e', vueTsc, 'vue-tsc', '--noEmit', '-p', path.join(project, 'packages', 'ui')], project)
        assert.strictEqual(checked.code, 0, checked.output)
    })

    it('creates a Nuxt web application whose workspace builds the ui then the app, which renders its pages', async (): Promise<void> => {
        const project: string = await Create('web-nuxt', 'Board')
        assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'ui', 'app', 'app.vue'), 'utf8'), /\{\$APP_/)
        Install(project, ['express', 'compression', '@types/express', '@types/compression', '@types/node', 'nuxt', 'vue'])
        LinkWorkspace(project, ['ui'])
        symlinkSync(path.join(ROOT, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs'), path.join(project, 'node_modules', '.bin', 'nuxt'))
        const built = await Run(process.execPath, [CLI, 'run', 'rebuild', '--concurrency', '1'], project)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(project, 'packages', 'ui', '.output', 'server', 'index.mjs')))
        const tested = await Run(process.execPath, [CLI, 'run', 'test'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 4/)
        //The ui is type checked as nuxt typecheck does, with the TypeScript of the template
        const vueTsc: string = `require(${JSON.stringify(path.join(ROOT, 'node_modules', 'vue-tsc'))}).run(${JSON.stringify(path.join(ROOT, 'packages', 'template-web-nuxt', 'node_modules', 'typescript', 'lib', 'tsc.js'))})`
        const checked = await Run(process.execPath, ['-e', vueTsc, 'vue-tsc', '-b', '--noEmit'], path.join(project, 'packages', 'ui'))
        assert.strictEqual(checked.code, 0, checked.output)
    })
})

import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, type ExecFileException, spawn} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {stripVTControlCharacters} from 'node:util'

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
        execFile(command, args, {cwd: cwd, env: {...env, LAKUTATA_CACHE_DIR: path.join(work, 'cache'), NEXT_TELEMETRY_DISABLED: '1'}}, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, output: stripVTControlCharacters(`${stdout}${stderr}`)}))
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
 * @param features the features of the template enabled
 */
async function Create(template: string, name: string, features: string[] = []): Promise<string> {
    const created = await Run(process.execPath, [CLI, 'create', '--name', name, '--template', path.join(ROOT, 'packages', `template-${template}`), ...(features.length ? ['--with', features.join(',')] : []), '--package-manager', 'none', '--no-git', '--yes'], work)
    assert.strictEqual(created.code, 0, created.output)
    const project: string = path.join(work, name)
    assert.ok(existsSync(path.join(project, '.gitignore')))
    return project
}

/**
 * The text of the page of an Electron application, read with the DevTools protocol once it shows the result of its action;
 * the application is ended then
 * @param project
 * @param args the application
 */
async function ElectronPage(project: string, args: string[]): Promise<string> {
    const electron: string = createRequire(import.meta.url)(path.join(ROOT, 'node_modules', 'electron'))
    const port: number = 9300 + Math.floor(Math.random() * 500)
    const {NODE_TEST_CONTEXT, ...env} = process.env
    void NODE_TEST_CONTEXT
    const child = spawn(electron, [`--remote-debugging-port=${port}`, ...args], {cwd: project, env: env, stdio: 'ignore'})
    let text: string = ''
    try {
        for (let attempt: number = 0; attempt < 60 && !/Hello, /.test(text); attempt++) {
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
            try {
                const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as { type: string, webSocketDebuggerUrl: string }[]
                const page = pages.find(({type}): boolean => type === 'page')
                if (!page) continue
                text = await new Promise((resolve: (text: string) => void, reject: (error: unknown) => void): void => {
                    const socket: WebSocket = new WebSocket(page.webSocketDebuggerUrl)
                    socket.onopen = (): void => socket.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {expression: `document.body.innerText + ' | isolated: ' + (typeof require === 'undefined' && typeof process === 'undefined')`, returnByValue: true}}))
                    socket.onmessage = (message: MessageEvent): void => {
                        const response = JSON.parse(String(message.data))
                        if (response.id !== 1) return
                        socket.close()
                        resolve(response.result?.result?.value ?? '')
                    }
                    socket.onerror = reject
                })
            } catch {
                //Not started yet
            }
        }
    } finally {
        child.kill()
    }
    return text
}

/**
 * Make the executable of the app package of a web application in a directory, and run it from elsewhere: the page it
 * serves (its ui, a resource of the executable)
 * @param project
 */
async function ServeFromExecutable(project: string): Promise<string> {
    const made = await Run(process.execPath, [CLI, 'executable', '--layout', 'directory'], path.join(project, 'packages', 'app'))
    assert.strictEqual(made.code, 0, made.output)
    assert.match(made.output, /Resources next to the executable: ui/)
    const executable: string = path.join(project, 'packages', 'app', 'dist', 'app', process.platform === 'win32' ? 'app.exe' : 'app')
    const port: number = 20000 + Math.floor(Math.random() * 5000)
    const child = spawn(executable, [], {cwd: tmpdir(), env: {...process.env, PORT: String(port), NODE_ENV: 'production'}, stdio: 'ignore'})
    try {
        for (let attempt = 0; attempt < 200; attempt++) {
            try {
                const response: Response = await fetch(`http://127.0.0.1:${port}/`, {headers: {accept: 'text/html'}})
                if (response.ok) return await response.text()
            } catch {
                //Not listening yet
            }
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
        }
        throw new Error('The executable does not serve its page')
    } finally {
        child.kill('SIGTERM')
    }
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
            //The files of their features too
            const features: string = path.join(ROOT, 'packages', 'template-service', 'features')
            for (const file of readdirSync(features, {recursive: true, withFileTypes: true}).filter((entry): boolean => entry.isFile()).map((entry): string => path.relative(features, path.join(entry.parentPath, entry.name)))) {
                assert.strictEqual(readFileSync(path.join(ROOT, 'packages', `template-${template}`, 'features', file), 'utf8'), readFileSync(path.join(features, file), 'utf8'), `features/${file} of ${template} differs from the one of service`)
            }
        }
    })

    it('keeps the files the Electron templates share identical', (): void => {
        //The Electron templates differ by their renderer only
        const files = (directory: string): string[] => readdirSync(directory, {recursive: true, withFileTypes: true})
            .filter((entry): boolean => entry.isFile() && !entry.parentPath.includes('node_modules'))
            .map((entry): string => path.relative(directory, path.join(entry.parentPath, entry.name)))
            .filter((file: string): boolean => !file.startsWith(path.join('packages', 'ui')) && file !== 'README.md')
            .sort()
        const react: string = path.join(ROOT, 'packages', 'template-electron-react', 'template')
        const vue: string = path.join(ROOT, 'packages', 'template-electron-vue', 'template')
        assert.deepStrictEqual(files(vue), files(react))
        for (const file of files(react)) assert.strictEqual(readFileSync(path.join(vue, file), 'utf8'), readFileSync(path.join(react, file), 'utf8'), `${file} of electron-vue differs from the one of electron-react`)
        assert.strictEqual(readFileSync(path.join(vue, 'packages', 'ui', 'src', 'lakutata.ts'), 'utf8'), readFileSync(path.join(react, 'packages', 'ui', 'src', 'lakutata.ts'), 'utf8'))
        const [reactFeatures, vueFeatures] = [react, vue].map((directory: string): string => path.join(directory, '..', 'features'))
        assert.deepStrictEqual(files(vueFeatures), files(reactFeatures))
        for (const file of files(reactFeatures)) assert.strictEqual(readFileSync(path.join(vueFeatures, file), 'utf8'), readFileSync(path.join(reactFeatures, file), 'utf8'), `features/${file} of electron-vue differs`)
    })

    it('creates the projects with the i18n feature: their requests answered in their languages, the messages checked and bundled', async (): Promise<void> => {
        //An HTTP application
        const demo: string = await Create('default', 'Polyglot', ['i18n'])
        assert.ok(existsSync(path.join(demo, 'src', 'locales', 'zh-CN.json')))
        assert.strictEqual(JSON.parse(readFileSync(path.join(demo, 'tsconfig.json'), 'utf8')).compilerOptions.resolveJsonModule, true)
        assert.doesNotMatch(readFileSync(path.join(demo, 'src', 'config', 'Config.ts'), 'utf8'), /@if|@end/)
        Install(demo, ['express', '@types/express', '@types/node'])
        const tested = await Run('npm', ['test'], demo)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 2/)
        const checked = await Run('npm', ['run', 'i18n:check'], demo)
        assert.strictEqual(checked.code, 0, checked.output)
        assert.match(checked.output, /2 languages \(en, zh-CN\), 0 errors, 0 warnings/)
        //A command line tool, in the language of its environment, its messages bundled
        const tool: string = await Create('cli', 'Babel', ['i18n'])
        Install(tool, ['@types/node'])
        const toolTested = await Run('npm', ['test'], tool)
        assert.strictEqual(toolTested.code, 0, toolTested.output)
        assert.match(toolTested.output, /pass 5/)
        const toolBundled = await Run('npm', ['run', 'bundle'], tool)
        assert.strictEqual(toolBundled.code, 0, toolBundled.output)
        const bundled = await new Promise<string>((resolve: (output: string) => void): void => {
            execFile(process.execPath, [path.join(tool, 'dist', 'babel.cjs'), 'greet', '--name', 'bundle'], {cwd: work, env: {...process.env, LC_ALL: 'zh_CN.UTF-8'}}, (error: ExecFileException | null, stdout: string): void => resolve(stdout.trim()))
        })
        assert.strictEqual(bundled, '你好，bundle！')
        //A service, its validation errors in the language of the request
        const service: string = await Create('service', 'Tower', ['i18n'])
        Install(service, ['express', 'compression', '@types/express', '@types/compression', '@types/node'])
        const serviceBuilt = await Run(process.execPath, [CLI, 'run', 'rebuild'], service)
        assert.strictEqual(serviceBuilt.code, 0, serviceBuilt.output)
        const serviceTested = await Run(process.execPath, [CLI, 'run', 'test'], service)
        assert.strictEqual(serviceTested.code, 0, serviceTested.output)
        assert.match(serviceTested.output, /pass 4/)
        //An Electron application, its actions in the language of the environment
        const desktop: string = await Create('electron-vue', 'Lingo', ['i18n'])
        Install(desktop, ['@types/node', 'electron', 'vite', '@vitejs/plugin-vue', 'vue'])
        LinkWorkspace(desktop, ['ui', 'app'])
        symlinkSync(path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), path.join(desktop, 'node_modules', '.bin', 'vite'))
        const desktopBuilt = await Run(process.execPath, [CLI, 'run', 'rebuild', '--concurrency', '1'], desktop)
        assert.strictEqual(desktopBuilt.code, 0, desktopBuilt.output)
        const desktopTested = await Run(process.execPath, [CLI, 'run', 'test'], desktop)
        assert.strictEqual(desktopTested.code, 0, desktopTested.output)
        assert.match(desktopTested.output, /pass 4/)
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

    it('creates a command line tool which passes its tests, and is built into an executable and bundled', async (): Promise<void> => {
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
        const made = await Run('npm', ['run', 'build'], project)
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
        //The migrations of a database of the service, generated by its script, compiled with the service
        Link(project, 'sqlite3', path.join(ROOT, 'node_modules', 'sqlite3'))
        const config: string = path.join(project, 'packages', 'app', 'src', 'config', 'Config.ts')
        writeFileSync(config, readFileSync(config, 'utf8')
            .replace('import compression from \'compression\'\n', 'import compression from \'compression\'\nimport {BuildDatabaseOptions} from \'lakutata/com/database\'\nimport {EntitySchema} from \'lakutata/orm\'\n\nconst Order = new EntitySchema({name: \'order\', columns: {id: {type: \'uuid\', primary: true, generated: \'uuid\'}, total: {type: Number}}})\n')
            .replace('        components: {\n', '        components: {\n            db: BuildDatabaseOptions({type: \'sqlite\', database: \'orders.db\', entities: [Order]}),\n'))
        const generated = await Run('npm', ['run', 'migration:generate'], project)
        assert.strictEqual(generated.code, 0, generated.output)
        const migrations: string[] = readdirSync(path.join(project, 'packages', 'app', 'src', 'migrations'))
        assert.strictEqual(migrations.length, 1, generated.output)
        assert.match(migrations[0], /^\d+-db\.ts$/)
        assert.match(generated.output, /Migrations generated: packages\/app\/src\/migrations\/\d+-db\.ts/)
        assert.match(readFileSync(path.join(project, 'packages', 'app', 'src', 'migrations', migrations[0]), 'utf8'), /CREATE TABLE "order"/)
        //The migration given to the options of the database: shown, run, reverted by the scripts of the workspace
        const timestamp: string = migrations[0].split('-')[0]
        writeFileSync(config, readFileSync(config, 'utf8')
            .replace('import {EntitySchema} from \'lakutata/orm\'\n', `import {EntitySchema} from 'lakutata/orm'\nimport {Migrations${timestamp}} from '../migrations/${timestamp}-db.js'\n`)
            .replace('entities: [Order]})', `entities: [Order], migrations: [Migrations${timestamp}]})`))
        const shown = await Run('npm', ['run', 'migration:show'], project)
        assert.strictEqual(shown.code, 0, shown.output)
        assert.match(shown.output, new RegExp(`\\[db\\] \\[ \\] Migrations${timestamp}\\n\\[db\\] 1 pending migration`))
        const ran = await Run('npm', ['run', 'migration:run'], project)
        assert.strictEqual(ran.code, 0, ran.output)
        assert.match(ran.output, new RegExp(`\\[db\\] Migration Migrations${timestamp} has been run`))
        assert.match((await Run('npm', ['run', 'migration:show'], project)).output, new RegExp(`\\[X\\] Migrations${timestamp}\\n\\[db\\] No pending migration`))
        const reverted = await Run('npm', ['run', 'migration:revert'], project)
        assert.strictEqual(reverted.code, 0, reverted.output)
        assert.match(reverted.output, new RegExp(`\\[db\\] Migration Migrations${timestamp} has been reverted`))
        //An empty migration, compiled with the service
        const created = await Run('npm', ['run', 'migration:create', '--', 'seed-orders'], project)
        assert.strictEqual(created.code, 0, created.output)
        assert.match(created.output, /Migration created: packages\/app\/src\/migrations\/\d+-seed-orders\.ts/)
        const rebuilt = await Run(process.execPath, [CLI, 'run', 'rebuild'], project)
        assert.strictEqual(rebuilt.code, 0, rebuilt.output)
        const compiled: string[] = readdirSync(path.join(project, 'packages', 'app', 'build', 'migrations'))
        assert.ok(compiled.includes(migrations[0].replace(/\.ts$/, '.js')))
        assert.ok(compiled.some((file: string): boolean => /^\d+-seed-orders\.js$/.test(file)))
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
        const checked = await Run(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(project, 'packages', 'ui')], project)
        assert.strictEqual(checked.code, 0, checked.output)
        //Packed into an executable, it serves its ui from its resources
        const page: string = await ServeFromExecutable(project)
        assert.strictEqual(page, readFileSync(path.join(project, 'packages', 'ui', 'dist', 'index.html'), 'utf8'))
    })

    it('creates a Next.js web application whose workspace builds the ui then the app, which renders its pages', async (): Promise<void> => {
        const project: string = await Create('web-next', 'Console')
        assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'ui', 'app', 'page.tsx'), 'utf8'), /\{\$APP_/)
        Install(project, ['express', 'compression', '@types/express', '@types/compression', '@types/node', 'next', 'react', 'react-dom', '@types/react', '@types/react-dom'], path.join(ROOT, 'node_modules', 'typescript'))
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
        const vueTsc: string = `require(${JSON.stringify(path.join(ROOT, 'node_modules', 'vue-tsc'))}).run(${JSON.stringify(path.join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js'))})`
        const checked = await Run(process.execPath, ['-e', vueTsc, 'vue-tsc', '--noEmit', '-p', path.join(project, 'packages', 'ui')], project)
        assert.strictEqual(checked.code, 0, checked.output)
        //Packed into an executable, it serves its ui from its resources
        const page: string = await ServeFromExecutable(project)
        assert.strictEqual(page, readFileSync(path.join(project, 'packages', 'ui', 'dist', 'index.html'), 'utf8'))
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
        const vueTsc: string = `require(${JSON.stringify(path.join(ROOT, 'node_modules', 'vue-tsc'))}).run(${JSON.stringify(path.join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js'))})`
        const checked = await Run(process.execPath, ['-e', vueTsc, 'vue-tsc', '-b', '--noEmit'], path.join(project, 'packages', 'ui'))
        assert.strictEqual(checked.code, 0, checked.output)
    })

    for (const [template, name, ui, names] of [
        ['electron-react', 'Desk', 'App.tsx', ['vite', '@vitejs/plugin-react', 'react', 'react-dom', '@types/react', '@types/react-dom']],
        ['electron-vue', 'Pad', 'App.vue', ['vite', '@vitejs/plugin-vue', 'vue']]
    ] as [string, string, string, string[]][]) {
        it(`creates an Electron application (${template}) whose main process serves its renderer over IPC, and assembles it`, async (): Promise<void> => {
            const project: string = await Create(template, name)
            assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'ui', 'src', ui), 'utf8'), /\{\$APP_/)
            assert.ok(existsSync(path.join(project, '.dockerignore')))
            Install(project, ['@types/node', 'electron', ...names], path.join(ROOT, 'node_modules', 'typescript'))
            LinkWorkspace(project, ['ui', 'app'])
            symlinkSync(path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), path.join(project, 'node_modules', '.bin', 'vite'))
            const built = await Run(process.execPath, [CLI, 'run', 'rebuild', '--concurrency', '1'], project)
            assert.strictEqual(built.code, 0, built.output)
            assert.ok(existsSync(path.join(project, 'packages', 'app', 'build', 'preload.cjs')))
            //The actions of the main process, served to the renderer over IPC (without Electron)
            const tested = await Run(process.execPath, [CLI, 'run', 'test'], project)
            assert.strictEqual(tested.code, 0, tested.output)
            assert.match(tested.output, /pass 3/)
            //The renderer is type checked with the TypeScript of the template
            const typescript: string = path.join(ROOT, 'node_modules', 'typescript')
            const checked = template === 'electron-vue'
                ? await Run(process.execPath, ['-e', `require(${JSON.stringify(path.join(ROOT, 'node_modules', 'vue-tsc'))}).run(${JSON.stringify(path.join(typescript, 'lib', 'tsc.js'))})`, 'vue-tsc', '--noEmit', '-p', path.join(project, 'packages', 'ui')], project)
                : await Run(process.execPath, [path.join(typescript, 'bin', 'tsc'), '-p', path.join(project, 'packages', 'ui')], project)
            assert.strictEqual(checked.code, 0, checked.output)
            //The application packaged by electron-builder: the main process bundled, the preload script, the renderer
            const assembled = await Run(process.execPath, ['scripts/assemble.mjs'], project)
            assert.strictEqual(assembled.code, 0, assembled.output)
            for (const file of ['main.cjs', 'preload.cjs', 'package.json', path.join('renderer', 'index.html')]) assert.ok(existsSync(path.join(project, 'release', 'app', file)), file)
            assert.strictEqual(JSON.parse(readFileSync(path.join(project, 'release', 'app', 'package.json'), 'utf8')).main, 'main.cjs')
            //Started (where Electron can open its window): the page shows the result of the action, isolated from Node.js
            if (process.platform === 'darwin' && existsSync(path.join(ROOT, 'node_modules', 'electron', 'dist'))) {
                assert.match(await ElectronPage(project, ['release/app']), new RegExp(`Hello, ${name}! \\| isolated: true`))
            }
        })
    }
})

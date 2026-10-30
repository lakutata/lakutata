import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, type ExecFileException, execFileSync, execSync, spawn} from 'node:child_process'
import {constants, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {BUILTIN_TEMPLATES, type TemplateInfo} from '../lib/TemplateCatalog.js'
import {NO_NODE_EXECUTABLE, NODE_PROGRAM} from './support/NodeProgram.js'
import {linkCommand, runCommand} from './support/Workspace.js'

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
function runIn(command: string, args: string[], cwd: string): Promise<{ code: number, output: string }> {
    //The tests of the project run on their own, not as tests nested in the running ones
    const {NODE_TEST_CONTEXT, ...env} = process.env
    void NODE_TEST_CONTEXT
    return runCommand(command, args, cwd, {...env, LAKUTATA_CACHE_DIR: path.join(work, 'cache'), NEXT_TELEMETRY_DISABLED: '1'}, 1800000)
}

/**
 * Link a package of the repository into the node_modules of a project
 * @param project
 * @param name
 * @param target
 */
function linkPackage(project: string, name: string, target: string): void {
    const link: string = path.join(project, 'node_modules', name)
    mkdirSync(path.dirname(link), {recursive: true})
    symlinkSync(target, link, 'dir')
}

/**
 * Copy packages of the repository and the dependencies they load into a project (cloned where the file system can): the
 * builds which trace the files they load (the standalone build of next) take the ones of the project, not the ones its
 * links lead to
 * @param project
 * @param names
 */
function copyPackages(project: string, names: string[]): void {
    const copied: Set<string> = new Set()
    const copy = (name: string): void => {
        const source: string = path.join(ROOT, 'node_modules', name)
        if (copied.has(name) || !existsSync(source)) return
        copied.add(name)
        cpSync(source, path.join(project, 'node_modules', name), {recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE})
        const manifest = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>, optionalDependencies?: Record<string, string> }
        //The ones in its own node_modules are copied with it
        for (const dependency of Object.keys({...manifest.dependencies, ...manifest.optionalDependencies})) {
            if (!existsSync(path.join(source, 'node_modules', dependency))) copy(dependency)
        }
    }
    for (const name of names) copy(name)
}

/**
 * Install the dependencies of a project from the repository: the framework and the tool are its packages, the others its dependencies
 * @param project
 * @param names the third-party dependencies
 * @param typescript the directory of the TypeScript of the project, the one of the repository by default
 */
function install(project: string, names: string[], typescript: string = path.join(ROOT, 'node_modules', 'typescript')): void {
    linkPackage(project, 'lakutata', path.join(ROOT, 'packages', 'lakutata'))
    linkPackage(project, '@lakutata/cli', path.join(ROOT, 'packages', 'cli'))
    linkPackage(project, 'typescript', typescript)
    for (const name of names) linkPackage(project, name, path.join(ROOT, 'node_modules', name))
    //The commands of the scripts
    mkdirSync(path.join(project, 'node_modules', '.bin'), {recursive: true})
    linkCommand(path.join(project, 'node_modules', '.bin'), 'tsc', path.join(typescript, 'bin', 'tsc'))
    linkCommand(path.join(project, 'node_modules', '.bin'), 'lakutata', CLI)
}

/**
 * Link the packages of the workspace of a project into its node_modules, as npm does
 * @param project
 * @param names
 */
function linkWorkspace(project: string, names: string[]): void {
    for (const name of names) linkPackage(project, name, path.join(project, 'packages', name))
}

/**
 * Create a project from a template of the repository
 * @param template
 * @param name
 * @param features the features of the template enabled
 */
async function create(template: string, name: string, features: string[] = []): Promise<string> {
    const created = await runIn(process.execPath, [CLI, 'create', '--name', name, '--template', path.join(ROOT, 'packages', `template-${template}`), ...(features.length ? ['--with', features.join(',')] : []), '--package-manager', 'none', '--no-git', '--yes'], work)
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
async function electronPage(project: string, args: string[], executable?: string): Promise<string> {
    const electron: string = executable ?? createRequire(import.meta.url)(path.join(ROOT, 'node_modules', 'electron'))
    const port: number = 9300 + Math.floor(Math.random() * 500)
    const {NODE_TEST_CONTEXT, ...env} = process.env
    void NODE_TEST_CONTEXT
    const child = spawn(electron, [`--remote-debugging-port=${port}`, ...args], {cwd: project, env: env, stdio: 'ignore'})
    let text: string = ''
    try {
        //Once the page shows the result of the action and the event the main process pushed
        for (let attempt: number = 0; attempt < 60 && !/Pushed by the main process: /.test(text); attempt++) {
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
            try {
                const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as { type: string, webSocketDebuggerUrl: string }[]
                const page = pages.find(({type}): boolean => type === 'page')
                if (!page) continue
                text = await new Promise((resolve: (text: string) => void, reject: (error: unknown) => void): void => {
                    const socket: WebSocket = new WEBSOCKET(page.webSocketDebuggerUrl)
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
 * The WebSocket of the runtime (Node.js 22 and later), else the one of ws
 */
const WEBSOCKET: typeof WebSocket = globalThis.WebSocket ?? (await import('ws')).WebSocket as unknown as typeof WebSocket

/**
 * Whether Bun is installed, which makes the executables of --runtime bun
 */
const BUN: boolean = ((): boolean => {
    try {
        execSync('bun --version', {stdio: 'ignore'})
        return true
    } catch {
        return false
    }
})()

/**
 * The files under a directory, outside its node_modules: walked without the recursive option of readdirSync and the
 * parentPath of its entries (Node.js 18.17, 18.20)
 * @param directory
 */
function filesUnder(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry): string[] => {
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesUnder(path.join(directory, entry.name))
        return entry.isFile() ? [path.join(directory, entry.name)] : []
    })
}

/**
 * Make the executable of the app package of a web application in a directory, and run it from elsewhere: the page it
 * serves (its ui, a resource of the executable)
 * @param project
 */
async function serveFromExecutable(project: string, assets: (page: string) => string[] = (): string[] => [], options: string[] = ['--layout', 'directory']): Promise<string> {
    const outdir: string = `dist-${options.join('').replace(/\W+/g, '-')}`
    const made = await runIn(process.execPath, [CLI, 'package', 'exe', ...options, ...NODE_PROGRAM, '--outdir', outdir], path.join(project, 'packages', 'app'))
    assert.strictEqual(made.code, 0, made.output)
    const directory: boolean = options.includes('directory')
    assert.match(made.output, directory ? /Resources next to the executable: ui/ : /Resources embedded, extracted at the first run: ui/)
    const executable: string = path.join(project, 'packages', 'app', outdir, ...directory ? ['app'] : [], process.platform === 'win32' ? 'app.exe' : 'app')
    const port: number = 20000 + Math.floor(Math.random() * 5000)
    const child = spawn(executable, [], {cwd: tmpdir(), env: {...process.env, PORT: String(port), NODE_ENV: 'production', LAKUTATA_NATIVE_DIR: path.join(project, `${outdir}-cache`)}, stdio: 'ignore'})
    try {
        for (let attempt = 0; attempt < 200; attempt++) {
            try {
                const response: Response = await fetch(`http://127.0.0.1:${port}/`, {headers: {accept: 'text/html'}})
                if (!response.ok) continue
                const page: string = await response.text()
                //The files the page loads, served too
                for (const asset of assets(page)) {
                    const loaded: Response = await fetch(`http://127.0.0.1:${port}${asset}`)
                    assert.strictEqual(loaded.status, 200, asset)
                    assert.ok((await loaded.text()).length > 0, asset)
                }
                return page
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

    it('keeps the catalogs of the templates (the one of the registry, the one of the tool) the ones of their packages', (): void => {
        const catalog = JSON.parse(readFileSync(path.join(ROOT, 'packages', 'templates', 'package.json'), 'utf8')).lakutata.templates as TemplateInfo[]
        assert.deepStrictEqual(BUILTIN_TEMPLATES, catalog)
        for (const template of catalog) {
            const manifest = JSON.parse(readFileSync(path.join(ROOT, 'packages', `template-${template.name}`, 'package.json'), 'utf8'))
            assert.strictEqual(manifest.name, template.package)
            assert.deepStrictEqual(template.features, Object.keys(manifest.lakutata.features ?? {}), template.name)
        }
    })
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
            //The files of the features they have too
            const features: string = path.join(ROOT, 'packages', 'template-service', 'features')
            const declared: string[] = Object.keys(JSON.parse(readFileSync(path.join(ROOT, 'packages', `template-${template}`, 'package.json'), 'utf8')).lakutata.features)
            for (const file of readdirSync(features, {recursive: true, withFileTypes: true}).filter((entry): boolean => entry.isFile()).map((entry): string => path.relative(features, path.join(entry.parentPath, entry.name))).filter((file: string): boolean => declared.includes(file.split(path.sep)[0]))) {
                assert.strictEqual(readFileSync(path.join(ROOT, 'packages', `template-${template}`, 'features', file), 'utf8'), readFileSync(path.join(features, file), 'utf8'), `features/${file} of ${template} differs from the one of service`)
            }
        }
    })

    it('keeps the files the Electron templates share identical', (): void => {
        //The Electron templates differ by their renderer only
        const files = (directory: string): string[] => filesUnder(directory)
            .map((file: string): string => path.relative(directory, file))
            .filter((file: string): boolean => !file.startsWith(path.join('packages', 'ui')) && file !== 'README.md')
            .sort()
        const react: string = path.join(ROOT, 'packages', 'template-electron-react', 'template')
        const vue: string = path.join(ROOT, 'packages', 'template-electron-vue', 'template')
        assert.deepStrictEqual(files(vue), files(react))
        for (const file of files(react)) assert.strictEqual(readFileSync(path.join(vue, file), 'utf8'), readFileSync(path.join(react, file), 'utf8'), `${file} of electron-vue differs from the one of electron-react`)
        assert.strictEqual(readFileSync(path.join(vue, 'packages', 'ui', 'src', 'ipc.ts'), 'utf8'), readFileSync(path.join(react, 'packages', 'ui', 'src', 'ipc.ts'), 'utf8'))
        const [reactFeatures, vueFeatures] = [react, vue].map((directory: string): string => path.join(directory, '..', 'features'))
        assert.deepStrictEqual(files(vueFeatures), files(reactFeatures))
        for (const file of files(reactFeatures)) assert.strictEqual(readFileSync(path.join(vueFeatures, file), 'utf8'), readFileSync(path.join(reactFeatures, file), 'utf8'), `features/${file} of electron-vue differs`)
    })

    it('creates the projects with the installer feature: their installers configured, their scripts and their Dockerfile written', async (): Promise<void> => {
        //A command line tool: its program in the PATH, without service
        const tool: string = await create('cli', 'Shipper', ['installer'])
        const manifest = JSON.parse(readFileSync(path.join(tool, 'package.json'), 'utf8'))
        assert.strictEqual(manifest.scripts['package:host'], 'npm run build && npm run package -w app -- --outdir ../../dist/installer')
        assert.match(manifest.scripts['package:linux'], /^docker buildx build --file Dockerfile\.installer --output type=local,dest=dist\/installer \.$/)
        const toolApp = JSON.parse(readFileSync(path.join(tool, 'packages', 'app', 'package.json'), 'utf8'))
        assert.strictEqual(toolApp.scripts.package, 'lakutata package installer')
        assert.deepStrictEqual(toolApp.lakutata, {icon: '../resources/logo.png', installer: {linux: {targets: ['deb', 'rpm', 'tar.gz']}}})
        assert.ok(existsSync(path.join(tool, 'packages', 'resources', 'logo.png')))
        assert.ok(existsSync(path.join(tool, 'Dockerfile.installer')) && existsSync(path.join(tool, '.dockerignore')))
        assert.match(readFileSync(path.join(tool, 'Dockerfile.installer'), 'utf8'), /npm run package -w app -- --outdir \/installer/)
        const readme: string = readFileSync(path.join(tool, 'README.md'), 'utf8')
        assert.match(readme, /## The installers\n[\s\S]*the command `shipper` in the PATH/)
        assert.doesNotMatch(readme, /@if|@end/)
        //The workspaces: the app installed after the project, its service registered, its resources kept
        for (const [template, name] of [['service', 'Depot'], ['web-react', 'Kiosk'], ['web-vue', 'Booth'], ['web-nuxt', 'Stall'], ['web-next', 'Shop']] as const) {
            const project: string = await create(template, name, ['installer'])
            const id: string = name.toLowerCase()
            const root = JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8'))
            //Their installers in the dist/installer of the workspace, as the ones of Linux (package:linux)
            assert.strictEqual(root.scripts['package:host'], 'npm run build && npm run package -w app -- --outdir ../../dist/installer')
            assert.match(root.scripts['package:linux'], /^docker buildx build --file Dockerfile\.installer --output type=local,dest=dist\/installer \.$/)
            assert.strictEqual(root.devDependencies['@lakutata/builder'], root.devDependencies['@lakutata/cli'])
            const app = JSON.parse(readFileSync(path.join(project, 'packages', 'app', 'package.json'), 'utf8'))
            assert.deepStrictEqual(app.bin, {[id]: 'build/App.js'})
            assert.strictEqual(app.scripts.package, 'lakutata package installer')
            assert.deepStrictEqual(app.lakutata.installer, {name: id, service: {env: {PORT: '8080'}}, linux: {targets: ['deb', 'rpm', 'tar.gz']}})
            //The icon of the application, in its resources package
            assert.strictEqual(app.lakutata.icon, '../resources/logo.png')
            assert.ok(readFileSync(path.join(project, 'packages', 'resources', 'logo.png')).subarray(1, 4).equals(Buffer.from('PNG')))
            if (template !== 'service') assert.deepStrictEqual(app.lakutata.resources, [{from: {'web-nuxt': '../ui/.output', 'web-next': '../ui/.next/standalone'}[template as string] ?? '../ui/dist', to: 'ui'}])
            assert.match(readFileSync(path.join(project, 'Dockerfile.installer'), 'utf8'), /npm run package -w app -- --outdir \/installer/)
            assert.match(readFileSync(path.join(project, 'README.md'), 'utf8'), new RegExp(`/etc/${id}/${id}\\.env`))
        }
        //Without the feature, none of it
        const plain: string = await create('cli', 'Plain')
        assert.ok(!existsSync(path.join(plain, 'Dockerfile.installer')))
        assert.doesNotMatch(readFileSync(path.join(plain, 'README.md'), 'utf8'), /installer/)
    })

    it('creates the projects with the i18n feature: their requests answered in their languages, the messages checked and bundled', async (): Promise<void> => {
        //An HTTP application
        const demo: string = await create('default', 'Polyglot', ['i18n'])
        assert.ok(existsSync(path.join(demo, 'src', 'locales', 'zh-CN.json')))
        assert.strictEqual(JSON.parse(readFileSync(path.join(demo, 'tsconfig.json'), 'utf8')).compilerOptions.resolveJsonModule, true)
        assert.doesNotMatch(readFileSync(path.join(demo, 'src', 'config', 'Config.ts'), 'utf8'), /@if|@end/)
        install(demo, ['express', '@types/express', '@types/node'])
        const tested = await runIn('npm', ['test'], demo)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 2/)
        const checked = await runIn('npm', ['run', 'i18n:check'], demo)
        assert.strictEqual(checked.code, 0, checked.output)
        assert.match(checked.output, /2 languages \(en, zh-CN\), 0 errors, 0 warnings/)
        //A command line tool, in the language of its environment, its messages bundled
        const tool: string = await create('cli', 'Babel', ['i18n'])
        assert.ok(existsSync(path.join(tool, 'packages', 'app', 'src', 'locales', 'zh-CN.json')))
        install(tool, ['@types/node'])
        const toolBuilt = await runIn('npm', ['run', 'build'], tool)
        assert.strictEqual(toolBuilt.code, 0, toolBuilt.output)
        const toolTested = await runIn('npm', ['test'], tool)
        assert.strictEqual(toolTested.code, 0, toolTested.output)
        assert.match(toolTested.output, /pass 5/)
        const toolBundled = await runIn('npm', ['run', 'package:bundle'], tool)
        assert.strictEqual(toolBundled.code, 0, toolBundled.output)
        const bundled = await new Promise<string>((resolve: (output: string) => void): void => {
            execFile(process.execPath, [path.join(tool, 'dist', 'babel.cjs'), 'greet', '--name', 'bundle'], {cwd: work, env: {...process.env, LC_ALL: 'zh_CN.UTF-8'}}, (error: ExecFileException | null, stdout: string): void => resolve(stdout.trim()))
        })
        assert.strictEqual(bundled, '你好，bundle！')
        //A service, its validation errors in the language of the request
        const service: string = await create('service', 'Tower', ['i18n'])
        install(service, ['express', 'compression', '@types/express', '@types/compression', '@types/node'])
        const serviceBuilt = await runIn(process.execPath, [CLI, 'run', 'rebuild'], service)
        assert.strictEqual(serviceBuilt.code, 0, serviceBuilt.output)
        const serviceTested = await runIn(process.execPath, [CLI, 'run', 'test'], service)
        assert.strictEqual(serviceTested.code, 0, serviceTested.output)
        assert.match(serviceTested.output, /pass 4/)
        //An Electron application, its actions in the language of the environment
        const desktop: string = await create('electron-vue', 'Lingo', ['i18n'])
        install(desktop, ['@types/node', 'electron', 'vite', '@vitejs/plugin-vue', 'vue'])
        linkWorkspace(desktop, ['ui', 'app'])
        linkCommand(path.join(desktop, 'node_modules', '.bin'), 'vite', path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'))
        const desktopBuilt = await runIn(process.execPath, [CLI, 'run', 'rebuild', '--concurrency', '1'], desktop)
        assert.strictEqual(desktopBuilt.code, 0, desktopBuilt.output)
        const desktopTested = await runIn(process.execPath, [CLI, 'run', 'test'], desktop)
        assert.strictEqual(desktopTested.code, 0, desktopTested.output)
        assert.match(desktopTested.output, /pass 6/)
    })

    it('creates a project from the default template which builds and passes its tests with the framework of the repository', async (): Promise<void> => {
        const project: string = await create('default', 'Demo')
        assert.doesNotMatch(readFileSync(path.join(project, 'src', 'config', 'Config.ts'), 'utf8'), /\{\$APP_/)
        //The dependencies of the project are the packages of the repository
        linkPackage(project, 'lakutata', path.join(ROOT, 'packages', 'lakutata'))
        for (const name of ['express', '@types/express', '@types/node']) linkPackage(project, name, path.join(ROOT, 'node_modules', name))
        const built = await runIn(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', project], project)
        assert.strictEqual(built.code, 0, built.output)
        const tested = await runIn(process.execPath, ['--test', 'build/tests/App.spec.js'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 1/)
    })

    it('creates a command line tool which passes its tests, and is built into an executable and bundled', async (): Promise<void> => {
        const project: string = await create('cli', 'Greeter')
        //A workspace: the tool is its app package
        assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'app', 'src', 'config', 'Config.ts'), 'utf8'), /\{\$APP_/)
        assert.strictEqual(JSON.parse(readFileSync(path.join(project, 'packages', 'app', 'package.json'), 'utf8')).bin.greeter, 'build/App.js')
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8')).workspaces, ['packages/*'])
        install(project, ['@types/node'])
        //npm test builds the packages first: run on a project just created, it runs their tests
        const tested = await runIn('npm', ['test'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 4/)
        //The bundle and the executable have the dependencies and the version of the tool
        const bundled = await runIn('npm', ['run', 'package:bundle'], project)
        assert.strictEqual(bundled.code, 0, bundled.output)
        const bundle = await runIn(process.execPath, [path.join(project, 'dist', 'greeter.cjs'), 'greet', '--name', 'bundle'], work)
        assert.strictEqual(bundle.output.trim(), 'Hello, bundle!')
        const made = await runIn('npm', ['run', 'package:exe', ...NODE_PROGRAM.length ? ['--', ...NODE_PROGRAM] : []], project)
        assert.strictEqual(made.code, 0, made.output)
        const executable: string = path.join(project, 'dist', process.platform === 'win32' ? 'greeter.exe' : 'greeter')
        assert.strictEqual((await runIn(executable, ['greet', '--name', 'executable', '--loud'], work)).output.trim(), 'HELLO, EXECUTABLE!')
        assert.strictEqual((await runIn(executable, ['--version'], work)).output.trim(), '0.0.1')
    })

    it('creates a service whose workspace builds and passes its tests', async (): Promise<void> => {
        const project: string = await create('service', 'Orders')
        assert.ok(existsSync(path.join(project, '.dockerignore')))
        assert.ok(existsSync(path.join(project, 'Dockerfile')))
        assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'app', 'src', 'config', 'Config.ts'), 'utf8'), /\{\$APP_/)
        install(project, ['express', 'compression', '@types/express', '@types/compression', '@types/node'])
        //The scripts of the workspace: its packages built in order, then tested
        const built = await runIn(process.execPath, [CLI, 'run', 'rebuild'], project)
        assert.strictEqual(built.code, 0, built.output)
        const tested = await runIn(process.execPath, [CLI, 'run', 'test'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 3/)
        //The migrations of a database of the service, generated by its script, compiled with the service
        linkPackage(project, 'better-sqlite3', path.join(ROOT, 'node_modules', 'better-sqlite3'))
        const config: string = path.join(project, 'packages', 'app', 'src', 'config', 'Config.ts')
        writeFileSync(config, readFileSync(config, 'utf8')
            .replace('import compression from \'compression\'\n', 'import compression from \'compression\'\nimport {buildDatabaseOptions} from \'lakutata/com/database\'\nimport {EntitySchema} from \'lakutata/orm\'\n\nconst Order = new EntitySchema({name: \'order\', columns: {id: {type: \'uuid\', primary: true, generated: \'uuid\'}, total: {type: Number}}})\n')
            .replace('        components: {\n', '        components: {\n            db: buildDatabaseOptions({type: \'better-sqlite3\', database: \'orders.db\', entities: [Order]}),\n'))
        const generated = await runIn('npm', ['run', 'migration:generate'], project)
        assert.strictEqual(generated.code, 0, generated.output)
        const migrations: string[] = readdirSync(path.join(project, 'packages', 'app', 'src', 'migrations'))
        assert.strictEqual(migrations.length, 1, generated.output)
        assert.match(migrations[0], /^\d+-db\.ts$/)
        assert.match(generated.output, /Migrations generated: packages[\\/]app[\\/]src[\\/]migrations[\\/]\d+-db\.ts/)
        assert.match(readFileSync(path.join(project, 'packages', 'app', 'src', 'migrations', migrations[0]), 'utf8'), /CREATE TABLE "order"/)
        //The migration given to the options of the database: shown, run, reverted by the scripts of the workspace
        const timestamp: string = migrations[0].split('-')[0]
        writeFileSync(config, readFileSync(config, 'utf8')
            .replace('import {EntitySchema} from \'lakutata/orm\'\n', `import {EntitySchema} from 'lakutata/orm'\nimport {Migrations${timestamp}} from '../migrations/${timestamp}-db.js'\n`)
            .replace('entities: [Order]})', `entities: [Order], migrations: [Migrations${timestamp}]})`))
        const shown = await runIn('npm', ['run', 'migration:show'], project)
        assert.strictEqual(shown.code, 0, shown.output)
        assert.match(shown.output, new RegExp(`\\[db\\] \\[ \\] Migrations${timestamp}\\n\\[db\\] 1 pending migration`))
        const ran = await runIn('npm', ['run', 'migration:run'], project)
        assert.strictEqual(ran.code, 0, ran.output)
        assert.match(ran.output, new RegExp(`\\[db\\] Migration Migrations${timestamp} has been run`))
        assert.match((await runIn('npm', ['run', 'migration:show'], project)).output, new RegExp(`\\[X\\] Migrations${timestamp}\\n\\[db\\] No pending migration`))
        const reverted = await runIn('npm', ['run', 'migration:revert'], project)
        assert.strictEqual(reverted.code, 0, reverted.output)
        assert.match(reverted.output, new RegExp(`\\[db\\] Migration Migrations${timestamp} has been reverted`))
        //An empty migration, compiled with the service
        const created = await runIn('npm', ['run', 'migration:create', '--', 'seed-orders'], project)
        assert.strictEqual(created.code, 0, created.output)
        assert.match(created.output, /Migration created: packages[\\/]app[\\/]src[\\/]migrations[\\/]\d+-seed-orders\.ts/)
        const rebuilt = await runIn(process.execPath, [CLI, 'run', 'rebuild'], project)
        assert.strictEqual(rebuilt.code, 0, rebuilt.output)
        const compiled: string[] = readdirSync(path.join(project, 'packages', 'app', 'build', 'migrations'))
        assert.ok(compiled.includes(migrations[0].replace(/\.ts$/, '.js')))
        assert.ok(compiled.some((file: string): boolean => /^\d+-seed-orders\.js$/.test(file)))
    })

    it('creates a React web application whose workspace builds the ui then the app, which serves it', {skip: NO_NODE_EXECUTABLE}, async (): Promise<void> => {
        const project: string = await create('web-react', 'Portal')
        assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'ui', 'src', 'App.tsx'), 'utf8'), /\{\$APP_/)
        install(project, ['express', 'compression', '@types/express', '@types/compression', '@types/node', 'vite', '@vitejs/plugin-react', 'react', 'react-dom', '@types/react', '@types/react-dom'])
        linkWorkspace(project, ['ui'])
        linkCommand(path.join(project, 'node_modules', '.bin'), 'vite', path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'))
        const built = await runIn(process.execPath, [CLI, 'run', 'rebuild', '--concurrency', '1'], project)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(project, 'packages', 'ui', 'dist', 'index.html')))
        //ui is built before app, which depends on it
        assert.ok(built.output.indexOf('ui ') < built.output.indexOf('app '), built.output)
        const tested = await runIn(process.execPath, [CLI, 'run', 'test'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 4/)
        //The ui is type checked with the TypeScript of the template (vite does not check the types)
        const checked = await runIn(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(project, 'packages', 'ui')], project)
        assert.strictEqual(checked.code, 0, checked.output)
        //Packed into an executable, it serves its ui from its resources
        const page: string = await serveFromExecutable(project)
        assert.strictEqual(page, readFileSync(path.join(project, 'packages', 'ui', 'dist', 'index.html'), 'utf8'))
    })

    it('creates a Next.js web application whose workspace builds the ui then the app, which renders its pages', {skip: NO_NODE_EXECUTABLE}, async (): Promise<void> => {
        const project: string = await create('web-next', 'Console')
        assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'ui', 'app', 'page.tsx'), 'utf8'), /\{\$APP_/)
        install(project, ['express', 'compression', '@types/express', '@types/compression', '@types/node', '@types/react', '@types/react-dom'], path.join(ROOT, 'node_modules', 'typescript'))
        //In the project, as installed: the standalone build has next and what it loads
        copyPackages(project, ['next', 'react', 'react-dom'])
        linkWorkspace(project, ['ui'])
        linkCommand(path.join(project, 'node_modules', '.bin'), 'next', path.join(project, 'node_modules', 'next', 'dist', 'bin', 'next'))
        //The root of the project is the one of the workspace: the project has no lock file, which next finds it by (its real
        //path, the one next compares)
        const nextConfig: string = path.join(project, 'packages', 'ui', 'next.config.ts')
        const root: string = JSON.stringify(realpathSync(project))
        writeFileSync(nextConfig, readFileSync(nextConfig, 'utf8').replace(`{output: 'standalone'}`, `{output: 'standalone', outputFileTracingRoot: ${root}, turbopack: {root: ${root}}}`))
        const built = await runIn(process.execPath, [CLI, 'run', 'rebuild', '--concurrency', '1'], project)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(project, 'packages', 'ui', '.next')))
        assert.ok(existsSync(path.join(project, 'packages', 'ui', 'server', 'build', 'index.js')))
        //The standalone build, completed: its application is the one of the workspace
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(project, 'packages', 'ui', '.next', 'standalone', 'ui.json'), 'utf8')), {dir: path.join('packages', 'ui')})
        assert.ok(existsSync(path.join(project, 'packages', 'ui', '.next', 'standalone', 'packages', 'ui', '.next', 'static')))
        assert.ok(existsSync(path.join(project, 'packages', 'ui', '.next', 'standalone', 'node_modules', 'next', 'package.json')))
        const tested = await runIn(process.execPath, [CLI, 'run', 'test'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 4/)
        //Packed into an executable (in a directory, in one file, of Bun), it renders its pages by the standalone build of
        //its resources, and serves their files
        const scripts = (html: string): string[] => [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((matched: RegExpMatchArray): string => matched[1])
        for (const options of [['--layout', 'directory'], [], ...BUN ? [['--runtime', 'bun']] : []]) {
            const page: string = await serveFromExecutable(project, scripts, options)
            assert.match(page, /<title>Console<\/title>/, options.join(' '))
            assert.ok(scripts(page).length, page)
        }
    })
    it('creates a Vue web application whose workspace builds the ui then the app, which serves it', {skip: NO_NODE_EXECUTABLE}, async (): Promise<void> => {
        const project: string = await create('web-vue', 'Studio')
        assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'ui', 'src', 'App.vue'), 'utf8'), /\{\$APP_/)
        install(project, ['express', 'compression', '@types/express', '@types/compression', '@types/node', 'vite', '@vitejs/plugin-vue', 'vue'])
        linkWorkspace(project, ['ui'])
        linkCommand(path.join(project, 'node_modules', '.bin'), 'vite', path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'))
        const built = await runIn(process.execPath, [CLI, 'run', 'rebuild', '--concurrency', '1'], project)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(project, 'packages', 'ui', 'dist', 'index.html')))
        const tested = await runIn(process.execPath, [CLI, 'run', 'test'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 4/)
        //The ui is type checked by vue-tsc (vite does not check the types), with the TypeScript of the template
        const vueTsc: string = `require(${JSON.stringify(path.join(ROOT, 'node_modules', 'vue-tsc'))}).run(${JSON.stringify(path.join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js'))})`
        const checked = await runIn(process.execPath, ['-e', vueTsc, 'vue-tsc', '--noEmit', '-p', path.join(project, 'packages', 'ui')], project)
        assert.strictEqual(checked.code, 0, checked.output)
        //Packed into an executable, it serves its ui from its resources
        const page: string = await serveFromExecutable(project)
        assert.strictEqual(page, readFileSync(path.join(project, 'packages', 'ui', 'dist', 'index.html'), 'utf8'))
    })

    it('creates a Nuxt web application whose workspace builds the ui then the app, which renders its pages', {skip: NO_NODE_EXECUTABLE}, async (): Promise<void> => {
        const project: string = await create('web-nuxt', 'Board')
        assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'ui', 'app', 'app.vue'), 'utf8'), /\{\$APP_/)
        install(project, ['express', 'compression', '@types/express', '@types/compression', '@types/node', 'nuxt', 'vue'])
        linkWorkspace(project, ['ui'])
        linkCommand(path.join(project, 'node_modules', '.bin'), 'nuxt', path.join(ROOT, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs'))
        const built = await runIn(process.execPath, [CLI, 'run', 'rebuild', '--concurrency', '1'], project)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(project, 'packages', 'ui', '.output', 'server', 'index.mjs')))
        const tested = await runIn(process.execPath, [CLI, 'run', 'test'], project)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 4/)
        //Packed into an executable (in a directory, in one file, of Bun), it renders its pages by the build of Nitro of its
        //resources, and serves their files
        const scripts = (html: string): string[] => [...html.matchAll(/src="(\/_nuxt\/[^"]+\.js)"/g)].map((matched: RegExpMatchArray): string => matched[1])
        for (const options of [['--layout', 'directory'], [], ...BUN ? [['--runtime', 'bun']] : []]) {
            const page: string = await serveFromExecutable(project, scripts, options)
            assert.match(page, /<h1>Board<\/h1>/, options.join(' '))
            assert.match(page, /data-ssr="true"/)
            assert.ok(scripts(page).length, page)
        }
        //The ui is type checked as nuxt typecheck does, with the TypeScript of the template
        const vueTsc: string = `require(${JSON.stringify(path.join(ROOT, 'node_modules', 'vue-tsc'))}).run(${JSON.stringify(path.join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js'))})`
        const checked = await runIn(process.execPath, ['-e', vueTsc, 'vue-tsc', '-b', '--noEmit'], path.join(project, 'packages', 'ui'))
        assert.strictEqual(checked.code, 0, checked.output)
    })

    for (const [template, name, ui, names] of [
        ['electron-react', 'Desk', 'App.tsx', ['vite', '@vitejs/plugin-react', 'react', 'react-dom', '@types/react', '@types/react-dom']],
        ['electron-vue', 'Pad', 'App.vue', ['vite', '@vitejs/plugin-vue', 'vue']]
    ] as [string, string, string, string[]][]) {
        it(`creates an Electron application (${template}) whose main process serves its renderer over IPC, and packages it`, async (): Promise<void> => {
            const project: string = await create(template, name)
            assert.doesNotMatch(readFileSync(path.join(project, 'packages', 'ui', 'src', ui), 'utf8'), /\{\$APP_/)
            assert.ok(existsSync(path.join(project, '.dockerignore')))
            install(project, ['@types/node', 'electron', 'electron-builder', ...names], path.join(ROOT, 'node_modules', 'typescript'))
            linkWorkspace(project, ['ui', 'app'])
            linkCommand(path.join(project, 'node_modules', '.bin'), 'vite', path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'))
            const built = await runIn(process.execPath, [CLI, 'run', 'rebuild', '--concurrency', '1'], project)
            assert.strictEqual(built.code, 0, built.output)
            assert.ok(existsSync(path.join(project, 'packages', 'app', 'build', 'preload.cjs')))
            //The actions of the main process, served to the renderer over IPC (without Electron)
            const tested = await runIn(process.execPath, [CLI, 'run', 'test'], project)
            assert.strictEqual(tested.code, 0, tested.output)
            assert.match(tested.output, /pass 5/)
            //The renderer is type checked with the TypeScript of the template
            const typescript: string = path.join(ROOT, 'node_modules', 'typescript')
            const checked = template === 'electron-vue'
                ? await runIn(process.execPath, ['-e', `require(${JSON.stringify(path.join(ROOT, 'node_modules', 'vue-tsc'))}).run(${JSON.stringify(path.join(typescript, 'lib', 'tsc.js'))})`, 'vue-tsc', '--noEmit', '-p', path.join(project, 'packages', 'ui')], project)
                : await runIn(process.execPath, [path.join(typescript, 'bin', 'tsc'), '-p', path.join(project, 'packages', 'ui')], project)
            assert.strictEqual(checked.code, 0, checked.output)
            //Packaged by lakutata package installer (electron-builder, unpacked): the main process bundled in its archive, the
            //preload script and the renderer in its resources
            //By the installer script of the workspace: in its dist/installer
            const packaged = await runIn('npm', ['run', 'package:host', '--', '--target', 'dir'], project)
            assert.strictEqual(packaged.code, 0, packaged.output)
            assert.match(packaged.output, /Electron v\d+/)
            const asar: string | undefined = filesUnder(path.join(project, 'dist', 'installer')).find((file: string): boolean => path.basename(file) === 'app.asar')
            assert.ok(asar, 'app.asar')
            const archive: string = path.dirname(asar)
            for (const file of ['preload.cjs', path.join('renderer', 'index.html'), 'logo.png']) assert.ok(existsSync(path.join(archive, 'main.resources', file)), file)
            //The icon of the application, made from the one of its resources package
            if (process.platform === 'darwin') {
                assert.strictEqual(execFileSync('plutil', ['-extract', 'CFBundleIconFile', 'raw', path.join(archive, '..', 'Info.plist')]).toString().trim(), 'icon.icns')
                const iconset: string = path.join(project, 'icon.iconset')
                execFileSync('iconutil', ['-c', 'iconset', path.join(archive, 'icon.icns'), '-o', iconset])
                assert.ok(existsSync(path.join(iconset, 'icon_512x512.png')))
            }
            //Started (where Electron can open its window): the page shows the result of the action, isolated from Node.js
            if (process.platform === 'darwin') {
                const bundle: string = path.resolve(archive, '..', '..')
                const executable: string = path.join(bundle, 'Contents', 'MacOS', readdirSync(path.join(bundle, 'Contents', 'MacOS'))[0])
                assert.match(await electronPage(project, [], executable), new RegExp(`Hello, ${name}!\\s+Pushed by the main process: ${name} \\| isolated: true`))
            }
        })
    }
})

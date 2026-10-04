// Installed-consumer check: the packages are packed (npm pack) and unpacked into the node_modules of temporary
// projects, as npm installs them, and the projects are compiled with tsc. It verifies what the in-repository checks
// cannot see: the published files only, the tsconfig.json exported to the applications, and the types seen by the
// ESM and the CommonJS applications.
// Run: node consumer-fixture/installed-consumer.mjs (after the build)

import {execFileSync, spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const work = mkdtempSync(path.join(tmpdir(), 'lakutata-installed-'))
const failures = []

/**
 * The packages of the repository installed with lakutata
 */
const PACKAGES = ['core', 'logger', 'entrypoint', 'cache', 'mutex', 'grpc', 'containerd', 'docker', 'orm', 'monitor', 'utils', 'security', 'lakutata']

/**
 * Pack the packages once
 */
const packs = path.join(work, 'packs')
mkdirSync(packs)
const tarballs = new Map(PACKAGES.map(name => {
    const output = execFileSync('npm', ['pack', '--silent', '--pack-destination', packs], {cwd: path.join(ROOT, 'packages', name)}).toString().trim().split('\n').at(-1)
    return [name, path.join(packs, output)]
}))

/**
 * A project with the packed packages in its node_modules, and the other dependencies of the repository
 * @param name
 * @param packageJson
 * @param tsconfig
 * @param source
 */
function Project(name, packageJson, tsconfig, source) {
    const project = path.join(work, name)
    const modules = path.join(project, 'node_modules')
    mkdirSync(path.join(project, 'src'), {recursive: true})
    for (const [pkg, tarball] of tarballs) {
        const target = path.join(modules, pkg === 'lakutata' ? 'lakutata' : `@lakutata/${pkg}`)
        mkdirSync(target, {recursive: true})
        execFileSync('tar', ['-xzf', tarball, '-C', target, '--strip-components=1'])
    }
    //The third-party dependencies are the ones of the repository
    for (const entry of readdirSync(path.join(ROOT, 'node_modules'))) {
        if (entry === 'lakutata' || entry === '@lakutata' || entry.startsWith('.')) continue
        const scoped = entry.startsWith('@')
        for (const name of scoped ? readdirSync(path.join(ROOT, 'node_modules', entry)).map(child => `${entry}/${child}`) : [entry]) {
            mkdirSync(path.dirname(path.join(modules, name)), {recursive: true})
            try {
                symlinkSync(path.join(ROOT, 'node_modules', name), path.join(modules, name))
            } catch {
                //Already linked
            }
        }
    }
    writeFileSync(path.join(project, 'package.json'), JSON.stringify(packageJson, null, 2))
    writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2))
    writeFileSync(path.join(project, 'src', 'App.ts'), source)
    return project
}

/**
 * Check something
 * @param name
 * @param fn
 */
function Check(name, fn) {
    try {
        fn()
        console.log('  ok  ' + name)
    } catch (error) {
        const message = (error.stdout?.toString() || error.message).trim().split('\n').slice(0, 6).join('\n        ')
        failures.push(`${name}: ${message}`)
        console.log(' FAIL  ' + name + '\n        ' + message)
    }
}

/**
 * An application using the framework
 */
const SOURCE = `import {Application, DTO} from 'lakutata'
import type {ILogger} from 'lakutata'
import {Controller, BuildEntrypoints} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {Inject} from 'lakutata/decorator/di'
import {Component} from '@lakutata/core'

class NameDTO extends DTO {
    @Expect(DTO.String().required())
    public name: string
}

class Greeter extends Component {
    public greet(name: string): string {
        return 'Hello ' + name
    }
}

class GreetController extends Controller {
    @Inject('greeter')
    protected readonly greeter: Greeter

    @GET('/greet', NameDTO)
    public async greet(input: NameDTO): Promise<string> {
        return this.greeter.greet(input.name)
    }
}

Application.run({
    id: 'installed.app',
    name: 'Installed',
    components: {greeter: {class: Greeter}, entrypoint: BuildEntrypoints({controllers: [GreetController]})}
}).onLaunched((app: Application, log: ILogger): void => {
    log.info(app.appName)
    app.exit(0)
})
`

/**
 * The compiler options of a project extending the exported configuration
 */
const EXTENDED = {extends: 'lakutata/tsconfig.json', compilerOptions: {rootDir: 'src', outDir: 'build'}, include: ['src']}

Check('the exported tsconfig.json has no path of the framework', () => {
    const project = Project('show-config', {name: 'show-config', private: true}, {extends: 'lakutata/tsconfig.json'}, 'export {}\n')
    const config = JSON.parse(execFileSync(process.execPath, [TSC, '--showConfig'], {cwd: project}).toString()).compilerOptions
    for (const option of ['rootDir', 'outDir', 'baseUrl', 'paths']) if (option in config) throw new Error(`The exported configuration sets ${option}: ${JSON.stringify(config[option])}`)
    if (!config.experimentalDecorators || !config.emitDecoratorMetadata) throw new Error('The exported configuration does not enable the decorators and their metadata')
    //The options of 2.x: the declarations of an application's build are imported by its SDKs and UIs
    for (const option of ['declaration', 'allowJs', 'isolatedModules']) if (config[option] !== true) throw new Error(`The exported configuration does not set ${option}`)
})

/**
 * Compile an application and run it: it launches (its onLaunched handler logs its name), then it is stopped
 * @param project
 */
function CompileAndRun(project) {
    execFileSync(process.execPath, [TSC, '-p', project], {cwd: project})
    const run = spawnSync(process.execPath, ['build/App.js'], {cwd: project, timeout: 8000, killSignal: 'SIGKILL'})
    const output = `${run.stdout}${run.stderr}`
    if (!/Installed/.test(output)) throw new Error(`The application did not launch:\n${output}`)
}

Check('an ESM application extending lakutata/tsconfig.json compiles and runs', () => {
    CompileAndRun(Project('esm', {name: 'esm-app', private: true, type: 'module'}, EXTENDED, SOURCE))
})

Check('an ESM application extending lakutata/tsconfig.json imports JSON (with its import attributes)', () => {
    const source = `import {Application} from 'lakutata'
import type {ILogger} from 'lakutata'
import messages from './messages.json' with {type: 'json'}

Application.run({id: 'installed.json', name: messages.name}).onLaunched((app: Application, log: ILogger): void => {
    log.info(app.appName)
    app.exit(0)
})
`
    const project = Project('esm-json', {name: 'esm-json-app', private: true, type: 'module'}, EXTENDED, source)
    writeFileSync(path.join(project, 'src', 'messages.json'), JSON.stringify({name: 'Installed'}))
    CompileAndRun(project)
})

Check('a CommonJS application extending lakutata/tsconfig.json compiles and runs', () => {
    CompileAndRun(Project('cjs', {name: 'cjs-app', private: true}, EXTENDED, SOURCE))
})

rmSync(work, {recursive: true, force: true})
if (failures.length) {
    console.error('\nINSTALLED-CONSUMER FAILURES (' + failures.length + ')')
    process.exit(1)
}
console.log('\nThe installed packages compile in the ESM and the CommonJS applications.')

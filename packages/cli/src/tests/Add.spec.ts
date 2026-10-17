import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {CLI, runIn, TOOLCHAINS, visualCpp, workspace} from './support/Workspace.js'

let work: string

describe('lakutata add', (): void => {
    before((): void => {
        //The real path: gyp computes the paths of the dependencies relative to it (/var is a link to /private/var on macOS)
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-add-')))
    })

    after((): void => rmSync(work, {recursive: true, force: true}))

    it('adds a TypeScript package of the version of the workspace, a dependency of a package, which builds and passes its tests', async (): Promise<void> => {
        const root: string = workspace(work, 'library')
        const added = await runIn(process.execPath, [CLI, 'add', 'greeting', '--to', 'app'], root)
        assert.strictEqual(added.code, 0, added.output)
        assert.match(added.output, /Package greeting 1\.2\.3 added: packages[\\/]greeting/)
        assert.match(added.output, /a dependency of app/)
        const manifest = JSON.parse(readFileSync(path.join(root, 'packages', 'greeting', 'package.json'), 'utf8'))
        assert.strictEqual(manifest.version, '1.2.3')
        assert.strictEqual(manifest.scripts.clean, 'lakutata clean')
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(root, 'packages', 'app', 'package.json'), 'utf8')).dependencies, {lakutata: '^3.0.0', greeting: '^1.2.3'})
        const directory: string = path.join(root, 'packages', 'greeting')
        const built = await runIn('npm', ['run', 'rebuild'], directory)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(directory, 'build', 'index.d.ts')))
        const tested = await runIn('npm', ['test'], directory)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 1/)
    })

    for (const build of ['gyp', 'cmake', 'rust']) {
        it(`adds a native addon built by ${build}, called from its TypeScript, its errors thrown in JavaScript, bundled with an application`, {skip: TOOLCHAINS[build] ? false : `no toolchain of ${build}`}, async (): Promise<void> => {
            const root: string = workspace(work, `native-${build}`)
            const added = await runIn(process.execPath, [CLI, 'add', '@acme/capture', ...(build === 'gyp' ? ['--native'] : ['--native', build]), '--to', 'app'], root)
            assert.strictEqual(added.code, 0, added.output)
            assert.match(added.output, new RegExp(`Native addon \\(${build}\\) @acme/capture 1\\.2\\.3 added: packages[\\\\/]capture`))
            const directory: string = path.join(root, 'packages', 'capture')
            const buildFiles: Record<string, string[]> = {gyp: ['binding.gyp', 'cpp/binding.cc'], cmake: ['CMakeLists.txt', 'cpp/binding.cc'], rust: ['Cargo.toml', 'build.rs', 'rust/lib.rs']}
            for (const file of [...buildFiles[build], 'src/index.ts', 'src/tests/index.spec.ts', 'tsconfig.json', 'README.md']) assert.ok(existsSync(path.join(directory, file)), file)
            const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
            assert.strictEqual(manifest.gypfile, build === 'gyp' ? true : undefined)
            const built = await runIn('npm', ['run', 'rebuild'], directory)
            assert.strictEqual(built.code, 0, built.output)
            const addon: string = path.join(directory, 'build', 'Release', 'capture.node')
            assert.ok(existsSync(addon), built.output)
            //One addon for the Macs with Intel and with Apple silicon (the C++ builds)
            if (process.platform === 'darwin' && build !== 'rust') assert.deepStrictEqual(execFileSync('lipo', ['-archs', addon], {encoding: 'utf8'}).trim().split(' ').sort(), ['arm64', 'x86_64'])
            const tested = await runIn('npm', ['test'], directory)
            assert.strictEqual(tested.code, 0, tested.output)
            assert.match(tested.output, /pass 2/)
            //The TypeScript is cleaned without the addon
            assert.strictEqual((await runIn('npm', ['run', 'clean'], directory)).code, 0)
            assert.ok(!existsSync(path.join(directory, 'dist')) && existsSync(addon))
            assert.strictEqual((await runIn('npm', ['run', 'build'], directory)).code, 0)

            //An application using the addon is bundled with it, and runs elsewhere
            mkdirSync(path.join(root, 'node_modules', '@acme'))
            symlinkSync(directory, path.join(root, 'node_modules', '@acme', 'capture'), 'dir')
            const app: string = path.join(root, 'packages', 'app')
            mkdirSync(path.join(app, 'build'))
            writeFileSync(path.join(app, 'build', 'App.js'), 'import {greet} from \'@acme/capture\'\nconsole.log(greet(\'bundle\'))\n')
            const bundled = await runIn(process.execPath, [CLI, 'package', 'bundle'], app)
            assert.strictEqual(bundled.code, 0, bundled.output)
            assert.match(bundled.output, /the native addons \(@acme\/capture\)/)
            //The addon is shipped, not what built it (the files of node-gyp and of CMake, the target of cargo)
            const shipped: string = path.join(app, 'dist', 'app.native', 'node_modules', '@acme', 'capture')
            assert.ok(existsSync(path.join(shipped, 'build', 'Release', 'capture.node')))
            for (const file of ['target', 'build/Makefile', 'build/CMakeFiles', 'build/CMakeCache.txt', 'build/Release/obj.target']) assert.ok(!existsSync(path.join(shipped, file)), file)
            const ran = await runIn(process.execPath, [path.join(app, 'dist', 'app.cjs')], tmpdir())
            assert.strictEqual(ran.code, 0, ran.output)
            assert.match(ran.output, /Hello, bundle \(native\)/)
        })
    }

    it('links a dynamic library shipped with a gyp addon as its comments show, found next to it once bundled', {skip: TOOLCHAINS.gyp ? false : 'no C++ toolchain'}, async (): Promise<void> => {
        const root: string = workspace(work, 'dynamic')
        assert.strictEqual((await runIn(process.execPath, [CLI, 'add', 'suffixed', '--native'], root)).code, 0)
        const directory: string = path.join(root, 'packages', 'suffixed')
        //The dynamic library of the package, found through the rpath of the addons (next to them on Windows)
        const windows: boolean = process.platform === 'win32'
        const library: string = process.platform === 'darwin' ? 'libsuffix.dylib' : windows ? 'suffix.dll' : 'libsuffix.so'
        const lib: string = path.join(directory, 'deps', 'lib')
        mkdirSync(lib, {recursive: true})
        writeFileSync(path.join(directory, 'deps', 'suffix.cc'), `extern "C" ${windows ? '__declspec(dllexport) ' : ''}const char *suffix() { return " (from a dynamic library)"; }\n`)
        if (windows) {
            //The DLL and its import library
            visualCpp([`cl /nologo /LD /Fe"${path.join(lib, library)}" "${path.join(directory, 'deps', 'suffix.cc')}" /link /IMPLIB:"${path.join(lib, 'suffix.lib')}"`])
        } else {
            execFileSync('c++', process.platform === 'darwin'
                ? ['-dynamiclib', '-arch', 'x86_64', '-arch', 'arm64', '-install_name', `@rpath/${library}`, '-o', path.join(lib, library), path.join(directory, 'deps', 'suffix.cc')]
                : ['-shared', '-fPIC', '-o', path.join(lib, library), path.join(directory, 'deps', 'suffix.cc')])
        }
        //The examples of binding.gyp, uncommented
        const gyp: string = readFileSync(path.join(directory, 'binding.gyp'), 'utf8')
        const uncommented: string = windows ? gyp
            .replace("            # A DLL shipped with the addon (deps/lib/foo.dll): its import library '<(module_root_dir)/deps/lib/foo.lib',\n", "            '<(module_root_dir)/deps/lib/suffix.lib',\n")
            .replace("          # 'copies': [{'destination': '<(PRODUCT_DIR)', 'files': ['<(module_root_dir)/deps/lib/foo.dll']}]", `          'copies': [{'destination': '<(PRODUCT_DIR)', 'files': ['<(module_root_dir)/deps/lib/${library}']}]`) : gyp
            .replace("      'libraries': [\n", "      'libraries': [\n        '-L<(module_root_dir)/deps/lib', '-lsuffix',\n")
            .replace("      # 'copies': [{'destination': '<(PRODUCT_DIR)', 'files': ['<(module_root_dir)/deps/lib/libfoo.so']}],", `      'copies': [{'destination': '<(PRODUCT_DIR)', 'files': ['<(module_root_dir)/deps/lib/${library}']}],`)
            .replace("              '-arch x86_64', '-arch arm64',\n", "              '-arch x86_64', '-arch arm64',\n              '-Wl,-rpath,@loader_path',\n")
            .replace("          'ldflags': [\n", (): string => "          'ldflags': [\n            \"-Wl,-rpath,'$$ORIGIN'\",\n")
        assert.notStrictEqual(uncommented, gyp)
        writeFileSync(path.join(directory, 'binding.gyp'), uncommented)
        const cpp: string = readFileSync(path.join(directory, 'cpp', 'binding.cc'), 'utf8')
        writeFileSync(path.join(directory, 'cpp', 'binding.cc'), cpp
            .replace('#include <napi.h>\n', '#include <napi.h>\n\nextern "C" const char *suffix();\n')
            .replace('+ " (native)")', '+ suffix())'))
        const built = await runIn('npm', ['run', 'rebuild'], directory)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(directory, 'build', 'Release', library)))
        //Bundled with the application: the addon finds its library next to it, elsewhere
        symlinkSync(directory, path.join(root, 'node_modules', 'suffixed'), 'dir')
        const app: string = path.join(root, 'packages', 'app')
        mkdirSync(path.join(app, 'build'))
        writeFileSync(path.join(app, 'build', 'App.js'), 'import {greet} from \'suffixed\'\nconsole.log(greet(\'bundle\'))\n')
        const bundled = await runIn(process.execPath, [CLI, 'package', 'bundle'], app)
        assert.strictEqual(bundled.code, 0, bundled.output)
        //The library of the package moved away: the bundle has its own
        rmSync(path.join(directory, 'deps'), {recursive: true})
        rmSync(path.join(directory, 'build'), {recursive: true})
        const ran = await runIn(process.execPath, [path.join(app, 'dist', 'app.cjs')], tmpdir())
        assert.strictEqual(ran.code, 0, ran.output)
        assert.match(ran.output, /Hello, bundle \(from a dynamic library\)/)
    })

    it('adds the package in the directory of the packages of the workspace, of its version, installed with its package manager', async (): Promise<void> => {
        //A pnpm workspace whose packages are in apps/, without version in its root package.json
        const root: string = path.join(work, 'apps-workspace')
        mkdirSync(path.join(root, 'apps', 'web'), {recursive: true})
        writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'apps-workspace', private: true, workspaces: ['apps/*', 'tools/cli']}))
        writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\n')
        writeFileSync(path.join(root, 'apps', 'web', 'package.json'), JSON.stringify({name: 'web', version: '2.0.0'}))
        const added = await runIn(process.execPath, [CLI, 'add', '@acme/greeting'], root)
        assert.strictEqual(added.code, 0, added.output)
        assert.match(added.output, /Package @acme\/greeting 2\.0\.0 added: apps[\\/]greeting/)
        assert.match(added.output, /Next: pnpm install \(links the package\), then pnpm --filter @acme\/greeting run rebuild/)
        assert.strictEqual(JSON.parse(readFileSync(path.join(root, 'apps', 'greeting', 'package.json'), 'utf8')).version, '2.0.0')
        //The commands of the workspace see it
        const listed = await runIn(process.execPath, [CLI, 'list'], root)
        assert.match(listed.output, /@acme\/greeting\s+2\.0\.0 \(private\)\s+apps[\\/]greeting/)
        //A workspace without a directory of packages (only packages named one by one)
        const named: string = path.join(work, 'named-workspace')
        mkdirSync(path.join(named, 'cli'), {recursive: true})
        writeFileSync(path.join(named, 'package.json'), JSON.stringify({name: 'named-workspace', private: true, workspaces: ['cli']}))
        const refused = await runIn(process.execPath, [CLI, 'add', 'greeting'], named)
        assert.notStrictEqual(refused.code, 0)
        assert.match(refused.output, /has no directory of packages/)
    })

    it('adds the packages of a workspace of independent versions (lerna) at 0.0.1, its packages listed by a flow list of pnpm', async (): Promise<void> => {
        const root: string = path.join(work, 'independent')
        mkdirSync(path.join(root, 'packages', 'web'), {recursive: true})
        writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'independent', private: true}))
        writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: [\'packages/*\'] # a flow list\n')
        writeFileSync(path.join(root, 'lerna.json'), JSON.stringify({version: 'independent'}))
        writeFileSync(path.join(root, 'packages', 'web', 'package.json'), JSON.stringify({name: 'web', version: '3.1.0'}))
        const added = await runIn(process.execPath, [CLI, 'add', 'util', '--to', 'web'], root)
        assert.strictEqual(added.code, 0, added.output)
        assert.match(added.output, /Package util 0\.0\.1 added: packages[\\/]util/)
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(root, 'packages', 'web', 'package.json'), 'utf8')).dependencies, {util: '^0.0.1'})
    })

    it('refuses an invalid name, a name taken, an unknown dependent, and a directory outside of a workspace', async (): Promise<void> => {
        const root: string = workspace(work, 'refused')
        const invalid = await runIn(process.execPath, [CLI, 'add', 'Capital Name'], root)
        assert.notStrictEqual(invalid.code, 0)
        assert.match(invalid.output, /is not a name of package/)
        const taken = await runIn(process.execPath, [CLI, 'add', 'app'], root)
        assert.notStrictEqual(taken.code, 0)
        assert.match(taken.output, /has already a package app/)
        const unknown = await runIn(process.execPath, [CLI, 'add', 'greeting', '--to', 'api'], root)
        assert.notStrictEqual(unknown.code, 0)
        assert.match(unknown.output, /has no package api \(app\)/)
        assert.ok(!existsSync(path.join(root, 'packages', 'greeting')))
        mkdirSync(path.join(work, 'alone'))
        const alone = await runIn(process.execPath, [CLI, 'add', 'greeting'], path.join(work, 'alone'))
        assert.notStrictEqual(alone.code, 0)
        assert.match(alone.output, /is not in a workspace/)
    })
})

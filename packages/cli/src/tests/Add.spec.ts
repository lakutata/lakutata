import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {CLI, Run, TOOLCHAINS, VisualCpp, Workspace} from './support/Workspace.js'

let work: string

describe('lakutata add', (): void => {
    before((): void => {
        //The real path: gyp computes the paths of the dependencies relative to it (/var is a link to /private/var on macOS)
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-add-')))
    })

    after((): void => rmSync(work, {recursive: true, force: true}))

    it('adds a TypeScript package of the version of the workspace, a dependency of a package, which builds and passes its tests', async (): Promise<void> => {
        const root: string = Workspace(work, 'library')
        const added = await Run(process.execPath, [CLI, 'add', 'greeting', '--to', 'app'], root)
        assert.strictEqual(added.code, 0, added.output)
        assert.match(added.output, /Package greeting 1\.2\.3 added: packages[\\/]greeting/)
        assert.match(added.output, /a dependency of app/)
        const manifest = JSON.parse(readFileSync(path.join(root, 'packages', 'greeting', 'package.json'), 'utf8'))
        assert.strictEqual(manifest.version, '1.2.3')
        assert.strictEqual(manifest.scripts.clean, 'lakutata clean')
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(root, 'packages', 'app', 'package.json'), 'utf8')).dependencies, {lakutata: '^3.0.0', greeting: '^1.2.3'})
        const directory: string = path.join(root, 'packages', 'greeting')
        const built = await Run('npm', ['run', 'rebuild'], directory)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(directory, 'build', 'index.d.ts')))
        const tested = await Run('npm', ['test'], directory)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 1/)
    })

    for (const build of ['gyp', 'cmake', 'rust']) {
        it(`adds a native addon built by ${build}, called from its TypeScript, its errors thrown in JavaScript, bundled with an application`, {skip: TOOLCHAINS[build] ? false : `no toolchain of ${build}`}, async (): Promise<void> => {
            const root: string = Workspace(work, `native-${build}`)
            const added = await Run(process.execPath, [CLI, 'add', '@acme/capture', ...(build === 'gyp' ? ['--native'] : ['--native', build]), '--to', 'app'], root)
            assert.strictEqual(added.code, 0, added.output)
            assert.match(added.output, new RegExp(`Native addon \\(${build}\\) @acme/capture 1\\.2\\.3 added: packages[\\\\/]capture`))
            const directory: string = path.join(root, 'packages', 'capture')
            const buildFiles: Record<string, string[]> = {gyp: ['binding.gyp', 'cpp/binding.cc'], cmake: ['CMakeLists.txt', 'cpp/binding.cc'], rust: ['Cargo.toml', 'build.rs', 'rust/lib.rs']}
            for (const file of [...buildFiles[build], 'src/index.ts', 'src/tests/index.spec.ts', 'tsconfig.json', 'README.md']) assert.ok(existsSync(path.join(directory, file)), file)
            const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
            assert.strictEqual(manifest.gypfile, build === 'gyp' ? true : undefined)
            const built = await Run('npm', ['run', 'rebuild'], directory)
            assert.strictEqual(built.code, 0, built.output)
            const addon: string = path.join(directory, 'build', 'Release', 'capture.node')
            assert.ok(existsSync(addon), built.output)
            //One addon for the Macs with Intel and with Apple silicon (the C++ builds)
            if (process.platform === 'darwin' && build !== 'rust') assert.deepStrictEqual(execFileSync('lipo', ['-archs', addon], {encoding: 'utf8'}).trim().split(' ').sort(), ['arm64', 'x86_64'])
            const tested = await Run('npm', ['test'], directory)
            assert.strictEqual(tested.code, 0, tested.output)
            assert.match(tested.output, /pass 2/)
            //The TypeScript is cleaned without the addon
            assert.strictEqual((await Run('npm', ['run', 'clean'], directory)).code, 0)
            assert.ok(!existsSync(path.join(directory, 'dist')) && existsSync(addon))
            assert.strictEqual((await Run('npm', ['run', 'build'], directory)).code, 0)

            //An application using the addon is bundled with it, and runs elsewhere
            mkdirSync(path.join(root, 'node_modules', '@acme'))
            symlinkSync(directory, path.join(root, 'node_modules', '@acme', 'capture'), 'dir')
            const app: string = path.join(root, 'packages', 'app')
            mkdirSync(path.join(app, 'build'))
            writeFileSync(path.join(app, 'build', 'App.js'), 'import {Greet} from \'@acme/capture\'\nconsole.log(Greet(\'bundle\'))\n')
            const bundled = await Run(process.execPath, [CLI, 'bundle'], app)
            assert.strictEqual(bundled.code, 0, bundled.output)
            assert.match(bundled.output, /the native addons \(@acme\/capture\)/)
            const ran = await Run(process.execPath, [path.join(app, 'dist', 'app.cjs')], tmpdir())
            assert.strictEqual(ran.code, 0, ran.output)
            assert.match(ran.output, /Hello, bundle \(native\)/)
        })
    }

    it('links a dynamic library shipped with a gyp addon as its comments show, found next to it once bundled', {skip: TOOLCHAINS.gyp ? false : 'no C++ toolchain'}, async (): Promise<void> => {
        const root: string = Workspace(work, 'dynamic')
        assert.strictEqual((await Run(process.execPath, [CLI, 'add', 'suffixed', '--native'], root)).code, 0)
        const directory: string = path.join(root, 'packages', 'suffixed')
        //The dynamic library of the package, found through the rpath of the addons (next to them on Windows)
        const windows: boolean = process.platform === 'win32'
        const library: string = process.platform === 'darwin' ? 'libsuffix.dylib' : windows ? 'suffix.dll' : 'libsuffix.so'
        const lib: string = path.join(directory, 'deps', 'lib')
        mkdirSync(lib, {recursive: true})
        writeFileSync(path.join(directory, 'deps', 'suffix.cc'), `extern "C" ${windows ? '__declspec(dllexport) ' : ''}const char *suffix() { return " (from a dynamic library)"; }\n`)
        if (windows) {
            //The DLL and its import library
            VisualCpp([`cl /nologo /LD /Fe"${path.join(lib, library)}" "${path.join(directory, 'deps', 'suffix.cc')}" /link /IMPLIB:"${path.join(lib, 'suffix.lib')}"`])
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
        const built = await Run('npm', ['run', 'rebuild'], directory)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(directory, 'build', 'Release', library)))
        //Bundled with the application: the addon finds its library next to it, elsewhere
        symlinkSync(directory, path.join(root, 'node_modules', 'suffixed'), 'dir')
        const app: string = path.join(root, 'packages', 'app')
        mkdirSync(path.join(app, 'build'))
        writeFileSync(path.join(app, 'build', 'App.js'), 'import {Greet} from \'suffixed\'\nconsole.log(Greet(\'bundle\'))\n')
        const bundled = await Run(process.execPath, [CLI, 'bundle'], app)
        assert.strictEqual(bundled.code, 0, bundled.output)
        //The library of the package moved away: the bundle has its own
        rmSync(path.join(directory, 'deps'), {recursive: true})
        rmSync(path.join(directory, 'build'), {recursive: true})
        const ran = await Run(process.execPath, [path.join(app, 'dist', 'app.cjs')], tmpdir())
        assert.strictEqual(ran.code, 0, ran.output)
        assert.match(ran.output, /Hello, bundle \(from a dynamic library\)/)
    })

    it('refuses an invalid name, a name taken, an unknown dependent, and a directory outside of a workspace', async (): Promise<void> => {
        const root: string = Workspace(work, 'refused')
        const invalid = await Run(process.execPath, [CLI, 'add', 'Capital Name'], root)
        assert.notStrictEqual(invalid.code, 0)
        assert.match(invalid.output, /is not a name of package/)
        const taken = await Run(process.execPath, [CLI, 'add', 'app'], root)
        assert.notStrictEqual(taken.code, 0)
        assert.match(taken.output, /has already a package app/)
        const unknown = await Run(process.execPath, [CLI, 'add', 'greeting', '--to', 'api'], root)
        assert.notStrictEqual(unknown.code, 0)
        assert.match(unknown.output, /has no package api \(app\)/)
        assert.ok(!existsSync(path.join(root, 'packages', 'greeting')))
        mkdirSync(path.join(work, 'alone'))
        const alone = await Run(process.execPath, [CLI, 'add', 'greeting'], path.join(work, 'alone'))
        assert.notStrictEqual(alone.code, 0)
        assert.match(alone.output, /is not in a workspace/)
    })
})

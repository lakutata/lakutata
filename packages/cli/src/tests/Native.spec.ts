import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {CLI, has, runIn, TOOLCHAINS, visualCpp, workspace} from './support/Workspace.js'

let work: string

const MAC: boolean = process.platform === 'darwin'
const WINDOWS: boolean = process.platform === 'win32'
const DYNAMIC: string = MAC ? 'libshared.dylib' : WINDOWS ? 'shared.dll' : 'libshared.so'
const STATIC: string = WINDOWS ? 'fixed.lib' : 'libfixed.a'

/**
 * The library of the system the addon links: zlib, shlwapi on Windows (which has no zlib)
 */
const SYSTEM: string = WINDOWS ? 'shlwapi' : 'z'

/**
 * The libraries of a package: a static one (libfixed.a), a dynamic one shipped with it (named @rpath/libshared.dylib
 * on macOS), a header (deps/include/answer.h); for the Macs with Intel and with Apple silicon
 * @param directory
 */
function libraries(directory: string): void {
    const deps: string = path.join(directory, 'deps')
    mkdirSync(path.join(deps, 'lib'), {recursive: true})
    mkdirSync(path.join(deps, 'include'), {recursive: true})
    writeFileSync(path.join(deps, 'include', 'answer.h'), '#define ANSWER 40\n')
    writeFileSync(path.join(deps, 'fixed.c'), 'const char *from_static(void) { return "static"; }\n')
    writeFileSync(path.join(deps, 'shared.c'), `${WINDOWS ? '__declspec(dllexport) ' : ''}const char *from_dynamic(void) { return "dynamic"; }\n`)
    if (WINDOWS) {
        //The DLL and its import library (shared.lib), which the linker of Windows links
        return visualCpp([
            `cl /nologo /c /Fo"${path.join(deps, 'fixed.obj')}" "${path.join(deps, 'fixed.c')}"`,
            `lib /nologo /OUT:"${path.join(deps, 'lib', STATIC)}" "${path.join(deps, 'fixed.obj')}"`,
            `cl /nologo /LD /Fe"${path.join(deps, 'lib', DYNAMIC)}" "${path.join(deps, 'shared.c')}" /link /IMPLIB:"${path.join(deps, 'lib', 'shared.lib')}"`
        ])
    }
    const arch: string[] = MAC ? ['-arch', 'x86_64', '-arch', 'arm64'] : ['-fPIC']
    execFileSync('cc', [...arch, '-c', '-o', path.join(deps, 'fixed.o'), path.join(deps, 'fixed.c')])
    if (MAC) execFileSync('libtool', ['-static', '-o', path.join(deps, 'lib', 'libfixed.a'), path.join(deps, 'fixed.o')])
    else execFileSync('ar', ['rcs', path.join(deps, 'lib', 'libfixed.a'), path.join(deps, 'fixed.o')])
    execFileSync('cc', MAC
        ? [...arch, '-dynamiclib', '-install_name', `@rpath/${DYNAMIC}`, '-o', path.join(deps, 'lib', DYNAMIC), path.join(deps, 'shared.c')]
        : ['-shared', '-fPIC', '-o', path.join(deps, 'lib', DYNAMIC), path.join(deps, 'shared.c')])
}

/**
 * The C++ of the addon calling its libraries: zlib, the static and the dynamic libraries, the header and the
 * definition, CoreFoundation on macOS
 * @param source
 */
function callLibrariesInCpp(source: string): string {
    return source
        .replace('#include <napi.h>\n', `#include <napi.h>
#include <string>
#include "answer.h"
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shlwapi.h>

static std::string System() {
    return std::string("shlwapi ") + (PathIsRelativeA("relative") ? "1" : "0");
}
#else
#include <zlib.h>

static std::string System() {
    return std::string("zlib ") + zlibVersion();
}
#endif
#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#endif

extern "C" const char *from_static(void);
extern "C" const char *from_dynamic(void);

static std::string Framework() {
#ifdef __APPLE__
    CFStringRef text = CFStringCreateWithCString(kCFAllocatorDefault, "framework", kCFStringEncodingUTF8);
    CFIndex length = CFStringGetLength(text);
    CFRelease(text);
    return ", framework " + std::to_string(length);
#else
    return "";
#endif
}
`)
        .replace('+ " (native)")', '+ " (" + System() + ", " + from_static() + ", " + from_dynamic() + ", " + std::to_string(ANSWER + TRACE_LEVEL) + Framework() + ")")')
}

/**
 * The Rust of the addon calling its libraries: zlib, the static and the dynamic libraries, CoreFoundation on macOS
 * @param source
 */
function callLibrariesInRust(source: string): string {
    return `use std::ffi::{c_char, CStr};

extern "C" {
    fn from_static() -> *const c_char;
    fn from_dynamic() -> *const c_char;
}

#[cfg(not(windows))]
extern "C" {
    fn zlibVersion() -> *const c_char;
}

#[cfg(windows)]
extern "system" {
    fn PathIsRelativeA(path: *const c_char) -> i32;
}

#[cfg(target_os = "macos")]
extern "C" {
    fn CFAbsoluteTimeGetCurrent() -> f64;
}

fn text(pointer: *const c_char) -> String {
    unsafe { CStr::from_ptr(pointer) }.to_string_lossy().into_owned()
}

#[cfg(target_os = "macos")]
fn framework() -> String {
    format!(", framework {}", if unsafe { CFAbsoluteTimeGetCurrent() } > 0.0 { 9 } else { 0 })
}

#[cfg(not(target_os = "macos"))]
fn framework() -> String {
    String::new()
}

#[cfg(not(windows))]
fn system() -> String {
    format!("zlib {}", unsafe { text(zlibVersion()) })
}

#[cfg(windows)]
fn system() -> String {
    format!("shlwapi {}", if unsafe { PathIsRelativeA(c"relative".as_ptr()) } != 0 { 1 } else { 0 })
}
${source.replace('format!("Hello, {} (native)", name)', 'format!("Hello, {} ({}, {}, {}, {}{})", name, system(), unsafe { text(from_static()) }, unsafe { text(from_dynamic()) }, 43, framework())')}`
}

describe('lakutata native', (): void => {
    before((): void => {
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-native-')))
    })

    after((): void => rmSync(work, {recursive: true, force: true}))

    for (const build of ['gyp', 'cmake', 'rust']) {
        it(`links the libraries of the system, of pkg-config, the frameworks, the static and the dynamic libraries of the package to an addon built by ${build}, once`, {skip: TOOLCHAINS[build] ? false : `no toolchain of ${build}`}, async (): Promise<void> => {
            const root: string = workspace(work, `native-${build}`)
            assert.strictEqual((await runIn(process.execPath, [CLI, 'add', 'addon', '--native', build], root)).code, 0)
            const directory: string = path.join(root, 'packages', 'addon')
            libraries(directory)
            const commands: string[][] = [
                ['link', SYSTEM],
                ['link', `deps/lib/${STATIC}`],
                ['link', `deps/lib/${DYNAMIC}`],
                ...(MAC ? [['link', 'CoreFoundation', '--framework']] : []),
                ...(build === 'rust' ? [] : [
                    ...(has('pkg-config') ? [['link', 'zlib', '--pkg-config']] : []),
                    ['include', 'deps/include'],
                    ['define', 'TRACE_LEVEL=3']
                ])
            ]
            const buildFile: string = ({gyp: 'binding.gyp', cmake: 'CMakeLists.txt', rust: '.cargo/config.toml'} as Record<string, string>)[build]
            for (const command of commands) {
                const changed = await runIn(process.execPath, [CLI, 'native', ...command], directory)
                assert.strictEqual(changed.code, 0, changed.output)
                assert.match(changed.output, new RegExp(`\\(${build}\\): ${buildFile.replace(/\./g, '\\.')}`), changed.output)
            }
            //Once: the second time changes nothing
            const files: string[] = [buildFile, 'package.json']
            const before: string[] = files.map((file: string): string => readFileSync(path.join(directory, file), 'utf8'))
            for (const command of commands) {
                const unchanged = await runIn(process.execPath, [CLI, 'native', ...command], directory)
                assert.strictEqual(unchanged.code, 0, unchanged.output)
                assert.match(unchanged.output, /is already in the build/)
            }
            assert.deepStrictEqual(files.map((file: string): string => readFileSync(path.join(directory, file), 'utf8')), before)
            if (build === 'rust') {
                //The libraries of every platform and of macOS, given by build.rs
                const environment: string = readFileSync(path.join(directory, '.cargo', 'config.toml'), 'utf8')
                if (WINDOWS) {
                    //The DLL by its import library
                    assert.match(environment, /^\[env\]\nLAKUTATA_NATIVE = "rustc-link-lib=shlwapi"\nLAKUTATA_NATIVE_WINDOWS = "rustc-link-search=native=deps\/lib;rustc-link-lib=static=fixed;rustc-link-lib=dylib=shared"\n/)
                } else {
                    assert.match(environment, /^\[env\]\nLAKUTATA_NATIVE = "rustc-link-lib=z"\nLAKUTATA_NATIVE_UNIX = "rustc-link-search=native=deps\/lib;rustc-link-lib=static=fixed"\n/)
                }
                //The headers and the definitions of C are not the ones of Rust
                const refused = await runIn(process.execPath, [CLI, 'native', 'include', 'deps/include'], directory)
                assert.notStrictEqual(refused.code, 0)
                assert.match(refused.output, /no directory of headers of C/)
                writeFileSync(path.join(directory, 'rust', 'lib.rs'), callLibrariesInRust(readFileSync(path.join(directory, 'rust', 'lib.rs'), 'utf8')))
            } else {
                writeFileSync(path.join(directory, 'cpp', 'binding.cc'), callLibrariesInCpp(readFileSync(path.join(directory, 'cpp', 'binding.cc'), 'utf8')))
            }

            const built = await runIn('npm', ['run', 'rebuild'], directory)
            assert.strictEqual(built.code, 0, built.output)
            const release: string = path.join(directory, 'build', 'Release')
            assert.ok(existsSync(path.join(release, DYNAMIC)), built.output)
            if (MAC) {
                const linked: string = execFileSync('otool', ['-L', path.join(release, 'addon.node')], {encoding: 'utf8'})
                for (const library of ['CoreFoundation.framework', 'libz', `@rpath/${DYNAMIC}`]) assert.match(linked, new RegExp(library.replace(/\./g, '\\.')), linked)
                if (build !== 'rust') assert.deepStrictEqual(execFileSync('lipo', ['-archs', path.join(release, 'addon.node')], {encoding: 'utf8'}).trim().split(' ').sort(), ['arm64', 'x86_64'])
            }
            //Moved away from the libraries of the package: the dynamic one is found next to the addon
            const moved: string = path.join(work, `moved-${build}`)
            cpSync(release, moved, {recursive: true})
            rmSync(path.join(directory, 'deps'), {recursive: true})
            const ran = await runIn(process.execPath, ['-e', `console.log(require(${JSON.stringify(path.join(moved, 'addon.node'))}).greet('test'))`], tmpdir())
            assert.strictEqual(ran.code, 0, ran.output)
            assert.match(ran.output, new RegExp(`Hello, test \\(${WINDOWS ? 'shlwapi 1' : 'zlib \\d+\\.\\d+[\\w.-]*'}, static, dynamic, 43${MAC ? ', framework 9' : ''}\\)`), ran.output)
        })
    }

    it('refuses a directory which is not a native addon, a library missing, a framework of another platform', async (): Promise<void> => {
        const root: string = workspace(work, 'refused')
        const notNative = await runIn(process.execPath, [CLI, 'native', 'link', 'z'], path.join(root, 'packages', 'app'))
        assert.notStrictEqual(notNative.code, 0)
        assert.match(notNative.output, /is not a native addon \(no binding\.gyp, CMakeLists\.txt nor Cargo\.toml\)/)
        assert.strictEqual((await runIn(process.execPath, [CLI, 'add', 'addon', '--native'], root)).code, 0)
        const directory: string = path.join(root, 'packages', 'addon')
        const missing = await runIn(process.execPath, [CLI, 'native', 'link', 'deps/lib/libmissing.a'], directory)
        assert.notStrictEqual(missing.code, 0)
        assert.match(missing.output, /deps\/lib\/libmissing\.a does not exist/)
        const framework = await runIn(process.execPath, [CLI, 'native', 'link', 'IOKit', '--framework', '--platform', 'linux'], directory)
        assert.notStrictEqual(framework.code, 0)
        assert.match(framework.output, /The frameworks are the libraries of macOS/)
        const crate = await runIn(process.execPath, [CLI, 'native', 'link', 'libc', '--crate'], directory)
        assert.notStrictEqual(crate.code, 0)
        assert.match(crate.output, /The crates are the libraries of the Rust addons/)
    })
})

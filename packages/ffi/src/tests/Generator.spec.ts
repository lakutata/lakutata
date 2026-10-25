import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {existsSync, writeFileSync} from 'node:fs'
import {execFileSync, spawnSync} from 'node:child_process'
import path from 'node:path'
import {loadNativeLibrary, type NativeLibraryHandle} from '../exports/FFI.js'
import {generateNativeLibrary, type GeneratedLibrary} from '../exports/Generator.js'
import {DeclarationParser} from '../lib/declarations/Parser.js'
import {platformOf} from '../lib/declarations/Platform.js'
import {generateFromPreprocessed} from '../lib/generator/Generator.js'
import {defaultCompiler} from '../lib/generator/Preprocessor.js'
import {compileFixture, FIXTURE_DECLARATIONS, removeFixture} from './support/Fixture.js'

/**
 * Whether the C compiler of the machine can be run
 */
function compilerFound(): boolean {
    return !spawnSync(defaultCompiler(), process.platform === 'win32' ? ['/?'] : ['--version'], {stdio: 'ignore'}).error
}

/**
 * The directory of the headers of the system: the SDK of macOS, /usr/include elsewhere
 */
function systemIncludes(): string | undefined {
    if (process.platform === 'darwin') {
        try {
            return path.join(execFileSync('xcrun', ['--show-sdk-path']).toString().trim(), 'usr', 'include')
        } catch {
            return undefined
        }
    }
    return process.platform === 'win32' ? undefined : '/usr/include'
}

describe('The generator of libraries', (): void => {

    it('generates a class from a preprocessed header: interfaces, properties, declarations and the report', async (): Promise<void> => {
        const text: string = [
            '# 1 "/sdk/vendor.h"',
            '# 1 "/usr/include/types.h" 1 3',
            'typedef unsigned long size_t;',
            'struct timestamp { long seconds; int micros; };',
            'struct unused { int nothing; };',
            'long double strtold(const char *text, char **end);',
            '# 2 "/sdk/vendor.h" 2',
            '#define VENDOR_OK 0',
            '#define VENDOR_FLAGS (VENDOR_OK | 6)',
            '#define VENDOR_NAME "vendor"',
            'typedef struct vendor vendor;',
            'enum vendor_mode { VENDOR_FAST = 1, VENDOR_SAFE };',
            '#pragma pack(push, 1)',
            'typedef struct { char kind; int length; struct timestamp at; } vendor_frame;',
            '#pragma pack(pop)',
            'typedef void (*vendor_log)(int level, const char *message);',
            'int vendor_open(const char *name, vendor **out) __attribute__((visibility("default"))) __attribute__((deprecated));',
            'size_t vendor_read(vendor *device, void *buffer, size_t size);',
            'vendor_frame vendor_frame_get(vendor *device);',
            'int vendor_frame_send(const vendor_frame *frame);',
            'void vendor_logger(vendor *device, vendor_log logger);',
            'void free(void *pointer);',
            'long double vendor_precise(void);',
            'extern const char vendor_version[];'
        ].join('\n')
        const generated: GeneratedLibrary = await generateFromPreprocessed({text: text, header: '/sdk/vendor.h', systemDirectories: ['/usr/include'], command: 'cc -E'}, {check: false}, platformOf('linux', 'x64'))
        const {code, declarations, report} = generated
        assert.deepStrictEqual({functions: report.functions, variables: report.variables, interfaces: report.interfaces, constants: report.constants, unchecked: report.unchecked}, {functions: 6, variables: 1, interfaces: 1, constants: 4, unchecked: 'not asked'})
        assert.deepStrictEqual(report.skipped.map((skipped): string => `${skipped.file}:${skipped.line} ${skipped.reason}`), ['/sdk/vendor.h:17 long double is not supported'])
        //The declarations: the ones of the library, the types of the system they use, the macros as their values
        assert.match(declarations, /^struct timestamp \{\n {4}long seconds;\n {4}int micros;\n\};/m)
        assert.doesNotMatch(declarations, /unused|size_t;|strtold|visibility|deprecated/)
        assert.match(declarations, /#pragma pack\(push, 1\)\ntypedef struct \{\n {4}char kind;\n {4}int length;\n {4}struct timestamp at;\n\} vendor_frame;\n#pragma pack\(pop\)/)
        assert.match(declarations, /^#define VENDOR_OK 0$/m)
        assert.match(declarations, /^#define VENDOR_FLAGS 6$/m)
        assert.doesNotMatch(declarations, /VENDOR_NAME/)
        assert.strictEqual(new DeclarationParser(platformOf('linux', 'x64')).parse(declarations).functions.size, 6)
        //The class: a property by function, its TypeScript type
        assert.match(code, /export interface vendor_frame \{\n {4}kind: number\n {4}length: number\n {4}at: \{seconds: bigint, micros: number\}\n\}/)
        assert.match(code, /@Library\(\{\n {4}names: 'vendor',\n {4}declarations: `\n {8}struct timestamp \{/)
        assert.match(code, /export class Vendor extends NativeLibrary \{/)
        assert.match(code, / {4}\/\/int vendor_open\(const char \*name, vendor \*\*out\);\n {4}@Native\(\)\n {4}public readonly vendor_open: \(name: string \| null, out: Pointer \| Buffer \| ArrayBufferView \| null\) => number/)
        assert.match(code, /public readonly vendor_read: \(device: Pointer \| Buffer \| ArrayBufferView \| null, buffer: Pointer \| Buffer \| ArrayBufferView \| null, size: bigint \| number\) => bigint/)
        assert.match(code, /public readonly vendor_frame_get: \(device: Pointer \| Buffer \| ArrayBufferView \| null\) => vendor_frame/)
        assert.match(code, /public readonly vendor_frame_send: \(frame: vendor_frame \| Pointer \| Buffer \| ArrayBufferView \| null\) => number/)
        assert.match(code, /public readonly vendor_logger: \(device: Pointer \| Buffer \| ArrayBufferView \| null, logger: \(\(level: number, message: string \| null\) => void\) \| Pointer \| null\) => void/)
        //A function named as a member of the component: another property
        assert.match(code, / {4}@Native\('free'\)\n {4}public readonly free_: \(pointer: Pointer \| Buffer \| ArrayBufferView \| null\) => void/)
        assert.match(code, / {4}@NativeVariable\(\)\n {4}public readonly vendor_version: string/)
        assert.match(code, /^import \{Library, Native, NativeLibrary, NativeVariable, type Pointer\} from '@lakutata\/ffi'$/m)
    })

    describe('with the C compiler of the machine', {skip: !compilerFound() && `no C compiler (${defaultCompiler()})`}, (): void => {

        const file: string | undefined = compileFixture()

        after((): void => {
            if (file) removeFixture(file)
        })

        it('generates the class of a library checked against it', {skip: !file && 'the fixture cannot be compiled'}, async (): Promise<void> => {
            const header: string = path.join(path.dirname(file!), 'fixture.h')
            writeFileSync(header, [
                '#include <stdint.h>',
                '#include <stdarg.h>',
                '#include <stddef.h>',
                FIXTURE_DECLARATIONS,
                'struct flags flags_make(unsigned ready, unsigned mode, int level, unsigned char tag, uint64_t big);',
                'int32_t packed_sum(struct packed p);',
                'int log_now(int level, const char *message);',
                'void set_logger(logger_t logger);',
                'struct samples samples_make(int32_t start);',
                'size_t big_size(void);',
                'int fixture_missing(void);',
                'int fixture_vlog(const char *format, va_list args);'
            ].join('\n'))
            const {code, declarations, report} = await generateNativeLibrary({header: header, library: file})
            assert.strictEqual(report.library, file)
            assert.deepStrictEqual(report.skipped.map((skipped): string => skipped.name).sort(), ['fixture_missing', 'fixture_vlog'])
            assert.strictEqual(report.functions, 6)
            assert.strictEqual(report.variables, 2)
            assert.match(code, /export interface flags \{\n {4}ready: number\n {4}mode: number\n {4}level: number\n {4}tag: number\n {4}big: bigint\n\}/)
            assert.match(code, /export interface samples \{\n {4}values: Int32Array\n {4}scale: number\n {4}totals: bigint\[\]\n\}/)
            assert.match(code, /names: 'fixture'/)
            assert.doesNotMatch(code, /fixture_missing:|fixture_vlog:/)
            //The declarations generated, given to the library
            const library: NativeLibraryHandle = loadNativeLibrary(file!, declarations)
            try {
                assert.deepStrictEqual(library.function<(...args: unknown[]) => unknown>('flags_make')(1, 6, -7, 200, 0xABCDEF1234n), {ready: 1, mode: 6, level: -7, tag: 200, big: 0xABCDEF1234n})
                assert.strictEqual(library.function<(packed: object) => number>('packed_sum')({a: 1, b: 2, c: 3}), 6)
                assert.strictEqual(library.function<() => bigint>('big_size')(), 42n)
                assert.strictEqual(library.variable<string>('fixture_version').get(), '1.0')
            } finally {
                await library.close()
            }
        })

        const includes: string | undefined = systemIncludes()
        const sqlite: boolean = !!includes && existsSync(path.join(includes, 'sqlite3.h'))

        it('generates the classes of libraries of the system', {skip: !sqlite && 'no sqlite3.h'}, async (): Promise<void> => {
            const {declarations, report} = await generateNativeLibrary({header: path.join(includes!, 'sqlite3.h'), library: process.platform === 'linux' ? 'libsqlite3.so.0' : undefined})
            assert.ok(report.functions > 200, String(report.functions))
            assert.ok(report.constants > 400, String(report.constants))
            assert.ok(report.skipped.every((skipped): boolean => /va_list/.test(skipped.reason)), JSON.stringify(report.skipped))
            const library: NativeLibraryHandle = loadNativeLibrary(report.library!, declarations)
            try {
                const version: string = library.function<() => string>('sqlite3_libversion')()
                assert.match(version, /^3\.\d+\.\d+$/)
                assert.strictEqual(library.variable<string>('sqlite3_version').get(), version)
                assert.strictEqual(library.constants.SQLITE_OK, 0n)
            } finally {
                await library.close()
            }
        })
    })
})

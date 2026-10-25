import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync, spawnSync} from 'node:child_process'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {CLI, runIn} from './support/Workspace.js'

/**
 * Whether the C compiler the generator runs by default is found (cl is found in the Developer Command Prompt only)
 */
function compiler(): boolean {
    return !spawnSync(process.env.CC || (process.platform === 'win32' ? 'cl' : 'cc'), process.platform === 'win32' ? ['/?'] : ['--version'], {stdio: 'ignore'}).error
}

const HEADER: string = `
#include <stdint.h>
#define VENDOR_OK 0
typedef struct vendor vendor;
typedef struct { uint8_t kind; uint32_t length; } vendor_frame;
int vendor_open(const char *name, vendor **device);
int vendor_send(vendor *device, const vendor_frame *frame);
`

describe('The command ffi generate', {skip: !compiler() && 'no C compiler'}, (): void => {

    let work: string

    before((): void => {
        work = mkdtempSync(path.join(tmpdir(), 'lakutata-cli-ffi-'))
        writeFileSync(path.join(work, 'vendor.h'), HEADER)
    })

    after((): void => {
        rmSync(work, {recursive: true, force: true})
    })

    it('generates the class of a library from its header, and does not replace a file without --force', async (): Promise<void> => {
        const first: { code: number, output: string } = await runIn(process.execPath, [CLI, 'ffi', 'generate', 'vendor.h', '--no-check'], work)
        assert.strictEqual(first.code, 0, first.output)
        assert.match(first.output, /Generated Vendor\.ts \(Vendor\): 2 functions, 0 variables, 1 interface, 1 constant/)
        assert.match(first.output, /not checked against the library \(--no-check\)/)
        const code: string = readFileSync(path.join(work, 'Vendor.ts'), 'utf8')
        assert.match(code, /export class Vendor extends NativeLibrary \{/)
        assert.match(code, /public readonly vendor_send: \(device: Pointer \| Buffer \| ArrayBufferView \| null, frame: Pointer \| Buffer \| ArrayBufferView \| null\) => number/)
        const again: { code: number, output: string } = await runIn(process.execPath, [CLI, 'ffi', 'generate', 'vendor.h', '--no-check'], work)
        assert.notStrictEqual(again.code, 0)
        assert.match(again.output, /Vendor\.ts exists: give --force to replace it/)
        //Checked against a library that is not found: generated, not checked
        const unchecked: { code: number, output: string } = await runIn(process.execPath, [CLI, 'ffi', 'generate', 'vendor.h', '--force', '--class-name', 'VendorSdk', '--out', path.join('src', 'native', 'Vendor.ts')], work)
        assert.strictEqual(unchecked.code, 0, unchecked.output)
        assert.match(unchecked.output, /not checked against the library: the library .*vendor.* cannot be loaded; give it with --library/)
        assert.match(readFileSync(path.join(work, 'src', 'native', 'Vendor.ts'), 'utf8'), /export class VendorSdk extends NativeLibrary/)
    })

    it('leaves out the functions the library does not give', {skip: process.platform === 'win32' && 'the library is built with cc'}, async (): Promise<void> => {
        const library: string = path.join(work, process.platform === 'darwin' ? 'libvendor.dylib' : 'libvendor.so')
        writeFileSync(path.join(work, 'vendor.c'), '#include "vendor.h"\nint vendor_open(const char *name, vendor **device) { *device = 0; return 0; }\n')
        execFileSync('cc', ['-shared', '-fPIC', '-o', library, path.join(work, 'vendor.c')], {cwd: work})
        const result: { code: number, output: string } = await runIn(process.execPath, [CLI, 'ffi', 'generate', 'vendor.h', '--library', library, '--out', 'Checked.ts'], work)
        assert.strictEqual(result.code, 0, result.output)
        assert.match(result.output, /1 function, 0 variables, 1 interface, 1 constant, checked against .*libvendor/)
        assert.match(result.output, /Left out 1 declaration of the library:\n.*vendor_send: .*cannot be bound/)
        assert.ok(existsSync(path.join(work, 'Checked.ts')))
    })
})

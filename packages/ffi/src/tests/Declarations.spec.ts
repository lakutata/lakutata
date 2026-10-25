import {describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {NativeDeclarationException} from '../exceptions/NativeDeclarationException.js'
import {layoutOf, sizeOf} from '../lib/declarations/Layout.js'
import {DeclarationParser} from '../lib/declarations/Parser.js'
import {type Platform, platformOf} from '../lib/declarations/Platform.js'
import {type CType, type Declarations, type FunctionType, type PointerType, type RecordType, typeText} from '../lib/declarations/Types.js'

const LINUX_X64: Platform = platformOf('linux', 'x64')
const MACOS: Platform = platformOf('darwin', 'arm64')
const WINDOWS_X64: Platform = platformOf('win32', 'x64')

/**
 * The declarations of a text, for a platform
 * @param text
 * @param platform
 */
function parse(text: string, platform: Platform = LINUX_X64): Declarations {
    return new DeclarationParser(platform).parse(text)
}

/**
 * The type of a function's parameters and result, as C writes them
 * @param declarations
 * @param name
 */
function signature(declarations: Declarations, name: string): string {
    const type: FunctionType = declarations.functions.get(name)!.type
    return typeText(type)
}

/**
 * The message of the exception a function throws, which must be a NativeDeclarationException
 * @param fn
 */
function failure(fn: () => unknown): string {
    try {
        fn()
    } catch (error) {
        assert.ok(error instanceof NativeDeclarationException, String(error))
        return error.message
    }
    assert.fail('no exception')
}

/**
 * Whether a command runs
 * @param command
 */
function has(command: string): boolean {
    try {
        execFileSync(command, ['--version'], {stdio: 'ignore'})
        return true
    } catch {
        return false
    }
}

describe('C declarations', (): void => {

    it('read the arithmetic types, with the sizes of the platform', (): void => {
        const declarations: Declarations = parse(`
            unsigned long long int a(signed char b, unsigned short c, long d, long long e, unsigned f, _Bool g);
            double h(float i, unsigned __int64 j, size_t k, wchar_t l);
        `)
        assert.strictEqual(signature(declarations, 'a'), 'unsigned long long (signed char, unsigned short, long, long long, unsigned int, bool)')
        assert.strictEqual(signature(declarations, 'h'), 'double (float, uint64_t, size_t, wchar_t)')
        const long: CType = {kind: 'primitive', name: 'long'}
        const wchar: CType = {kind: 'primitive', name: 'wchar'}
        assert.deepStrictEqual([sizeOf(long, LINUX_X64), sizeOf(long, WINDOWS_X64), sizeOf(long, platformOf('linux', 'ia32'))], [8, 4, 4])
        assert.deepStrictEqual([sizeOf(wchar, LINUX_X64), sizeOf(wchar, WINDOWS_X64)], [4, 2])
    })

    it('know the types of stdint.h, of POSIX and of the Windows API, which a declaration replaces', (): void => {
        const declarations: Declarations = parse(`
            DWORD WINAPI GetLastError(void);
            BOOL ReadFile(HANDLE file, LPVOID buffer, DWORD size, LPDWORD read, void *overlapped);
            int gettimeofday(struct timeval *tv, void *tz);
            struct timeval { time_t tv_sec; suseconds_t tv_usec; };
            uint8_t first(const uint16_t *values, int64_t count);
            FILE *fopen(const char *path, const char *mode);
        `)
        assert.strictEqual(signature(declarations, 'GetLastError'), 'uint32_t ()')
        assert.strictEqual(declarations.functions.get('GetLastError')!.type.convention, 'stdcall')
        assert.strictEqual(signature(declarations, 'ReadFile'), 'int32_t (void *, void *, uint32_t, uint32_t *, void *)')
        assert.strictEqual(signature(declarations, 'first'), 'uint8_t (const uint16_t *, int64_t)')
        assert.strictEqual(signature(declarations, 'fopen'), 'struct FILE * (const char *, const char *)')
        assert.strictEqual(sizeOf(declarations.tags.get('struct timeval')!, MACOS), 16)
        assert.strictEqual(layoutOf(parse('struct timeval { time_t tv_sec; suseconds_t tv_usec; };', MACOS).tags.get('struct timeval') as RecordType, MACOS).members[1].size, 4)
        assert.strictEqual(signature(parse('typedef unsigned short DWORD; DWORD f(void);'), 'f'), 'unsigned short ()')
    })

    it('read pointers with their constness, arrays, and pointers to functions', (): void => {
        const declarations: Declarations = parse(`
            typedef int (*compare_t)(const void *a, const void *b);
            void qsort(void *base, size_t count, size_t size, compare_t compare);
            const char *const *names(char **out, int matrix[3][4], void (*done)(int code));
            int (*handler(int signal))(double);
        `)
        assert.strictEqual(signature(declarations, 'qsort'), 'void (void *, size_t, size_t, int (const void *, const void *) *)')
        assert.strictEqual(signature(declarations, 'names'), 'const const char * * (char * *, int[4] *, void (int) *)')
        assert.strictEqual(signature(declarations, 'handler'), 'int (double) * (int)')
        const result = declarations.functions.get('names')!.type.result as PointerType
        assert.strictEqual(result.constTarget, true)
        assert.strictEqual((result.to as PointerType).constTarget, true)
    })

    it('read the calling conventions where the compilers accept them', (): void => {
        const declarations: Declarations = parse(`
            void __stdcall Sleep(DWORD ms);
            void * __stdcall CreateThread(void *attributes, size_t stack, DWORD (__stdcall *start)(void *), void *parameter, DWORD flags, DWORD *id);
            typedef DWORD (CALLBACK *THREADPROC)(LPVOID parameter);
            int __cdecl printf(const char *format, ...);
        `, WINDOWS_X64)
        assert.strictEqual(declarations.functions.get('Sleep')!.type.convention, 'stdcall')
        const create: FunctionType = declarations.functions.get('CreateThread')!.type
        assert.strictEqual(create.convention, 'stdcall')
        assert.strictEqual(((create.parameters[2].type as PointerType).to as FunctionType).convention, 'stdcall')
        assert.strictEqual(((declarations.types.get('THREADPROC') as PointerType).to as FunctionType).convention, 'stdcall')
        assert.strictEqual(declarations.functions.get('printf')!.type.variadic, true)
    })

    it('read the directions of the parameters: _Out_ and _Inout_, the annotations of Microsoft, IN and OUT', (): void => {
        const declarations: Declarations = parse(`
            int open(const char *filename, _Out_ struct db **handle);
            int touch(_Inout_ struct tm *time);
            BOOL WINAPI GetVersionExW(_Inout_opt_ void *info, _Out_writes_bytes_(size) BYTE *buffer, _In_ DWORD size, _Outptr_result_maybenull_ void **result);
            void legacy(IN int a, OUT int *b, OPTIONAL void *c);
        `)
        const directions = (name: string): string[] => declarations.functions.get(name)!.type.parameters.map((parameter): string => parameter.direction)
        assert.deepStrictEqual(directions('open'), ['in', 'out'])
        assert.deepStrictEqual(directions('touch'), ['inout'])
        assert.deepStrictEqual(directions('GetVersionExW'), ['inout', 'out', 'in', 'out'])
        assert.deepStrictEqual(directions('legacy'), ['in', 'out', 'in'])
        assert.deepStrictEqual(declarations.functions.get('open')!.type.parameters.map((parameter): string | undefined => parameter.name), ['filename', 'handle'])
    })

    it('read structs and unions: declared, defined later, referring to themselves, anonymous members', (): void => {
        const declarations: Declarations = parse(`
            typedef struct sqlite3 sqlite3;
            struct node { int value; struct node *next; };
            typedef struct { int x, y; } point;
            struct shape { int kind; union { point center; double radius; }; struct { char tag; } ; char name[16]; };
            int sqlite3_close(sqlite3 *db);
        `)
        const sqlite3: CType = declarations.types.get('sqlite3')!
        assert.strictEqual(sqlite3.kind, 'struct')
        assert.strictEqual((sqlite3 as RecordType).members, undefined)
        const node: RecordType = declarations.tags.get('struct node') as RecordType
        assert.strictEqual(((node.members![1].type as PointerType).to), node)
        assert.deepStrictEqual((declarations.types.get('point') as RecordType).members!.map((member): string => member.name), ['x', 'y'])
        const shape: RecordType = declarations.tags.get('struct shape') as RecordType
        assert.deepStrictEqual(shape.members!.map((member): string => member.name), ['kind', '_0', '_1', 'name'])
        //Defined after its declaration: the same object, completed
        const later: Declarations = parse('struct later; struct later *make(void); struct later { int a; };')
        assert.strictEqual((later.functions.get('make')!.type.result as PointerType).to, later.tags.get('struct later'))
        assert.strictEqual((later.tags.get('struct later') as RecordType).members!.length, 1)
    })

    it('evaluate the values of the enumerations, and constant expressions', (): void => {
        const declarations: Declarations = parse(`
            enum { CURL_SSLVERSION_TLSv1 = 1, CURL_SSLVERSION_MAX_DEFAULT = (CURL_SSLVERSION_TLSv1 << 16), NEXT };
            typedef enum { CURLINFO_NONE, CURLINFO_EFFECTIVE_URL = 0x100000 + 1, CURLINFO_RESPONSE_CODE = 0x200000 + 2 } CURLINFO;
            enum flags { A = 1u << 31, B = ~0u, C = (unsigned char)300, D = sizeof(long long) * 2, E = 'x', F = 010 | 0b11, G = -1 };
            enum big { H = 0x100000000 };
            static const int LIMIT = 10 * 3;
            struct buffer { char data[LIMIT + 2]; };
        `)
        const constant = (name: string): bigint | undefined => declarations.constants.get(name)
        assert.deepStrictEqual([constant('CURL_SSLVERSION_MAX_DEFAULT'), constant('NEXT')], [65536n, 65537n])
        assert.deepStrictEqual([constant('CURLINFO_NONE'), constant('CURLINFO_RESPONSE_CODE')], [0n, 2097154n])
        assert.deepStrictEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(constant), [2147483648n, 4294967295n, 44n, 16n, 120n, 11n, -1n])
        assert.strictEqual((declarations.tags.get('enum big') as {base: string}).base, 'longlong')
        assert.strictEqual(sizeOf(declarations.tags.get('struct buffer')!, LINUX_X64), 32)
        assert.strictEqual(new DeclarationParser(LINUX_X64, declarations).constant('LIMIT * 2 + NEXT'), 65597n)
    })

    it('ignore the attributes, read the packed and aligned ones, and the labels of __asm', (): void => {
        const declarations: Declarations = parse(`
            __attribute__((availability(macos,introduced=10.7))) __attribute__((availability(ios,introduced=4.0))) const char *sqlite3_sourceid(void);
            extern int deflatePending (void *strm, unsigned *pending, int *bits) __attribute__((availability(macos,introduced=10.10)));
            int curl_mprintf(const char *format, ...) __attribute__((format(printf, 1, 2)));
            __declspec(dllimport) int __stdcall vendor_open(int port);
            extern FILE *fopen(const char * restrict path, const char * restrict mode) __asm("_" "fopen" "$DARWIN_EXTSN");
            struct __attribute__((packed)) packed { char a; int b; };
            struct aligned { char a; int b __attribute__((aligned(8))); };
            [[nodiscard]] int modern(void);
        `, MACOS)
        assert.deepStrictEqual([...declarations.functions.keys()], ['sqlite3_sourceid', 'deflatePending', 'curl_mprintf', 'vendor_open', 'fopen', 'modern'])
        assert.strictEqual(declarations.functions.get('fopen')!.symbol, 'fopen$DARWIN_EXTSN')
        //The labels of glibc have no underscore to remove
        assert.strictEqual(parse('extern int sscanf (const char *s, const char *f, ...) __asm__ ("" "__isoc99_sscanf") __attribute__ ((__nothrow__));').functions.get('sscanf')!.symbol, '__isoc99_sscanf')
        assert.strictEqual(sizeOf(declarations.tags.get('struct packed')!, MACOS), 5)
        assert.strictEqual(layoutOf(declarations.tags.get('struct aligned') as RecordType, MACOS).members[1].offset, 8)
    })

    it('read #pragma pack, its stack, and skip what the preprocessor leaves', (): void => {
        const declarations: Declarations = parse(`
            # 1 "vendor.h"
            #define VENDOR_OK 0
            #include <stdint.h>
            #pragma once
            #pragma pack(push, 1)
            struct frame { uint8_t kind; uint32_t length; };
            #pragma pack(push, 4)
            struct header { uint8_t kind; double stamp; };
            #pragma pack(pop)
            struct inner { uint8_t kind; uint16_t value; };
            #pragma pack(pop)
            struct normal { uint8_t kind; uint32_t length; };
        `)
        const size = (tag: string): number => sizeOf(declarations.tags.get(`struct ${tag}`)!, LINUX_X64)
        assert.deepStrictEqual([size('frame'), size('header'), size('inner'), size('normal')], [5, 12, 3, 8])
    })

    it('expand the macros without arguments: the markers of exported functions, the constants', (): void => {
        const declarations: Declarations = parse(`
            #define SQLITE_API
            #define SQLITE_OK 0 /* Successful result */
            #define SQLITE_ERROR 1
            #define SQLITE_OPEN_READWRITE 0x00000002
            #define FLAGS (SQLITE_OPEN_READWRITE | 4)
            #define ZEXPORT
            #define ZEXTERN extern
            #define NAME_MAX_LEN 64
            #define VERSION "3.54.0"
            #define MAX(a, b) ((a) > (b) ? (a) : (b))
            SQLITE_API int sqlite3_open(const char *filename, void **db);
            ZEXTERN int ZEXPORT deflate(void *strm, int flush);
            struct named { char name[NAME_MAX_LEN]; };
            #undef ZEXPORT
        `)
        assert.deepStrictEqual([...declarations.functions.keys()], ['sqlite3_open', 'deflate'])
        assert.deepStrictEqual(['SQLITE_OK', 'SQLITE_ERROR', 'FLAGS', 'NAME_MAX_LEN'].map((name: string): bigint | undefined => declarations.constants.get(name)), [0n, 1n, 6n, 64n])
        assert.strictEqual(declarations.constants.has('VERSION'), false)
        assert.strictEqual(declarations.macros.get('MAX'), null)
        assert.strictEqual(declarations.macros.has('ZEXPORT'), false)
        assert.strictEqual(sizeOf(declarations.tags.get('struct named')!, LINUX_X64), 64)
        //The macros of the library apply to its prototypes
        assert.strictEqual(new DeclarationParser(LINUX_X64, declarations).prototype('SQLITE_API int sqlite3_close(void *db)').name, 'sqlite3_close')
        assert.match(failure(() => parse('#define MIN(a, b) a\nint x[MIN(1, 2)];')), /The macro MIN takes arguments/)
        assert.match(failure(() => parse('SQLITE_API int f(void);')), /Unknown type SQLITE_API: a macro\? give its #define with the declarations/)
    })

    it('read variables, constants, inline functions and the blocks of C++ headers', (): void => {
        const declarations: Declarations = parse(`
            extern const char sqlite3_version[];
            extern char *sqlite3_temp_directory;
            extern "C" {
                static inline int twice(int x) { return x * 2; }
                int once(int x);
            }
            extern "C" int alone(void);
            _Static_assert(sizeof(int) == 4, "int");
            static int hidden(void);
        `)
        assert.deepStrictEqual([...declarations.functions.keys()], ['once', 'alone'])
        assert.strictEqual(declarations.variables.get('sqlite3_version')!.constant, true)
        assert.strictEqual(typeText(declarations.variables.get('sqlite3_version')!.type), 'char[0]')
        assert.strictEqual(declarations.variables.get('sqlite3_temp_directory')!.constant, false)
    })

    it('read a prototype and a type name with the declarations of a library', (): void => {
        const parser: DeclarationParser = new DeclarationParser(LINUX_X64)
        parser.parse('typedef struct sqlite3 sqlite3; typedef int (*sqlite3_callback)(void *, int, char **, char **);')
        const exec = parser.prototype('int sqlite3_exec(sqlite3 *db, const char *sql, sqlite3_callback callback, void *context, _Out_ char **error)')
        assert.strictEqual(exec.name, 'sqlite3_exec')
        assert.strictEqual(exec.type.parameters[4].direction, 'out')
        assert.strictEqual(parser.prototype('int abs(int);').symbol, 'abs')
        assert.strictEqual(typeText(parser.typeName('const char *')), 'const char *')
        assert.strictEqual(typeText(parser.typeName('struct sqlite3 *[2]')), 'struct sqlite3 *[2]')
    })

    it('refuse what they cannot read, with its line and its column', (): void => {
        assert.match(failure(() => parse('struct x {\n    long double d;\n};')), /long double is not supported \(line 2, column 5\)/)
        assert.match(failure(() => parse('vendor_t open(void);')), /Unknown type vendor_t \(line 1, column 1\)/)
        assert.match(failure(() => parse('int f(handle_t h);')), /Unknown type handle_t \(line 1, column 7\)/)
        assert.match(failure(() => parse('int f(a, b);')), /Unknown type a .*old style/)
        assert.match(failure(() => parse('#ifdef WIN32\nint f(void);\n#endif')), /#ifdef is not supported: run the header through the preprocessor first/)
        assert.match(failure(() => parse('/* open')), /A comment is not closed \(line 1, column 1\)/)
        assert.match(failure(() => parse('enum { A = UNKNOWN_MACRO + 1 };')), /Unknown constant UNKNOWN_MACRO/)
        assert.match(failure(() => parse('struct a { int x; }; struct a { int y; };')), /The struct a is defined again/)
        assert.match(failure(() => parse('__int128 big(void);')), /__int128 is not supported/)
        assert.match(failure(() => parse('struct s { char c; int d __attribute__((aligned(16))); };')), /An alignment of 16 bytes is not supported/)
        assert.match(failure(() => parse('_Thread_local int counter;')), /thread-local/)
        assert.match(failure(() => sizeOf(parse('struct o;').tags.get('struct o')!, LINUX_X64)), /declared but not defined/)
        assert.match(failure(() => sizeOf(parse('struct p { unsigned a : 3; } __attribute__((packed));').tags.get('struct p')!, LINUX_X64)), /bitfield a of a packed struct/)
        assert.match(failure(() => sizeOf(parse('struct w { char a : 9; };').tags.get('struct w')!, LINUX_X64)), /wider than its type/)
    })
})

describe('Real headers', (): void => {

    /**
     * The declarations of the headers of a library, preprocessed by the C compiler of the machine: the lines of its own
     * files only (the system headers they include are left out)
     * @param include
     * @param files the names of its files
     */
    function preprocessed(include: string, files: string[]): string | undefined {
        try {
            const output: string = execFileSync('cc', ['-E', '-x', 'c', '-'], {input: `#include <${include}>\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore']})
            let keep: boolean = false
            const lines: string[] = []
            for (const line of output.split('\n')) {
                const marker: RegExpMatchArray | null = line.match(/^# \d+ "([^"]+)"/)
                if (marker) keep = files.includes(path.basename(marker[1]))
                else if (keep) lines.push(line)
            }
            return lines.join('\n')
        } catch {
            return undefined
        }
    }

    for (const [include, files, minimum] of [['sqlite3.h', ['sqlite3.h'], 250], ['zlib.h', ['zlib.h', 'zconf.h'], 70]] as const) {
        const text: string | undefined = has('cc') ? preprocessed(include, [...files]) : undefined
        it(`read ${include} once preprocessed`, {skip: !text && `${include} cannot be preprocessed here`}, (): void => {
            const declarations: Declarations = parse(text!, platformOf(process.platform, process.arch))
            assert.ok(declarations.functions.size >= minimum, `${declarations.functions.size} functions`)
        })
    }
})

describe('The layout of structs', (): void => {

    /**
     * Structs of plain C (no type of the package) with what a layout depends on: alignments, long, long long, packing,
     * unions, nested structs, bitfields of each rule
     */
    const STRUCTS: string = `
        struct S1 { char a; int b; short c; };
        struct S2 { char a; double b; char c; };
        struct S3 { long a; char b; };
        struct S4 { char a; long long b; };
        struct S5 { short a[3]; char b; struct S1 inner; void *p; };
        union U1 { char a; double b; int c[3]; };
        struct S6 { union U1 u; char c; };
        #pragma pack(push, 2)
        struct P1 { char a; int b; double c; };
        #pragma pack(pop)
        #pragma pack(1)
        struct P2 { char a; short b; long long c; };
        #pragma pack()
        struct P3 { char a; int b; } __attribute__((packed));
        struct A1 { char a; int b __attribute__((aligned(8))); };
        struct B1 { char c; unsigned a : 3; unsigned b : 30; short s : 4; long long x; };
        struct B2 { unsigned a : 1; unsigned : 2; unsigned b : 5; };
        struct B3 { char a; int : 0; char b; };
        struct B4 { unsigned char a : 3; unsigned short b : 9; unsigned int c : 20; };
        struct B5 { int a : 4; char b; int c : 4; };
        struct B6 { long long a : 33; int b : 5; };
        struct B7 { char a; int b : 30; };
        struct Z1 { char a; int : 0; char b; };
        struct Z2 { char a; int : 4; char b; };
        struct Z3 { char a; long long : 0; char b; };
        struct Z5 { int x : 3; long long : 0; char b; };
        struct Z6 { char a; short : 0; };
        struct Z7 { char a; long long : 1; };
        enum E1 { E1A = 1 << 4, E1B = E1A + 1 };
        struct S7 { enum E1 e; char c; };
    `
    const TAGS: string[] = [...STRUCTS.matchAll(/(struct|union) (\w+) \{/g)].map((match: RegExpMatchArray): string => `${match[1]} ${match[2]}`)

    /**
     * The targets of clang and the platforms they are
     */
    const TARGETS: Record<string, Platform> = {
        'arm64-apple-macos': platformOf('darwin', 'arm64'),
        'x86_64-apple-macos': platformOf('darwin', 'x64'),
        'x86_64-linux-gnu': platformOf('linux', 'x64'),
        'aarch64-linux-gnu': platformOf('linux', 'arm64'),
        'i686-linux-gnu': platformOf('linux', 'ia32'),
        'armv7-linux-gnueabihf': platformOf('linux', 'arm'),
        'x86_64-pc-windows-msvc': platformOf('win32', 'x64'),
        'aarch64-pc-windows-msvc': platformOf('win32', 'arm64'),
        'i686-pc-windows-msvc': platformOf('win32', 'ia32')
    }

    it('is the one clang gives for each platform', {skip: !has('clang') && 'clang is not installed'}, (): void => {
        const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-ffi-layout-'))
        try {
            const file: string = path.join(directory, 'layout.c')
            writeFileSync(file, `${STRUCTS}\nint sizes[] = {${TAGS.map((tag: string): string => `sizeof(${tag})`).join(', ')}};\n`)
            for (const [target, platform] of Object.entries(TARGETS)) {
                const output: string = execFileSync('clang', ['-target', target, '-fsyntax-only', '-Xclang', '-fdump-record-layouts-simple', file], {encoding: 'utf8'})
                const clang: Map<string, { size: number, alignment: number, offsets: number[] }> = new Map()
                for (const match of output.matchAll(/Type: ((?:struct|union) \w+)\s[\s\S]*?Size:(\d+)[\s\S]*?Alignment:(\d+)\s+FieldOffsets: \[([^\]]*)\]/g)) {
                    clang.set(match[1], {size: Number(match[2]), alignment: Number(match[3]), offsets: match[4].split(',').filter((offset: string): boolean => offset.trim() !== '').map(Number)})
                }
                const declarations: Declarations = parse(STRUCTS, platform)
                for (const tag of TAGS) {
                    const record: RecordType = declarations.tags.get(tag) as RecordType
                    const expected = clang.get(tag)!
                    const layout = layoutOf(record, platform)
                    assert.strictEqual(layout.size * 8, expected.size, `${target} ${tag} size`)
                    assert.strictEqual(layout.alignment * 8, expected.alignment, `${target} ${tag} alignment`)
                    //The offsets of the members in their order, the bitfields of width 0 left out (they hold nothing)
                    const offsets: number[] = []
                    for (const [index, member] of record.members!.entries()) {
                        if (member.bits === 0) continue
                        const placed = layout.members.find((candidate): boolean => candidate.member === member)!
                        offsets.push(placed.bitOffset ?? placed.offset * 8)
                        assert.strictEqual(offsets[offsets.length - 1], expected.offsets[index], `${target} ${tag} offset of ${member.name || '(unnamed)'}`)
                    }
                }
            }
        } finally {
            rmSync(directory, {recursive: true, force: true})
        }
    })
})

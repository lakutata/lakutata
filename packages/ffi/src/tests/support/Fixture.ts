import {execFileSync, execSync} from 'node:child_process'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'

/**
 * The C library of the tests: what the libraries of the system do not exercise (bitfields, packed structs, callbacks
 * kept and called later, structs by value of each size, unions, variables, strings to free)
 */
export const FIXTURE_SOURCE: string = `
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#define EXPORT __declspec(dllexport)
#else
#define EXPORT __attribute__((visibility("default")))
#endif

struct flags { unsigned ready : 1; unsigned mode : 3; int level : 5; unsigned char tag; uint64_t big : 40; };
EXPORT struct flags flags_make(unsigned ready, unsigned mode, int level, unsigned char tag, uint64_t big) {
    struct flags f;
    memset(&f, 0, sizeof f);
    f.ready = ready; f.mode = mode; f.level = level; f.tag = tag; f.big = big;
    return f;
}
EXPORT int flags_level(const struct flags *f) { return f->level; }
EXPORT uint64_t flags_big(struct flags f) { return f.big; }
EXPORT void flags_bump(struct flags *f) { f->mode = (f->mode + 1) & 7; f->level -= 1; }
EXPORT void flags_fill(struct flags *f) { memset(f, 0, sizeof *f); f->ready = 1; f->mode = 5; f->level = -3; f->tag = 9; }

#pragma pack(push, 1)
struct packed { char a; int32_t b; int16_t c; };
#pragma pack(pop)
EXPORT int32_t packed_sum(struct packed p) { return p.a + p.b + p.c; }
EXPORT void packed_fill(struct packed *p) { p->a = 1; p->b = 2; p->c = 3; }

typedef void (*logger_t)(int level, const char *message);
static logger_t stored;
EXPORT void set_logger(logger_t logger) { stored = logger; }
EXPORT int log_now(int level, const char *message) { if (!stored) return 0; stored(level, message); return 1; }

typedef int64_t (*mapper_t)(int64_t value);
EXPORT int64_t apply_mapper(mapper_t mapper, int64_t value) { return mapper(value); }

struct s3 { uint8_t a[3]; };
struct s12 { float x, y, z; };
struct s16 { double x, y; };
struct s24 { uint64_t a, b, c; };
EXPORT struct s3 s3_make(uint8_t v) { struct s3 s = {{v, (uint8_t)(v + 1), (uint8_t)(v + 2)}}; return s; }
EXPORT struct s12 s12_make(float v) { struct s12 s = {v, v * 2, v * 3}; return s; }
EXPORT struct s16 s16_make(double v) { struct s16 s = {v, -v}; return s; }
EXPORT struct s24 s24_make(uint64_t v) { struct s24 s = {v, v + 1, v + 2}; return s; }
EXPORT double s16_sum(struct s16 s) { return s.x + s.y; }

union number { int32_t i; float f; uint8_t bytes[4]; };
EXPORT int32_t number_int(union number n) { return n.i; }

struct samples { int32_t values[4]; double scale; int64_t totals[2]; };
EXPORT struct samples samples_make(int32_t start) {
    struct samples s = {{start, start + 1, start + 2, start + 3}, 0.5, {start * 10LL, 9007199254740993LL}};
    return s;
}
EXPORT int32_t samples_sum(const struct samples *s) { return s->values[0] + s->values[1] + s->values[2] + s->values[3]; }

EXPORT int64_t big_negate(int64_t v) { return -v; }
EXPORT size_t big_size(void) { return 42; }
EXPORT void big_out(int64_t *out) { *out = 9007199254740993LL; }

EXPORT const char fixture_version[] = "1.0";
EXPORT int fixture_counter = 5;

static int frees;
EXPORT char *fixture_dup(const char *s) { char *d = malloc(strlen(s) + 1); strcpy(d, s); return d; }
EXPORT void fixture_dup_out(const char *s, char **out) { *out = fixture_dup(s); }
EXPORT void fixture_free(void *p) { frees++; free(p); }
EXPORT int fixture_frees(void) { return frees; }

struct node { int value; struct node *next; };
EXPORT struct node *list_make(int count) {
    struct node *head = 0;
    for (int i = count; i > 0; i--) { struct node *n = malloc(sizeof *n); n->value = i; n->next = head; head = n; }
    return head;
}
EXPORT void list_free(struct node *head) { while (head) { struct node *next = head->next; free(head); head = next; } }
`

/**
 * The declarations of the fixture, as a user gives them
 */
export const FIXTURE_DECLARATIONS: string = `
struct flags { unsigned ready : 1; unsigned mode : 3; int level : 5; unsigned char tag; uint64_t big : 40; };
#pragma pack(push, 1)
struct packed { char a; int32_t b; int16_t c; };
#pragma pack(pop)
typedef void (*logger_t)(int level, const char *message);
typedef int64_t (*mapper_t)(int64_t value);
struct s3 { uint8_t a[3]; };
struct s12 { float x, y, z; };
struct s16 { double x, y; };
struct s24 { uint64_t a, b, c; };
union number { int32_t i; float f; uint8_t bytes[4]; };
struct samples { int32_t values[4]; double scale; int64_t totals[2]; };
struct node { int value; struct node *next; };
extern const char fixture_version[];
extern int fixture_counter;
`

/**
 * Remove the directory of the fixture: on Windows, a DLL just unloaded can stay locked for a while (by the system, by an
 * antivirus): retried, and left to the temporary directory if it is still locked
 * @param library
 */
export function removeFixture(library: string): void {
    try {
        rmSync(path.dirname(library), {recursive: true, force: true, maxRetries: 10, retryDelay: 200})
    } catch (error) {
        if (process.platform !== 'win32') throw error
    }
}

/**
 * The fixture compiled by the C compiler of the machine (cc; on Windows, cl of the Visual Studio Build Tools, for the
 * architecture of the process), in a directory of its own; undefined when there is none
 */
export function compileFixture(): string | undefined {
    const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-ffi-fixture-'))
    const source: string = path.join(directory, 'fixture.c')
    const library: string = path.join(directory, process.platform === 'darwin' ? 'libfixture.dylib' : process.platform === 'win32' ? 'fixture.dll' : 'libfixture.so')
    writeFileSync(source, FIXTURE_SOURCE)
    try {
        if (process.platform === 'win32') {
            const vswhere: string = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
            const installation: string = execFileSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath']).toString().trim()
            const vcvars: string = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat')
            execSync(`"${vcvars}" ${process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'x86' : 'x64'} >nul && cl /nologo /LD /O1 /Fe"${library}" /Fo"${path.join(directory, 'fixture.obj')}" "${source}"`, {stdio: 'ignore', cwd: directory})
        } else {
            execFileSync('cc', ['-shared', '-fPIC', '-O1', '-o', library, source], {stdio: 'ignore'})
        }
        return library
    } catch {
        return undefined
    }
}

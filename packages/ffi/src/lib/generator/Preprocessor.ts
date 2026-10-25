import {spawnSync, type SpawnSyncReturns} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {devNull, tmpdir} from 'node:os'
import path from 'node:path'
import {NativeDeclarationException} from '../../exceptions/NativeDeclarationException.js'

/**
 * How a header is run through the preprocessor
 */
export interface PreprocessOptions {
    /**
     * The header
     */
    readonly header: string
    /**
     * The compiler whose preprocessor is run: cc, gcc, clang (their -E -dD), or cl, clang-cl (cl /P /d1PP)
     */
    readonly compiler?: string
    /**
     * The directories of the headers it includes
     */
    readonly include?: readonly string[]
    /**
     * The macros defined before it: NAME, or NAME=VALUE
     */
    readonly define?: readonly string[]
}

/**
 * A header run through the preprocessor
 */
export interface PreprocessedHeader {
    /**
     * The output of the preprocessor: the declarations, the #define kept, the line markers naming the files
     */
    readonly text: string
    /**
     * The header, as the line markers name it
     */
    readonly header: string
    /**
     * The directories of the headers of the system: their headers are not the ones of the library
     */
    readonly systemDirectories: readonly string[]
    /**
     * The command run
     */
    readonly command: string
}

/**
 * The C compiler whose preprocessor reads the headers by default: the one of the CC variable, else cl on Windows (run
 * in the Developer Command Prompt of Visual Studio), cc elsewhere.
 * @returns The command of the compiler.
 * @example
 * ```typescript
 * import {defaultCompiler} from '@lakutata/ffi/generator'
 *
 * console.log(defaultCompiler())
 * ```
 */
export function defaultCompiler(): string {
    return process.env.CC?.trim() || (process.platform === 'win32' ? 'cl' : 'cc')
}

/**
 * Whether a compiler takes the options of Microsoft (cl, clang-cl)
 * @param compiler
 */
function microsoft(compiler: string): boolean {
    return /^(?:cl|clang-cl)(?:\.exe)?$/i.test(path.basename(compiler))
}

/**
 * Run a compiler: its output, its errors
 * @param compiler
 * @param args
 */
function run(compiler: string, args: string[]): { stdout: string, stderr: string, status: number | null } {
    const result: SpawnSyncReturns<string> = spawnSync(compiler, args, {encoding: 'latin1', maxBuffer: 1 << 30, windowsHide: true})
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        throw new NativeDeclarationException(microsoft(compiler)
            ? `The compiler ${compiler} is not found: run in the Developer Command Prompt (or PowerShell) of Visual Studio, or give another compiler`
            : `The compiler ${compiler} is not found: install a C compiler (the Command Line Tools of Xcode, gcc, clang), or give another one`)
    }
    if (result.error) throw result.error
    return {stdout: result.stdout, stderr: result.stderr, status: result.status}
}

/**
 * The directories of the headers of the system of GCC and Clang, as -v lists them (without the ones given by -I)
 * @param compiler
 */
function systemDirectoriesOf(compiler: string): string[] {
    const {stdout, stderr} = run(compiler, ['-E', '-v', '-x', 'c', devNull])
    const lines: string[] = `${stdout}\n${stderr}`.split(/\r?\n/)
    const start: number = lines.findIndex((line: string): boolean => line.startsWith('#include <...> search starts here'))
    const end: number = lines.findIndex((line: string, index: number): boolean => index > start && line.startsWith('End of search list'))
    if (start < 0 || end < 0) return []
    return lines.slice(start + 1, end).map((line: string): string => path.resolve(line.replace(/\(framework directory\)$/, '').trim()))
}

/**
 * Run a header through the preprocessor of a compiler, keeping its #define and the line markers naming the files.
 * @param options The header, the compiler, the directories and the macros.
 * @returns The output, the header as the line markers name it, the directories of the system.
 */
export function preprocessHeader(options: PreprocessOptions): PreprocessedHeader {
    const header: string = path.resolve(options.header)
    const compiler: string = options.compiler ?? defaultCompiler()
    const include: readonly string[] = (options.include ?? []).map((directory: string): string => path.resolve(directory))
    const define: readonly string[] = options.define ?? []
    if (microsoft(compiler)) {
        //cl /P writes a file; /d1PP keeps the #define in it
        const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-ffi-preprocess-'))
        const output: string = path.join(directory, 'header.i')
        const args: string[] = ['/nologo', '/P', '/TC', '/d1PP', `/Fi${output}`, ...include.map((dir: string): string => `/I${dir}`), ...define.map((macro: string): string => `/D${macro}`), header]
        try {
            const {stderr, status} = run(compiler, args)
            if (status !== 0) throw new NativeDeclarationException(`The preprocessor failed (${compiler} ${args.join(' ')}): ${stderr.trim()}`)
            const systemDirectories: string[] = (process.env.INCLUDE ?? '').split(';').filter(Boolean).map((dir: string): string => path.resolve(dir))
            return {text: readFileSync(output, 'latin1'), header: header, systemDirectories: systemDirectories, command: [compiler, ...args.filter((arg: string): boolean => !arg.startsWith('/Fi'))].join(' ')}
        } finally {
            rmSync(directory, {recursive: true, force: true})
        }
    }
    const args: string[] = ['-E', '-dD', '-x', 'c', ...include.map((dir: string): string => `-I${dir}`), ...define.map((macro: string): string => `-D${macro}`), header]
    const {stdout, stderr, status} = run(compiler, args)
    if (status !== 0) throw new NativeDeclarationException(`The preprocessor failed (${compiler} ${args.join(' ')}): ${stderr.trim()}`)
    return {text: stdout, header: header, systemDirectories: systemDirectoriesOf(compiler), command: [compiler, ...args].join(' ')}
}

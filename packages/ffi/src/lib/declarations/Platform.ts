/**
 * What the sizes of the C types and the layout of the structs depend on
 */
export interface Platform {
    /**
     * The operating system, as process.platform names it
     */
    readonly os: string
    /**
     * The architecture, as process.arch names it
     */
    readonly arch: string
    /**
     * The size of a pointer (and of size_t), in bytes
     */
    readonly pointerSize: 4 | 8
    /**
     * The size of long: 8 on 64-bit Unix systems (LP64), 4 on Windows (LLP64) and on 32-bit systems
     */
    readonly longSize: 4 | 8
    /**
     * The size of wchar_t: 2 on Windows, 4 elsewhere
     */
    readonly wcharSize: 2 | 4
    /**
     * The alignment of the 8-byte types (long long, double) as members: 4 on 32-bit Linux (i386), 8 elsewhere
     */
    readonly int64Alignment: 4 | 8
    /**
     * How bitfields are laid out: by the rules of GCC and Clang (sysv), of the ARM procedure call standard where the
     * type of every bitfield aligns the struct, the unnamed and the empty ones too (aapcs: ARM but on Apple systems), or
     * of the compiler of Microsoft (msvc)
     */
    readonly bitfields: 'sysv' | 'aapcs' | 'msvc'
    /**
     * Whether the symbols of the C functions start with an underscore in the binaries (macOS): the labels of __asm
     * name them so
     */
    readonly underscoredSymbols: boolean
}

/**
 * The platform of a system and an architecture
 * @param os
 * @param arch
 */
export function platformOf(os: string, arch: string): Platform {
    const bits64: boolean = !['ia32', 'arm', 'x32'].includes(arch)
    const windows: boolean = os === 'win32'
    return {
        os: os,
        arch: arch,
        pointerSize: bits64 ? 8 : 4,
        longSize: bits64 && !windows ? 8 : 4,
        wcharSize: windows ? 2 : 4,
        int64Alignment: !bits64 && !windows && arch === 'ia32' ? 4 : 8,
        bitfields: windows ? 'msvc' : (arch === 'arm' || arch === 'arm64') && os !== 'darwin' ? 'aapcs' : 'sysv',
        underscoredSymbols: os === 'darwin'
    }
}

/**
 * The platform the process runs on
 */
export const CURRENT_PLATFORM: Platform = platformOf(process.platform, process.arch)

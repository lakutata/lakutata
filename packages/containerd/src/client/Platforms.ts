import {readdirSync, readFileSync} from 'node:fs'
import path from 'node:path'

/**
 * A platform of the images (OCI): its system, its architecture, its variant
 */
export type Platform = {
    os: string
    architecture: string
    variant?: string
}

/**
 * The architectures of OCI of the ones of Node.js
 */
const ARCHITECTURES: Readonly<Record<string, string>> = {
    x64: 'amd64',
    arm64: 'arm64',
    arm: 'arm',
    ia32: '386',
    ppc64: 'ppc64le',
    s390x: 's390x',
    riscv64: 'riscv64',
    loong64: 'loong64',
    mips64el: 'mips64le'
}

/**
 * The platforms of the ELF binaries an entry of binfmt_misc runs (by the machine of the ELF header of its magic): the
 * emulators of QEMU, Rosetta, whatever their names
 * @param entry the content of the entry
 */
export function BinfmtPlatforms(entry: string): Platform[] {
    if (!/^enabled$/m.test(entry)) return []
    const offset: string | undefined = entry.match(/^offset (\d+)$/m)?.[1]
    const magic: string | undefined = entry.match(/^magic ([0-9a-f]+)$/m)?.[1]
    if (!magic || (offset && offset !== '0')) return []
    const bytes: Buffer = Buffer.from(magic, 'hex')
    if (bytes.length < 20 || bytes.readUInt32BE(0) !== 0x7f454c46) return []
    const bits64: boolean = bytes[4] === 2
    const little: boolean = bytes[5] === 1
    const machine: number = little ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18)
    const linux = (architecture: string, variant?: string): Platform => ({os: 'linux', architecture: architecture, variant: variant})
    switch (machine) {
        case 0x3e:
            return [linux('amd64')]
        case 0x03:
            return [linux('386')]
        case 0xb7:
            return [linux('arm64', 'v8')]
        case 0x28:
            return little ? [linux('arm', 'v7'), linux('arm', 'v6'), linux('arm', 'v5')] : []
        case 0xf3:
            return bits64 ? [linux('riscv64')] : []
        case 0x15:
            return bits64 ? [linux(little ? 'ppc64le' : 'ppc64')] : []
        case 0x16:
            return [linux('s390x')]
        case 0x08:
            return [linux(bits64 ? (little ? 'mips64le' : 'mips64') : (little ? 'mipsle' : 'mips'))]
        case 0x102:
            return [linux('loong64')]
        default:
            return []
    }
}

/**
 * A platform written as OCI writes it (linux/arm64/v8)
 * @param platform
 */
export function FormatPlatform(platform: Platform): string {
    return [platform.os, platform.architecture, platform.variant].filter(Boolean).join('/')
}

/**
 * The variant of an architecture given without it: the one its images are matched to (arm64 is v8, arm v7)
 * @param platform
 */
export function NormalizePlatform(platform: Platform): Platform {
    const architecture: string = ({x86_64: 'amd64', aarch64: 'arm64', armhf: 'arm', armel: 'arm', i386: '386'} as Record<string, string>)[platform.architecture] ?? platform.architecture
    let variant: string | undefined = platform.variant || undefined
    if (architecture === 'arm64' && !variant) variant = 'v8'
    if (architecture === 'arm' && !variant) variant = 'v7'
    return {os: platform.os || 'linux', architecture: architecture, variant: variant}
}

/**
 * Parse a platform: linux/arm64, linux/arm/v7, or an architecture (arm64), on Linux
 * @param value
 */
export function ParsePlatform(value: string): Platform {
    const parts: string[] = value.trim().toLowerCase().split('/').filter(Boolean)
    if (!parts.length || parts.length > 3) throw new Error(`The platform "${value}" is not valid (linux/arm64, linux/arm/v7)`)
    const [os, architecture, variant] = parts.length === 1 ? ['linux', parts[0], undefined] : parts
    return NormalizePlatform({os: os, architecture: architecture, variant: variant})
}

/**
 * The platform of the machine running Node.js
 */
export function HostPlatform(): Platform {
    const architecture: string = ARCHITECTURES[process.arch] ?? process.arch
    const arm: unknown = (process.config.variables as Record<string, unknown>).arm_version
    return NormalizePlatform({os: process.platform === 'win32' ? 'windows' : process.platform, architecture: architecture, variant: architecture === 'arm' && arm ? `v${arm}` : undefined})
}

/**
 * Whether a platform of an image runs on a platform: the same system and architecture, a variant up to the one of the
 * platform (an arm/v7 runs the images of arm/v6 and arm/v5)
 * @param image
 * @param platform
 */
export function MatchPlatform(image: Platform, platform: Platform): boolean {
    const [a, b] = [NormalizePlatform(image), NormalizePlatform(platform)]
    if (a.os !== b.os || a.architecture !== b.architecture) return false
    if (a.architecture === 'arm') return Number(a.variant?.slice(1) ?? 7) <= Number(b.variant?.slice(1) ?? 7)
    return (a.variant ?? '') === (b.variant ?? '')
}

/**
 * How much a platform of an image suits a platform: the exact one first (lower is better), undefined when it does not
 * run there
 * @param image
 * @param platform
 */
export function PlatformRank(image: Platform, platform: Platform): number | undefined {
    if (!MatchPlatform(image, platform)) return undefined
    const [a, b] = [NormalizePlatform(image), NormalizePlatform(platform)]
    return a.architecture === 'arm' ? Number(b.variant?.slice(1) ?? 7) - Number(a.variant?.slice(1) ?? 7) : 0
}

/**
 * The platforms the machine runs the containers of: its own one, and the ones of the emulators registered in
 * binfmt_misc (enabled)
 * @param binfmt the directory of binfmt_misc
 */
export function SupportedPlatforms(binfmt: string = '/proc/sys/fs/binfmt_misc'): Platform[] {
    const platforms: Platform[] = [HostPlatform()]
    //The machines of x64 run the ones of 386
    if (platforms[0].architecture === 'amd64') platforms.push({os: 'linux', architecture: '386'})
    let entries: string[] = []
    try {
        entries = readdirSync(binfmt)
    } catch {
        //No binfmt_misc
    }
    for (const entry of entries) {
        if (entry === 'status' || entry === 'register') continue
        let emulated: Platform[]
        try {
            emulated = BinfmtPlatforms(readFileSync(path.join(binfmt, entry), 'utf8'))
        } catch {
            continue
        }
        for (const platform of emulated) if (!platforms.some((known: Platform): boolean => FormatPlatform(known) === FormatPlatform(platform))) platforms.push(platform)
    }
    return platforms
}

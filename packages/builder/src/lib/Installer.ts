import {readFile, mkdtemp, mkdir, rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {ProgramName} from './Bundle.js'
import {BuildExecutable, type ExecutableResult} from './Executable.js'
import {Libc} from './Platform.js'
import {BuildLinuxPackages, LINUX_TARGETS, type LinuxTarget} from './linux/Linux.js'

/**
 * The service an installer registers (systemd, OpenRC): the application runs at the start of the system
 */
export type ServiceOptions = {
    /**
     * The name of the service, the one of the package by default
     */
    name?: string
    description?: string
    /**
     * The arguments of the application
     */
    args?: string[]
    /**
     * Its environment, written to the environment file of the service (/etc/<name>/<name>.env), which the
     * administrators change: MODE=production by default
     */
    env?: Record<string, string>
    /**
     * The user running it: a system user named after the package by default (created by the installer), or root
     */
    user?: string
    /**
     * Whether it is started again when it exits: on-failure (by default), always or no
     */
    restart?: 'on-failure' | 'always' | 'no'
    /**
     * Whether it is enabled and started by the installation (by default), or by the administrators
     */
    autoStart?: boolean
}

/**
 * The installers of an application, declared by the "lakutata.installer" of its package.json (as the configuration of
 * electron-builder)
 */
export type InstallerConfig = {
    /**
     * The name of the package (lower case), the one of the program by default
     */
    name?: string
    /**
     * The description, the maintainer, the home page and the license: the ones of the package.json by default
     */
    description?: string
    maintainer?: string
    homepage?: string
    license?: string
    vendor?: string
    /**
     * The runtime of the executable: node (by default) or bun
     */
    runtime?: 'node' | 'bun'
    /**
     * Whether the program is in the PATH of the system (/usr/bin/<program>), by default
     */
    addToPath?: boolean
    /**
     * The service of the application, none by default
     */
    service?: boolean | ServiceOptions
    linux?: {
        /**
         * The packages: deb, rpm and tar.gz on the systems of the glibc, apk and tar.gz on the ones of musl (Alpine) by
         * default
         */
        targets?: LinuxTarget[]
        /**
         * The packages of the system it needs
         */
        depends?: string[]
        recommends?: string[]
        section?: string
        priority?: string
    }
}

export type InstallerOptions = {
    /**
     * The directory of the project (its package.json)
     */
    project: string
    entry?: string
    minify?: boolean
    external?: string[]
    /**
     * The packages made, the ones of the configuration by default
     */
    targets?: string[]
    /**
     * The directory of the packages, dist/installer by default
     */
    outdir?: string
}

export type InstallerResult = {
    name: string
    version: string
    /**
     * The packages made
     */
    files: { target: string, file: string, size: number }[]
    /**
     * The executable they install
     */
    executable: ExecutableResult
    warnings: string[]
}

/**
 * What an installer installs, resolved from the configuration
 */
export type InstallerPlan = {
    /**
     * The name of the package, of the program, the version
     */
    name: string
    program: string
    version: string
    description: string
    maintainer: string
    homepage?: string
    license?: string
    vendor?: string
    addToPath: boolean
    service?: Required<Omit<ServiceOptions, 'description'>> & { description: string }
    /**
     * The packages of the system it needs and recommends, its section and its priority (deb)
     */
    depends: string[]
    recommends: string[]
    section?: string
    priority?: string
    /**
     * The directory of the executable, its native addons and its resources
     */
    directory: string
    /**
     * Where it is installed (/opt/<name>)
     */
    prefix: string
}

/**
 * The maintainer of the package.json: its author
 * @param author
 */
function Author(author: unknown): string | undefined {
    if (typeof author === 'string' && author.trim()) return author.trim()
    if (author && typeof author === 'object' && typeof (author as { name?: unknown }).name === 'string') {
        const {name, email} = author as { name: string, email?: string }
        return email ? `${name} <${email}>` : name
    }
    return undefined
}

/**
 * The configuration of the installers of a project, checked
 * @param manifest
 */
function Config(manifest: Record<string, any>): InstallerConfig {
    const config: unknown = manifest.lakutata?.installer ?? {}
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('The installers of the application (lakutata.installer of its package.json) must be an object')
    return config as InstallerConfig
}

/**
 * Make the installers of the application for the platform it is made on (the installers of the other platforms are
 * made on them, as its executables): its executable in a directory, with its native addons and its resources, installed
 * in /opt/<name>, its program in the PATH, its service registered
 * @param options
 */
export async function BuildInstaller(options: InstallerOptions): Promise<InstallerResult> {
    const project: string = path.resolve(options.project)
    const manifest: Record<string, any> = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'))
    const config: InstallerConfig = Config(manifest)
    if (process.platform !== 'linux') throw new Error(`The installers of ${process.platform} are not supported yet: the ones of Linux are made on Linux`)
    const libc: 'glibc' | 'musl' | undefined = Libc()
    const targets: string[] = options.targets?.length ? options.targets : config.linux?.targets ?? (libc === 'glibc' ? ['deb', 'rpm', 'tar.gz'] : ['apk', 'tar.gz'])
    for (const target of targets) {
        if (!LINUX_TARGETS.includes(target as LinuxTarget)) throw new Error(`The installer ${target} is not one of Linux (${LINUX_TARGETS.join(', ')})`)
        //The executable links the C library of the system it is made on
        if (target === 'apk' && libc !== 'musl') throw new Error('The apk packages are made on Alpine (musl): the executables made on the systems of the glibc do not run there')
        if (['deb', 'rpm', 'archlinux'].includes(target) && libc !== 'glibc') throw new Error(`The ${target} packages are made on a system of the glibc: the executables made on Alpine (musl) do not run there`)
    }
    const program: string = ProgramName(manifest)
    const name: string = config.name ?? program.toLowerCase()
    if (!/^[a-z0-9][a-z0-9+.-]*$/.test(name)) throw new Error(`The name of the package "${name}" must be lower case letters, digits, "+", "-" and "." (lakutata.installer.name)`)
    const version: string = String(manifest.version ?? '')
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`The version of the package "${version}" must be a version (1.2.3) of the package.json`)
    const warnings: string[] = []
    let maintainer: string | undefined = config.maintainer ?? Author(manifest.author)
    if (!maintainer) {
        maintainer = name
        warnings.push(`The packages have no maintainer: give it (the author of the package.json, or lakutata.installer.maintainer)`)
    }
    const service: ServiceOptions | undefined = config.service === true ? {} : config.service || undefined
    if (service?.name !== undefined && !/^[A-Za-z0-9_.@-]+$/.test(service.name)) throw new Error(`The name of the service "${service.name}" must be letters, digits, "_", ".", "@" and "-"`)
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-installer-'))
    try {
        const executable: ExecutableResult = await BuildExecutable({
            project: project,
            entry: options.entry,
            minify: options.minify,
            external: options.external,
            runtime: config.runtime,
            layout: 'directory',
            outdir: path.join(work, 'stage')
        })
        warnings.push(...executable.warnings)
        const plan: InstallerPlan = {
            name: name,
            program: program,
            version: version,
            description: config.description ?? manifest.description ?? name,
            maintainer: maintainer,
            homepage: config.homepage ?? (typeof manifest.homepage === 'string' ? manifest.homepage : undefined),
            license: config.license ?? (typeof manifest.license === 'string' ? manifest.license : undefined),
            vendor: config.vendor,
            addToPath: config.addToPath ?? true,
            depends: config.linux?.depends ?? [],
            recommends: config.linux?.recommends ?? [],
            section: config.linux?.section,
            priority: config.linux?.priority,
            service: service && {
                name: service.name ?? name,
                description: service.description ?? config.description ?? manifest.description ?? name,
                args: service.args ?? [],
                env: {MODE: 'production', ...service.env},
                user: service.user ?? name,
                restart: service.restart ?? 'on-failure',
                autoStart: service.autoStart ?? true
            },
            directory: executable.directory!,
            prefix: `/opt/${name}`
        }
        const outdir: string = path.resolve(project, options.outdir ?? path.join('dist', 'installer'))
        await mkdir(outdir, {recursive: true})
        const files = await BuildLinuxPackages(plan, targets as LinuxTarget[], path.join(work, 'linux'), outdir)
        return {name: name, version: version, files: files, executable: executable, warnings: warnings}
    } finally {
        await rm(work, {recursive: true, force: true})
    }
}

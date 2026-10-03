import {lstatSync, readdirSync, readlinkSync} from 'node:fs'
import {stat, mkdir, writeFile, rm} from 'node:fs/promises'
import path from 'node:path'
import {ArchiveDirectory} from '../Archive.js'
import {Run} from '../Processes.js'
import {EnsureTool} from '../Tools.js'
import type {InstallerPlan} from '../Installer.js'
import {EmbeddedShell, INSTALLER_HOOKS, NATIVE_HOOKS, type InstallerHook, type NativeHook, type ScriptFile, type TargetScripts} from '../Scripts.js'

/**
 * The packages of Linux: the ones of nFPM, and the archive of the directory of the executable
 */
export const LINUX_TARGETS = ['deb', 'rpm', 'apk', 'archlinux', 'tar.gz'] as const

export type LinuxTarget = typeof LINUX_TARGETS[number]

type Service = NonNullable<InstallerPlan['service']>

/**
 * The libraries of the system the executables load (Node.js and Bun are linked with the C++ library), by package
 */
const RUNTIME_DEPENDS: Record<Exclude<LinuxTarget, 'tar.gz'>, string[]> = {
    deb: ['libstdc++6', 'libgcc-s1'],
    rpm: ['libstdc++', 'libgcc'],
    apk: ['libstdc++', 'libgcc'],
    archlinux: ['gcc-libs']
}

/**
 * The architecture of the packages (the one of Go, which nFPM translates for each package)
 */
function Arch(): string {
    return ({x64: 'amd64', arm64: 'arm64', ia32: '386', arm: 'arm7'} as Record<string, string>)[process.arch] ?? process.arch
}

/**
 * A path given to nFPM as its source: nFPM reads the sources as globs, their characters of the globs escaped (the
 * chunks of Turbopack are named [root-of-the-server]__…)
 * @param file
 */
function Literal(file: string): string {
    return file.replace(/[*?[\]{}\\]/g, '\\$&')
}

/**
 * The contents of a package installing a directory: its files, and its links as links (the links of the native tree,
 * which may point to their parents: nFPM does not keep them in the trees it reads)
 * @param directory
 * @param prefix where it is installed
 */
function Contents(directory: string, prefix: string): Record<string, unknown>[] {
    const contents: Record<string, unknown>[] = []
    const walk = (current: string, at: string): void => {
        for (const entry of readdirSync(current, {withFileTypes: true})) {
            const file: string = path.join(current, entry.name)
            const target: string = `${at}/${entry.name}`
            //The link to the installed path (nFPM makes directories of the links to their parents)
            if (entry.isSymbolicLink()) contents.push({src: path.posix.resolve(at, readlinkSync(file).split(path.sep).join('/')), dst: target, type: 'symlink'})
            else if (entry.isDirectory()) {
                //Owned by the package (rpm removes them with it)
                contents.push({dst: target, type: 'dir', file_info: {mode: lstatSync(file).mode & 0o777}})
                walk(file, target)
            }
            else contents.push({src: Literal(file), dst: target, file_info: {mode: lstatSync(file).mode & 0o777}})
        }
    }
    contents.push({dst: prefix, type: 'dir', file_info: {mode: 0o755}})
    walk(directory, prefix)
    return contents
}

/**
 * The file of a package, named as its system names them
 * @param plan
 * @param target
 */
function PackageFile(plan: InstallerPlan, target: Exclude<LinuxTarget, 'tar.gz'>): string {
    const arch: string = ({x64: 'x86_64', arm64: 'aarch64'} as Record<string, string>)[process.arch] ?? process.arch
    switch (target) {
        case 'deb':
            return `${plan.name}_${plan.version}_${Arch()}.deb`
        case 'rpm':
            return `${plan.name}-${plan.version}-1.${arch}.rpm`
        case 'apk':
            return `${plan.name}-${plan.version}-r0.${arch}.apk`
        case 'archlinux':
            return `${plan.name}-${plan.version}-1-${arch}.pkg.tar.zst`
    }
}

/**
 * A value in double quotes, as systemd and sh read them
 * @param value
 */
function DoubleQuoted(value: string): string {
    return `"${value.replace(/[\\"$`]/g, '\\$&')}"`
}

/**
 * A value in single quotes, as sh reads them
 * @param value
 */
function SingleQuoted(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * The environment file of the service: its variables, which the administrators change (kept by the upgrades)
 * @param service
 */
function EnvironmentFile(service: Service): string {
    return `# The environment of the service ${service.name}, read when it starts (systemctl restart ${service.name})\n${Object.entries(service.env).map(([name, value]: [string, string]): string => `${name}=${DoubleQuoted(value)}`).join('\n')}\n`
}

/**
 * The unit of systemd of the service
 * @param plan
 * @param service
 */
function SystemdUnit(plan: InstallerPlan, service: Service): string {
    const root: boolean = service.user === 'root'
    return [
        '[Unit]',
        `Description=${service.description}`,
        'After=network-online.target',
        'Wants=network-online.target',
        '',
        '[Service]',
        'Type=simple',
        `ExecStart=${[`${plan.prefix}/${plan.program}`, ...service.args].map(DoubleQuoted).join(' ')}`,
        ...root ? [] : [`User=${service.user}`, `Group=${service.user}`],
        `EnvironmentFile=-/etc/${plan.name}/${plan.name}.env`,
        //Its data: /var/lib/<name>, owned by its user
        `StateDirectory=${plan.name}`,
        `WorkingDirectory=/var/lib/${plan.name}`,
        `Restart=${service.restart}`,
        'RestartSec=5',
        //The application ends gracefully on SIGTERM
        'KillSignal=SIGTERM',
        'TimeoutStopSec=30',
        '',
        '[Install]',
        'WantedBy=multi-user.target',
        ''
    ].join('\n')
}

/**
 * The script of OpenRC of the service (Alpine)
 * @param plan
 * @param service
 */
function OpenRCScript(plan: InstallerPlan, service: Service): string {
    const root: boolean = service.user === 'root'
    const environment: string = `/etc/${plan.name}/${plan.name}.env`
    return [
        '#!/sbin/openrc-run',
        `description=${DoubleQuoted(service.description)}`,
        `command=${DoubleQuoted(`${plan.prefix}/${plan.program}`)}`,
        `command_args=${DoubleQuoted(service.args.map(SingleQuoted).join(' '))}`,
        ...root ? [] : [`command_user="${service.user}:${service.user}"`],
        `directory="/var/lib/${plan.name}"`,
        ...service.restart === 'no' ? ['command_background="yes"', 'pidfile="/run/${RC_SVCNAME}.pid"'] : ['supervisor="supervise-daemon"', 'respawn_delay=5'],
        `output_log="/var/log/${plan.name}.log"`,
        `error_log="/var/log/${plan.name}.log"`,
        '',
        'depend() {',
        '    need net',
        '}',
        '',
        'start_pre() {',
        `    checkpath --directory${root ? '' : ` --owner ${service.user}:${service.user}`} --mode 0750 /var/lib/${plan.name}`,
        `    checkpath --file${root ? '' : ` --owner ${service.user}:${service.user}`} --mode 0640 /var/log/${plan.name}.log`,
        `    if [ -f ${environment} ]; then set -a; . ${environment}; set +a; fi`,
        '}',
        ''
    ].join('\n')
}

/**
 * The parts of the scripts of a package managing the service: its user created before the installation; the service
 * enabled and started after it, restarted by the upgrades, stopped and disabled before the removal. The ones run before
 * the scripts of the application (its user, the service stopped), and the ones run after them (the service started)
 * @param plan
 * @param target
 */
function ServiceScripts(plan: InstallerPlan, target: LinuxTarget): { before: Partial<Record<NativeHook, string[]>>, after: Partial<Record<NativeHook, string[]>> } {
    const service: Service | undefined = plan.service
    const before: Partial<Record<NativeHook, string[]>> = {}
    const after: Partial<Record<NativeHook, string[]>> = {}
    if (!service) return {before: before, after: after}
    const unit: string = `${service.name}.service`
    if (service.user !== 'root') {
        before.preinstall = [
            `if ! id -u ${service.user} >/dev/null 2>&1; then`,
            '    if command -v useradd >/dev/null 2>&1; then',
            `        useradd --system --user-group --home-dir /var/lib/${plan.name} --no-create-home --shell "$(command -v nologin || echo /bin/false)" ${service.user}`,
            '    else',
            `        addgroup -S ${service.user} 2>/dev/null || true`,
            `        adduser -S -D -H -h /var/lib/${plan.name} -s /sbin/nologin -G ${service.user} ${service.user}`,
            '    fi',
            'fi'
        ]
    }
    if (target === 'apk') {
        after.postinstall = [
            'if command -v rc-update >/dev/null 2>&1; then',
            ...service.autoStart ? [`    rc-update add ${service.name} default`, `    [ -d /run/openrc ] && rc-service ${service.name} start || true`] : ['    true'],
            'fi'
        ]
        after.postupgrade = [`[ -d /run/openrc ] && rc-service --ifstarted ${service.name} restart || true`]
        before.preremove = [
            'if command -v rc-update >/dev/null 2>&1; then',
            `    [ -d /run/openrc ] && rc-service --ifstarted ${service.name} stop || true`,
            `    rc-update del ${service.name} default 2>/dev/null || true`,
            'fi'
        ]
        return {before: before, after: after}
    }
    //systemd: the upgrades restart the service (deb: postinst configure, rpm: %post 2, pacman: post_upgrade)
    after.postinstall = [
        'if [ -d /run/systemd/system ]; then',
        '    systemctl daemon-reload',
        ...service.autoStart ? [`    systemctl enable ${unit}`, `    systemctl restart ${unit}`] : [`    systemctl try-restart ${unit}`],
        'fi'
    ]
    //Not before an upgrade (deb: prerm upgrade, rpm: %preun 1)
    before.preremove = [
        'case "$1" in',
        '    upgrade|failed-upgrade|1) ;;',
        `    *) if [ -d /run/systemd/system ]; then systemctl disable --now ${unit} || true; fi ;;`,
        'esac'
    ]
    before.postremove = ['if [ -d /run/systemd/system ]; then', '    systemctl daemon-reload || true', 'fi']
    if (target === 'archlinux') after.postupgrade = after.postinstall
    return {before: before, after: after}
}

/**
 * What a script of a package does, as the scripts of the application are given it (lakutata_action: install, upgrade,
 * remove, or none), from the arguments of its package manager: the upgrades of deb and rpm run their scripts of the
 * installation (deb: preinst upgrade, postinst configure <version replaced>; rpm: $1 > 1) and their scripts of the
 * removal of the version replaced (which run none); the ones of apk and pacman run their own scripts
 * @param target
 * @param hook
 */
export function Action(target: Exclude<LinuxTarget, 'tar.gz'>, hook: NativeHook): string {
    switch (target) {
        case 'deb':
            return {
                preinstall: 'case "$1" in install) lakutata_action=install ;; upgrade) lakutata_action=upgrade ;; *) lakutata_action= ;; esac',
                postinstall: 'if [ "$1" = configure ]; then if [ -n "$2" ]; then lakutata_action=upgrade; else lakutata_action=install; fi; else lakutata_action=; fi',
                preremove: 'if [ "$1" = remove ]; then lakutata_action=remove; else lakutata_action=; fi',
                postremove: 'if [ "$1" = remove ]; then lakutata_action=remove; else lakutata_action=; fi'
            }[hook as InstallerHook]
        case 'rpm':
            return hook === 'preinstall' || hook === 'postinstall'
                ? 'if [ "$1" -gt 1 ] 2>/dev/null; then lakutata_action=upgrade; else lakutata_action=install; fi'
                : 'if [ "$1" = 0 ]; then lakutata_action=remove; else lakutata_action=; fi'
        default:
            return `lakutata_action=${hook.endsWith('upgrade') ? 'upgrade' : hook.endsWith('install') ? 'install' : 'remove'}`
    }
}

/**
 * The scripts of a package: the parts managing the service, the scripts of the application (run before the service is
 * started, after it is stopped), and its native ones, given the arguments of the package manager
 * @param plan
 * @param target
 */
function Scripts(plan: InstallerPlan, target: Exclude<LinuxTarget, 'tar.gz'>): Partial<Record<NativeHook, string>> {
    const service = ServiceScripts(plan, target)
    const user: TargetScripts = plan.scripts[target] ?? {hooks: {}, native: {}}
    const hooks: readonly NativeHook[] = target === 'apk' || target === 'archlinux' ? NATIVE_HOOKS : INSTALLER_HOOKS
    const scripts: Partial<Record<NativeHook, string>> = {}
    for (const hook of hooks) {
        //The script of the application of the moment: the upgrades of apk and pacman run the ones of the installation
        const application: ScriptFile | undefined = user.hooks[(hook === 'preupgrade' ? 'preinstall' : hook === 'postupgrade' ? 'postinstall' : hook) as InstallerHook]
        const native: ScriptFile | undefined = user.native[hook]
        const lines: string[] = [
            ...service.before[hook] ?? [],
            //Not indented: the lines of the script are the ones of its file
            ...application ? [Action(target, hook), 'if [ -n "$lakutata_action" ]; then', ...EmbeddedShell(application, plan.prefix, '"$lakutata_action"'), 'fi'] : [],
            ...native ? EmbeddedShell(native, plan.prefix, '"$@"') : [],
            ...service.after[hook] ?? []
        ]
        if (lines.length) scripts[hook] = ['#!/bin/sh', 'set -e', ...lines, ''].join('\n')
    }
    return scripts
}

/**
 * Make the packages of Linux of an application: nFPM makes the deb, rpm, apk and archlinux packages, the tar.gz archive
 * is the directory of the executable
 * @param plan
 * @param targets
 * @param work
 * @param outdir
 */
export async function BuildLinuxPackages(plan: InstallerPlan, targets: LinuxTarget[], work: string, outdir: string): Promise<{ target: string, file: string, size: number }[]> {
    await mkdir(work, {recursive: true})
    const files: { target: string, file: string, size: number }[] = []
    const service: Service | undefined = plan.service
    for (const target of targets) {
        if (target === 'tar.gz') {
            files.push(await ArchiveDirectory(plan, Arch(), work, outdir))
            continue
        }
        const directory: string = path.join(work, target)
        await mkdir(directory, {recursive: true})
        const contents: Record<string, unknown>[] = Contents(plan.directory, plan.prefix)
        if (plan.addToPath) contents.push({src: `${plan.prefix}/${plan.program}`, dst: `/usr/bin/${plan.program}`, type: 'symlink'})
        if (service) {
            await writeFile(path.join(directory, 'environment'), EnvironmentFile(service))
            contents.push({src: path.join(directory, 'environment'), dst: `/etc/${plan.name}/${plan.name}.env`, type: 'config|noreplace', file_info: {mode: 0o640}})
            if (target === 'apk') {
                await writeFile(path.join(directory, 'openrc'), OpenRCScript(plan, service))
                contents.push({src: path.join(directory, 'openrc'), dst: `/etc/init.d/${service.name}`, file_info: {mode: 0o755}})
            } else {
                await writeFile(path.join(directory, 'unit'), SystemdUnit(plan, service))
                contents.push({src: path.join(directory, 'unit'), dst: `/usr/lib/systemd/system/${service.name}.service`, file_info: {mode: 0o644}})
            }
        }
        const scripts: Partial<Record<NativeHook, string>> = Scripts(plan, target)
        const common: Record<string, string> = {}
        const specific: Record<string, string> = {}
        for (const [name, content] of Object.entries(scripts) as [NativeHook, string][]) {
            const file: string = path.join(directory, name)
            await writeFile(file, content, {mode: 0o755})
            //The upgrades of apk and pacman are their own scripts
            if (name === 'preupgrade' || name === 'postupgrade') specific[name] = file
            else common[name] = file
        }
        const config: Record<string, unknown> = {
            name: plan.name,
            arch: Arch(),
            platform: 'linux',
            version: plan.version,
            maintainer: plan.maintainer,
            description: plan.description,
            ...plan.vendor ? {vendor: plan.vendor} : {},
            ...plan.homepage ? {homepage: plan.homepage} : {},
            ...plan.license ? {license: plan.license} : {},
            ...plan.section ? {section: plan.section} : {},
            ...plan.priority ? {priority: plan.priority} : {},
            depends: [...new Set([...RUNTIME_DEPENDS[target], ...plan.depends])],
            ...plan.recommends.length ? {recommends: plan.recommends} : {},
            contents: contents,
            scripts: common,
            ...Object.keys(specific).length ? {[target]: {scripts: specific}} : {}
        }
        //JSON is YAML
        await writeFile(path.join(directory, 'nfpm.yaml'), JSON.stringify(config, null, 2))
        const nfpm: string = await EnsureTool('nfpm')
        const file: string = path.join(outdir, PackageFile(plan, target))
        await rm(file, {force: true})
        const packaged = await Run(nfpm, ['package', '--config', path.join(directory, 'nfpm.yaml'), '--packager', target, '--target', file], directory)
        if (packaged.code !== 0) throw new Error(`The ${target} package cannot be made: ${packaged.output.trim()}`)
        files.push({target: target, file: file, size: (await stat(file)).size})
    }
    return files
}

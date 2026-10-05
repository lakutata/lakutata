import {chmod, cp, mkdir, rm, stat, symlink, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {archiveDirectory} from '../Archive.js'
import {runCommand} from '../Processes.js'
import type {InstallerPlan} from '../Installer.js'
import {embeddedShell, type InstallerHook, type ScriptFile} from '../Scripts.js'

/**
 * The installers of macOS: the package of its installer, and the archive of the directory of the executable
 */
export const MAC_TARGETS = ['pkg', 'tar.gz'] as const

export type MacTarget = typeof MAC_TARGETS[number]

type Service = NonNullable<InstallerPlan['service']>

/**
 * The architecture of the packages
 */
function packageArch(): string {
    return process.arch
}

/**
 * A text of a property list
 * @param value
 */
function xml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * A value in double quotes, as sh reads them
 * @param value
 */
function doubleQuoted(value: string): string {
    return `"${value.replace(/[\\"$`]/g, '\\$&')}"`
}

/**
 * The paths of an application installed on macOS (the ones of Homebrew: /usr/local)
 * @param plan
 */
function installPaths(plan: InstallerPlan) {
    return {
        environment: `/usr/local/etc/${plan.name}/${plan.name}.env`,
        data: `/usr/local/var/lib/${plan.name}`,
        log: `/usr/local/var/log/${plan.name}.log`,
        daemon: `/Library/LaunchDaemons/${plan.appId}.plist`
    }
}

/**
 * The job of launchd of the service: the application run by sh, which reads its environment file first (launchd has
 * none), as its user, in its directory
 * @param plan
 * @param service
 */
function launchDaemon(plan: InstallerPlan, service: Service): string {
    const paths = installPaths(plan)
    const keepAlive: string = service.restart === 'always' ? '<true/>' : service.restart === 'no' ? '<false/>' : '<dict>\n        <key>SuccessfulExit</key>\n        <false/>\n    </dict>'
    const args: string[] = ['/bin/sh', '-c', `set -a; [ -f ${paths.environment} ] && . ${paths.environment}; set +a; exec "$0" "$@"`, `${plan.prefix}/${plan.program}`, ...service.args]
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xml(plan.appId)}</string>
    <key>ProgramArguments</key>
    <array>
${args.map((arg: string): string => `        <string>${xml(arg)}</string>`).join('\n')}
    </array>
${service.user === 'root' ? '' : `    <key>UserName</key>
    <string>${xml(service.user)}</string>
    <key>GroupName</key>
    <string>${xml(service.user)}</string>
`}    <key>WorkingDirectory</key>
    <string>${xml(paths.data)}</string>
    <key>RunAtLoad</key>
    ${service.autoStart ? '<true/>' : '<false/>'}
    <key>KeepAlive</key>
    ${keepAlive}
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>ExitTimeOut</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>${xml(paths.log)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(paths.log)}</string>
</dict>
</plist>
`
}

/**
 * The scripts of the application the package runs
 * @param plan
 */
function installerHooks(plan: InstallerPlan): Partial<Record<InstallerHook, ScriptFile>> {
    return plan.scripts.pkg?.hooks ?? {}
}

/**
 * The file the preinstall script writes what the installation does to (install or upgrade), read by the postinstall
 * script: in the temporary directory of the installation (INSTALLER_TEMP), given to both
 */
const ACTION_FILE: string = '"$INSTALLER_TEMP/lakutata-action"'

/**
 * The script run before the installation (and the upgrades), when the application has scripts: what the installation
 * does (an upgrade replaces the program installed), the preinstall script of the application
 * @param plan
 */
function preInstall(plan: InstallerPlan): string {
    const hooks = installerHooks(plan)
    return [
        '#!/bin/sh',
        'set -e',
        `if [ -e ${doubleQuoted(`${plan.prefix}/${plan.program}`)} ]; then lakutata_action=upgrade; else lakutata_action=install; fi`,
        `if [ -n "$INSTALLER_TEMP" ]; then echo "$lakutata_action" > ${ACTION_FILE}; fi`,
        ...hooks.preinstall ? embeddedShell(hooks.preinstall, plan.prefix, '"$lakutata_action"') : [],
        ''
    ].join('\n')
}

/**
 * The script run after the installation (and the upgrades): the user of the service created (hidden, its identifier a
 * free one of the system users), its directories, its environment file written once (the administrators change it),
 * the postinstall script of the application, the service loaded again
 * @param plan
 */
function postInstall(plan: InstallerPlan): string {
    const service: Service | undefined = plan.service
    const hooks = installerHooks(plan)
    return [
        '#!/bin/sh',
        'set -e',
        ...service ? serviceInstallation(plan, service) : [],
        ...hooks.postinstall ? [
            `lakutata_action="$(cat ${ACTION_FILE} 2>/dev/null || echo install)"`,
            ...embeddedShell(hooks.postinstall, plan.prefix, '"$lakutata_action"')
        ] : [],
        ...service ? serviceStart(plan) : [],
        ''
    ].join('\n')
}

/**
 * The installation of the service: its hidden user, its directories, its environment file
 * @param plan
 * @param service
 */
function serviceInstallation(plan: InstallerPlan, service: Service): string[] {
    const paths = installPaths(plan)
    const user: string = service.user
    const root: boolean = user === 'root'
    return [
        ...root ? [] : [
            `if ! dscl . -read /Users/${user} >/dev/null 2>&1; then`,
            '    taken="$(dscl . -list /Users UniqueID | awk \'{print $2}\') $(dscl . -list /Groups PrimaryGroupID | awk \'{print $2}\')"',
            '    id=300',
            '    while echo " $taken " | tr \'\\n\' \' \' | grep -q " $id "; do id=$((id + 1)); done',
            `    dscl . -create /Groups/${user}`,
            `    dscl . -create /Groups/${user} PrimaryGroupID "$id"`,
            `    dscl . -create /Groups/${user} Password "*"`,
            `    dscl . -create /Users/${user}`,
            `    dscl . -create /Users/${user} UniqueID "$id"`,
            `    dscl . -create /Users/${user} PrimaryGroupID "$id"`,
            `    dscl . -create /Users/${user} UserShell /usr/bin/false`,
            `    dscl . -create /Users/${user} NFSHomeDirectory /var/empty`,
            `    dscl . -create /Users/${user} RealName ${doubleQuoted(service.description)}`,
            `    dscl . -create /Users/${user} Password "*"`,
            `    dscl . -create /Users/${user} IsHidden 1`,
            'fi'
        ],
        `mkdir -p ${paths.data} ${path.posix.dirname(paths.log)} ${path.posix.dirname(paths.environment)}`,
        `touch ${paths.log}`,
        ...root ? [] : [`chown ${user}:${user} ${paths.data} ${paths.log}`],
        `chmod 750 ${paths.data}`,
        //Kept by the upgrades
        `if [ ! -f ${paths.environment} ]; then`,
        `    cat > ${paths.environment} <<'LAKUTATA_ENVIRONMENT'`,
        `# The environment of the service ${plan.appId}, read when it starts (sudo launchctl kickstart -k system/${plan.appId})`,
        ...Object.entries(service.env).map(([name, value]: [string, string]): string => `${name}=${doubleQuoted(value)}`),
        'LAKUTATA_ENVIRONMENT',
        'fi',
        //Read by the user of the service
        `chown root:${root ? 'wheel' : user} ${paths.environment}`,
        `chmod 640 ${paths.environment}`
    ]
}

/**
 * The service loaded again: started (RunAtLoad), or stopped by the upgrade
 * @param plan
 */
function serviceStart(plan: InstallerPlan): string[] {
    const paths = installPaths(plan)
    return [
        //Loaded again: started (RunAtLoad), or stopped by the upgrade; bootout returns before the job of the version
        //replaced is unloaded (the application ending gracefully, ExitTimeOut): bootstrap fails until it is
        `launchctl bootout system/${plan.appId} 2>/dev/null || true`,
        'waited=0',
        `while launchctl print system/${plan.appId} >/dev/null 2>&1 && [ "$waited" -lt 70 ]; do sleep 0.5; waited=$((waited + 1)); done`,
        `launchctl bootstrap system ${paths.daemon}`
    ]
}

/**
 * The script removing the application (the packages of macOS are not removed by the system): its service stopped, the
 * preremove script of the application, its files removed, the postremove script of the application; its data, its
 * environment and its user kept
 * @param plan
 */
function uninstall(plan: InstallerPlan): string {
    const paths = installPaths(plan)
    const hooks = installerHooks(plan)
    return [
        '#!/bin/sh',
        'set -e',
        `[ "$(id -u)" = 0 ] || { echo "Remove ${plan.name} as root: sudo $0"; exit 1; }`,
        ...plan.service ? [`launchctl bootout system/${plan.appId} 2>/dev/null || true`, `rm -f ${paths.daemon}`] : [],
        ...hooks.preremove ? embeddedShell(hooks.preremove, plan.prefix, 'remove') : [],
        ...plan.addToPath ? [`rm -f /usr/local/bin/${plan.program}`] : [],
        `rm -rf ${plan.prefix}`,
        `pkgutil --forget ${plan.appId} >/dev/null 2>&1 || true`,
        ...hooks.postremove ? embeddedShell(hooks.postremove, plan.prefix, 'remove') : [],
        `echo "${plan.name} removed${plan.service ? `, its data (${paths.data}), its environment (${paths.environment}) and its user (${plan.service.user}) kept` : ''}"`,
        ''
    ].join('\n')
}

/**
 * Make the installers of macOS of an application: the package installed by its installer (pkgbuild, productbuild), the
 * tar.gz archive of the directory of the executable
 * @param plan
 * @param targets
 * @param work
 * @param outdir
 */
export async function buildMacPackages(plan: InstallerPlan, targets: MacTarget[], work: string, outdir: string): Promise<{ target: string, file: string, size: number }[]> {
    await mkdir(work, {recursive: true})
    const files: { target: string, file: string, size: number }[] = []
    for (const target of targets) {
        if (target === 'tar.gz') {
            files.push(await archiveDirectory(plan, packageArch(), work, outdir))
            continue
        }
        //The files installed, from the root of the system
        const root: string = path.join(work, 'root')
        const scripts: string = path.join(work, 'scripts')
        await rm(root, {recursive: true, force: true})
        await rm(scripts, {recursive: true, force: true})
        const prefix: string = path.join(root, ...plan.prefix.split('/'))
        await mkdir(path.dirname(prefix), {recursive: true})
        await cp(plan.directory, prefix, {recursive: true, verbatimSymlinks: true})
        await writeFile(path.join(prefix, 'uninstall'), uninstall(plan), {mode: 0o755})
        if (plan.addToPath) {
            await mkdir(path.join(root, 'usr', 'local', 'bin'), {recursive: true})
            await symlink(path.posix.relative('/usr/local/bin', `${plan.prefix}/${plan.program}`), path.join(root, 'usr', 'local', 'bin', plan.program))
        }
        await mkdir(scripts, {recursive: true})
        if (plan.service) {
            await mkdir(path.join(root, 'Library', 'LaunchDaemons'), {recursive: true})
            await writeFile(path.join(root, 'Library', 'LaunchDaemons', `${plan.appId}.plist`), launchDaemon(plan, plan.service), {mode: 0o644})
        }
        const hooks = installerHooks(plan)
        if (hooks.preinstall || hooks.postinstall) {
            await writeFile(path.join(scripts, 'preinstall'), preInstall(plan))
            await chmod(path.join(scripts, 'preinstall'), 0o755)
        }
        if (plan.service || hooks.postinstall) {
            await writeFile(path.join(scripts, 'postinstall'), postInstall(plan))
            await chmod(path.join(scripts, 'postinstall'), 0o755)
        }
        const component: string = path.join(work, `${plan.name}-component.pkg`)
        const built = await runCommand('pkgbuild', ['--root', root, '--identifier', plan.appId, '--version', plan.version, '--install-location', '/', '--scripts', scripts, '--ownership', 'recommended', component], work)
        if (built.code !== 0) throw new Error(`The pkg package cannot be made: ${built.output.trim()}`)
        const file: string = path.join(outdir, `${plan.name}-${plan.version}-${packageArch()}.pkg`)
        await rm(file, {force: true})
        const product = await runCommand('productbuild', ['--identifier', plan.appId, '--version', plan.version, '--package', component, file], work)
        if (product.code !== 0) throw new Error(`The pkg package cannot be made: ${product.output.trim()}`)
        files.push({target: target, file: file, size: (await stat(file)).size})
    }
    return files
}

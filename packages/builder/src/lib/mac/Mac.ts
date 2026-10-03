import {chmod, cp, mkdir, rm, stat, symlink, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {ArchiveDirectory} from '../Archive.js'
import {Run} from '../Processes.js'
import type {InstallerPlan} from '../Installer.js'

/**
 * The installers of macOS: the package of its installer, and the archive of the directory of the executable
 */
export const MAC_TARGETS = ['pkg', 'tar.gz'] as const

export type MacTarget = typeof MAC_TARGETS[number]

type Service = NonNullable<InstallerPlan['service']>

/**
 * The architecture of the packages
 */
function Arch(): string {
    return process.arch
}

/**
 * A text of a property list
 * @param value
 */
function Xml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * A value in double quotes, as sh reads them
 * @param value
 */
function DoubleQuoted(value: string): string {
    return `"${value.replace(/[\\"$`]/g, '\\$&')}"`
}

/**
 * The paths of an application installed on macOS (the ones of Homebrew: /usr/local)
 * @param plan
 */
function Paths(plan: InstallerPlan) {
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
function LaunchDaemon(plan: InstallerPlan, service: Service): string {
    const paths = Paths(plan)
    const keepAlive: string = service.restart === 'always' ? '<true/>' : service.restart === 'no' ? '<false/>' : '<dict>\n        <key>SuccessfulExit</key>\n        <false/>\n    </dict>'
    const args: string[] = ['/bin/sh', '-c', `set -a; [ -f ${paths.environment} ] && . ${paths.environment}; set +a; exec "$0" "$@"`, `${plan.prefix}/${plan.program}`, ...service.args]
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${Xml(plan.appId)}</string>
    <key>ProgramArguments</key>
    <array>
${args.map((arg: string): string => `        <string>${Xml(arg)}</string>`).join('\n')}
    </array>
${service.user === 'root' ? '' : `    <key>UserName</key>
    <string>${Xml(service.user)}</string>
    <key>GroupName</key>
    <string>${Xml(service.user)}</string>
`}    <key>WorkingDirectory</key>
    <string>${Xml(paths.data)}</string>
    <key>RunAtLoad</key>
    ${service.autoStart ? '<true/>' : '<false/>'}
    <key>KeepAlive</key>
    ${keepAlive}
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>ExitTimeOut</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>${Xml(paths.log)}</string>
    <key>StandardErrorPath</key>
    <string>${Xml(paths.log)}</string>
</dict>
</plist>
`
}

/**
 * The script run after the installation (and the upgrades): the user of the service created (hidden, its identifier a
 * free one of the system users), its directories, its environment file written once (the administrators change it),
 * the service loaded again
 * @param plan
 * @param service
 */
function PostInstall(plan: InstallerPlan, service: Service): string {
    const paths = Paths(plan)
    const user: string = service.user
    const root: boolean = user === 'root'
    return [
        '#!/bin/sh',
        'set -e',
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
            `    dscl . -create /Users/${user} RealName ${DoubleQuoted(service.description)}`,
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
        ...Object.entries(service.env).map(([name, value]: [string, string]): string => `${name}=${DoubleQuoted(value)}`),
        'LAKUTATA_ENVIRONMENT',
        'fi',
        //Read by the user of the service
        `chown root:${root ? 'wheel' : user} ${paths.environment}`,
        `chmod 640 ${paths.environment}`,
        //Loaded again: started (RunAtLoad), or stopped by the upgrade; bootout returns before the job of the version
        //replaced is unloaded (the application ending gracefully, ExitTimeOut): bootstrap fails until it is
        `launchctl bootout system/${plan.appId} 2>/dev/null || true`,
        'waited=0',
        `while launchctl print system/${plan.appId} >/dev/null 2>&1 && [ "$waited" -lt 70 ]; do sleep 0.5; waited=$((waited + 1)); done`,
        `launchctl bootstrap system ${paths.daemon}`,
        ''
    ].join('\n')
}

/**
 * The script removing the application (the packages of macOS are not removed by the system): its service stopped, its
 * files removed, its data, its environment and its user kept
 * @param plan
 */
function Uninstall(plan: InstallerPlan): string {
    const paths = Paths(plan)
    return [
        '#!/bin/sh',
        'set -e',
        `[ "$(id -u)" = 0 ] || { echo "Remove ${plan.name} as root: sudo $0"; exit 1; }`,
        ...plan.service ? [`launchctl bootout system/${plan.appId} 2>/dev/null || true`, `rm -f ${paths.daemon}`] : [],
        ...plan.addToPath ? [`rm -f /usr/local/bin/${plan.program}`] : [],
        `rm -rf ${plan.prefix}`,
        `pkgutil --forget ${plan.appId} >/dev/null 2>&1 || true`,
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
export async function BuildMacPackages(plan: InstallerPlan, targets: MacTarget[], work: string, outdir: string): Promise<{ target: string, file: string, size: number }[]> {
    await mkdir(work, {recursive: true})
    const files: { target: string, file: string, size: number }[] = []
    for (const target of targets) {
        if (target === 'tar.gz') {
            files.push(await ArchiveDirectory(plan, Arch(), work, outdir))
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
        await writeFile(path.join(prefix, 'uninstall'), Uninstall(plan), {mode: 0o755})
        if (plan.addToPath) {
            await mkdir(path.join(root, 'usr', 'local', 'bin'), {recursive: true})
            await symlink(path.posix.relative('/usr/local/bin', `${plan.prefix}/${plan.program}`), path.join(root, 'usr', 'local', 'bin', plan.program))
        }
        await mkdir(scripts, {recursive: true})
        if (plan.service) {
            await mkdir(path.join(root, 'Library', 'LaunchDaemons'), {recursive: true})
            await writeFile(path.join(root, 'Library', 'LaunchDaemons', `${plan.appId}.plist`), LaunchDaemon(plan, plan.service), {mode: 0o644})
            await writeFile(path.join(scripts, 'postinstall'), PostInstall(plan, plan.service))
            await chmod(path.join(scripts, 'postinstall'), 0o755)
        }
        const component: string = path.join(work, `${plan.name}-component.pkg`)
        const built = await Run('pkgbuild', ['--root', root, '--identifier', plan.appId, '--version', plan.version, '--install-location', '/', '--scripts', scripts, '--ownership', 'recommended', component], work)
        if (built.code !== 0) throw new Error(`The pkg package cannot be made: ${built.output.trim()}`)
        const file: string = path.join(outdir, `${plan.name}-${plan.version}-${Arch()}.pkg`)
        await rm(file, {force: true})
        const product = await Run('productbuild', ['--identifier', plan.appId, '--version', plan.version, '--package', component, file], work)
        if (product.code !== 0) throw new Error(`The pkg package cannot be made: ${product.output.trim()}`)
        files.push({target: target, file: file, size: (await stat(file)).size})
    }
    return files
}

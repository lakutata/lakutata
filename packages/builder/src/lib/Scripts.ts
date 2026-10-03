import {createHash} from 'node:crypto'
import {existsSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'

/**
 * The moments of the installers the scripts of the applications are run at, the same on every system: before and after
 * the installation (and the upgrades), before and after the removal (not the one of an upgrade)
 */
export const INSTALLER_HOOKS = ['preinstall', 'postinstall', 'preremove', 'postremove'] as const

export type InstallerHook = typeof INSTALLER_HOOKS[number]

/**
 * The scripts of an application run by its installers (files of its project): the ones of Linux and macOS are run by
 * the interpreter of their first line (#!/bin/sh by default), the ones of Windows are scripts of PowerShell (.ps1). They
 * are given what the installer does: install, upgrade (preinstall and postinstall) or remove (preremove and
 * postremove), and the directory of the application (LAKUTATA_INSTALL_DIR)
 */
export type InstallerScripts = Partial<Record<InstallerHook, string>>

/**
 * The scripts of the packages of Linux, as nFPM runs them: the ones of each package, given its own arguments (the ones
 * of dpkg, of rpm, of apk, of pacman); the upgrades of apk and pacman have their own ones
 */
export const NATIVE_HOOKS = ['preinstall', 'postinstall', 'preremove', 'postremove', 'preupgrade', 'postupgrade'] as const

export type NativeHook = typeof NATIVE_HOOKS[number]

export type NativeScripts = Partial<Record<NativeHook, string>>

/**
 * A script of the application, read from its project
 */
export type ScriptFile = {
    /**
     * Its path, from the project
     */
    file: string
    content: string
}

/**
 * The scripts of an installer: the ones of the moments (the ones of its platform, the ones of the installer replacing
 * them), the native ones of the packages of Linux, the file of NSIS it includes
 */
export type TargetScripts = {
    hooks: Partial<Record<InstallerHook, ScriptFile>>
    native: Partial<Record<NativeHook, ScriptFile>>
    include?: ScriptFile
}

/**
 * The scripts of the platform and of its installers, as configured (lakutata.installer.<platform>)
 */
export type PlatformScripts = {
    scripts?: InstallerScripts
    [target: string]: unknown
}

/**
 * The installers which run no script (archives, copied by their users)
 */
const ARCHIVES: string[] = ['tar.gz', 'zip']

/**
 * A script of the project, read
 * @param project
 * @param file
 * @param where its place in the configuration
 */
function Read(project: string, file: unknown, where: string): ScriptFile {
    if (typeof file !== 'string' || !file) throw new Error(`The script ${where} must be a file of the project`)
    const absolute: string = path.resolve(project, file)
    if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`The script ${where} (${file}) does not exist`)
    //Without the mark of UTF-8, which the scripts are given with when they need it
    return {file: file, content: readFileSync(absolute, 'utf8').replace(/^\ufeff/, '')}
}

/**
 * The scripts of a moment, checked
 * @param project
 * @param scripts
 * @param where
 * @param windows
 */
function Hooks(project: string, scripts: unknown, where: string, windows: boolean): Partial<Record<InstallerHook, ScriptFile>> {
    if (scripts === undefined) return {}
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) throw new Error(`The scripts ${where} must be {"preinstall": "<file>", "postinstall": "<file>", "preremove": "<file>", "postremove": "<file>"}`)
    const hooks: Partial<Record<InstallerHook, ScriptFile>> = {}
    for (const [hook, file] of Object.entries(scripts)) {
        if (!INSTALLER_HOOKS.includes(hook as InstallerHook)) throw new Error(`The script ${where}.${hook} is not one of ${INSTALLER_HOOKS.join(', ')}`)
        if (windows && typeof file === 'string' && !/\.ps1$/i.test(file)) throw new Error(`The script ${where}.${hook} (${file}) must be a script of PowerShell (.ps1)`)
        hooks[hook as InstallerHook] = Read(project, file, `${where}.${hook}`)
    }
    return hooks
}

/**
 * The scripts of the installers made on a platform: the ones of the platform (lakutata.installer.<platform>.scripts),
 * replaced by the ones of each installer (lakutata.installer.<platform>.<installer>.scripts), the native ones of the
 * packages of Linux (nativeScripts), the file of NSIS included by its installer (win.nsis.include)
 * @param project
 * @param platform its name in the configuration: linux, mac or win
 * @param config its configuration
 * @param targets the installers made
 * @param warnings
 */
export function ResolveScripts(project: string, platform: 'linux' | 'mac' | 'win', config: PlatformScripts | undefined, targets: string[], warnings: string[]): Record<string, TargetScripts> {
    const windows: boolean = platform === 'win'
    const where: string = `lakutata.installer.${platform}`
    const common: Partial<Record<InstallerHook, ScriptFile>> = Hooks(project, config?.scripts, `${where}.scripts`, windows)
    const resolved: Record<string, TargetScripts> = {}
    const unrun: string[] = []
    for (const target of targets) {
        const options: unknown = config?.[target]
        if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) throw new Error(`${where}.${target} must be an object`)
        const own = (options ?? {}) as { scripts?: unknown, nativeScripts?: unknown, include?: unknown }
        const scripts: TargetScripts = {hooks: {...common, ...Hooks(project, own.scripts, `${where}.${target}.scripts`, windows)}, native: {}}
        if (own.nativeScripts !== undefined) {
            if (platform !== 'linux' || ARCHIVES.includes(target)) throw new Error(`${where}.${target}.nativeScripts: the native scripts are the ones of the packages of Linux (deb, rpm, apk, archlinux)`)
            if (!own.nativeScripts || typeof own.nativeScripts !== 'object' || Array.isArray(own.nativeScripts)) throw new Error(`${where}.${target}.nativeScripts must be {"<script>": "<file>"}`)
            //The upgrades of deb and rpm run their scripts of the installation and of the removal
            const hooks: readonly string[] = target === 'apk' || target === 'archlinux' ? NATIVE_HOOKS : INSTALLER_HOOKS
            for (const [hook, file] of Object.entries(own.nativeScripts)) {
                if (!hooks.includes(hook)) throw new Error(`${where}.${target}.nativeScripts.${hook} is not a script of ${target} (${hooks.join(', ')})`)
                scripts.native[hook as NativeHook] = Read(project, file, `${where}.${target}.nativeScripts.${hook}`)
            }
        }
        if (own.include !== undefined) {
            if (!windows || target !== 'nsis') throw new Error(`${where}.${target}.include: the file of NSIS is included by the installer of NSIS (win.nsis.include)`)
            if (typeof own.include === 'string' && !/\.nsh$/i.test(own.include)) throw new Error(`${where}.nsis.include (${own.include}) must be a file of NSIS (.nsh)`)
            scripts.include = Read(project, own.include, `${where}.nsis.include`)
        }
        if (ARCHIVES.includes(target) && Object.keys(scripts.hooks).length) unrun.push(target)
        resolved[target] = scripts
    }
    if (unrun.length) warnings.push(`The scripts of the installers are not run by the archives (${unrun.join(', ')}): their users copy them`)
    return resolved
}

/**
 * The lines of sh running a script embedded in them (the scripts run before the files of the application are installed,
 * or after they are removed): written to a temporary file, run by the interpreter of its first line (a temporary file
 * system may not run its files), its failure the one of the script running it
 * @param script
 * @param prefix the directory of the application (LAKUTATA_INSTALL_DIR)
 * @param args the arguments given to it (sh)
 */
export function EmbeddedShell(script: ScriptFile, prefix: string, args: string): string[] {
    const first: string = script.content.split('\n', 1)[0]
    const interpreter: string = first.startsWith('#!') ? first.slice(2).trim() : '/bin/sh'
    //Not a line of the script
    const tag: string = `LAKUTATA_SCRIPT_${createHash('sha1').update(script.content).digest('hex').slice(0, 12).toUpperCase()}`
    const content: string = script.content.replace(/\r\n/g, '\n')
    return [
        `# ${script.file}`,
        'lakutata_script="$(mktemp)"',
        `cat > "$lakutata_script" <<'${tag}'`,
        ...content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n'),
        tag,
        `LAKUTATA_INSTALL_DIR='${prefix.replace(/'/g, `'\\''`)}' ${interpreter} "$lakutata_script" ${args} || { lakutata_status=$?; rm -f "$lakutata_script"; exit $lakutata_status; }`,
        'rm -f "$lakutata_script"'
    ]
}

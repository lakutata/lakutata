import {existsSync, readFileSync} from 'node:fs'
import {chmod, mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import {BundleProject, type BundleResult} from '../Bundle.js'
import type {ExecutableResult} from '../Executable.js'
import {ApplicationIcon, IcnsFile, IcoFile, WriteLinuxIcons} from '../Icons.js'
import type {InstallerConfig, InstallerOptions, InstallerResult} from '../Installer.js'
import {Action} from '../linux/Linux.js'
import {EmbeddedShell, EncodedShell, INSTALLER_HOOKS, ResolveScripts, type InstallerHook, type PlatformScripts, type ScriptFile, type TargetScripts} from '../Scripts.js'

/**
 * The installers of the Electron applications by default, the ones of electron-builder (its targets) otherwise
 */
const ELECTRON_TARGETS: Record<'linux' | 'mac' | 'win', string[]> = {linux: ['deb'], mac: ['dmg'], win: ['nsis']}

/**
 * The moments the installers of electron-builder run the scripts of the application at: the packages of fpm (deb, rpm)
 * all of them; the pkg package of macOS the ones of the installation (an application of macOS is removed by its
 * user); the installer of NSIS but the postremove one (its uninstaller ends with the removal of the files)
 * @param platform
 */
function ElectronHooks(platform: 'linux' | 'mac' | 'win'): (target: string) => readonly InstallerHook[] {
    return (target: string): readonly InstallerHook[] => {
        if (platform === 'linux') return target === 'deb' || target === 'rpm' ? INSTALLER_HOOKS : []
        if (platform === 'mac') return target === 'pkg' ? ['preinstall', 'postinstall'] : []
        return target === 'nsis' ? ['preinstall', 'postinstall', 'preremove'] : []
    }
}

/**
 * A configuration of electron-builder over another one: its objects merged, its other values replacing
 * @param base
 * @param over
 */
function Merge(base: Record<string, any>, over: Record<string, any>): Record<string, any> {
    const merged: Record<string, any> = {...base}
    for (const [key, value] of Object.entries(over)) {
        const plain = (item: unknown): item is Record<string, any> => !!item && typeof item === 'object' && !Array.isArray(item)
        merged[key] = plain(value) && plain(merged[key]) ? Merge(merged[key], value) : value
    }
    return merged
}

/**
 * The maintainer of the packages of Linux, which fpm needs with its email ("Name <email>")
 * @param maintainer
 * @param name
 * @param warnings
 */
function Maintainer(maintainer: string | undefined, name: string, warnings: string[]): string {
    if (maintainer && /<[^>]+@[^>]+>/.test(maintainer)) return maintainer
    warnings.push(`The packages of Linux need the email of their maintainer ("Name <email>": the author of the package.json, or lakutata.installer.maintainer): ${name}@localhost is given`)
    return `${maintainer || name} <${name}@localhost>`
}

/**
 * The scripts of the packages of fpm (deb, rpm) running the scripts of the application: the ones run before the
 * installation and the removal (given to fpm), the ones run after them (templates of electron-builder: its own ones, then
 * the ones of the application, encoded)
 * @param target
 * @param scripts
 * @param prefix the directory of the application (/opt/<product>)
 * @param templates the directory of the templates of electron-builder
 * @param directory where they are written
 */
async function FpmScripts(target: 'deb' | 'rpm', scripts: TargetScripts, prefix: string, templates: string, directory: string): Promise<Record<string, unknown>> {
    const options: Record<string, unknown> = {}
    const fpm: string[] = []
    await mkdir(directory, {recursive: true})
    const part = (hook: InstallerHook, script: ScriptFile): string[] => [Action(target, hook), 'if [ -n "$lakutata_action" ]; then', ...EncodedShell(script, prefix, '"$lakutata_action"'), 'fi']
    for (const hook of INSTALLER_HOOKS) {
        const script: ScriptFile | undefined = scripts.hooks[hook]
        if (!script) continue
        const file: string = path.join(directory, `${target}-${hook}`)
        if (hook === 'preinstall' || hook === 'preremove') {
            await writeFile(file, ['#!/bin/sh', 'set -e', ...part(hook, script), ''].join('\n'), {mode: 0o755})
            fpm.push(hook === 'preinstall' ? '--before-install' : '--before-remove', file)
        } else {
            //The template of electron-builder (the link of the program, the sandbox of Chromium…), then the script
            const template: string = readFileSync(path.join(templates, hook === 'postinstall' ? 'after-install.tpl' : 'after-remove.tpl'), 'utf8')
            await writeFile(file, [template.trimEnd(), '', '# The script of the application', ...part(hook, script), ''].join('\n'), {mode: 0o755})
            options[hook === 'postinstall' ? 'afterInstall' : 'afterRemove'] = file
        }
    }
    if (fpm.length) options.fpm = fpm
    return options
}

/**
 * The scripts of the pkg package of macOS (pkgbuild): what the installation does (the application installed replaced by
 * an upgrade), told by the preinstall script to the postinstall one, and the ones of the application; each run once
 * @param scripts
 * @param prefix the application (/Applications/<product>.app)
 * @param directory where they are written
 */
async function PkgScripts(scripts: TargetScripts, prefix: string, directory: string): Promise<string> {
    await mkdir(directory, {recursive: true})
    const action: string = '"$INSTALLER_TEMP/lakutata-action"'
    const quoted: string = `'${prefix.replace(/'/g, `'\\''`)}'`
    //electron-builder gives them as the scripts of the package and as the ones of its bundle: run once
    const once = (name: string): string[] => [`if [ -n "$INSTALLER_TEMP" ]; then [ -e "$INSTALLER_TEMP/lakutata-${name}" ] && exit 0; touch "$INSTALLER_TEMP/lakutata-${name}"; fi`]
    await writeFile(path.join(directory, 'preinstall'), [
        '#!/bin/sh',
        'set -e',
        ...once('preinstall'),
        `if [ -e ${quoted} ]; then lakutata_action=upgrade; else lakutata_action=install; fi`,
        `if [ -n "$INSTALLER_TEMP" ]; then echo "$lakutata_action" > ${action}; fi`,
        ...scripts.hooks.preinstall ? EmbeddedShell(scripts.hooks.preinstall, prefix, '"$lakutata_action"') : [],
        ''
    ].join('\n'))
    await chmod(path.join(directory, 'preinstall'), 0o755)
    if (scripts.hooks.postinstall) {
        await writeFile(path.join(directory, 'postinstall'), [
            '#!/bin/sh',
            'set -e',
            ...once('postinstall'),
            `lakutata_action="$(cat ${action} 2>/dev/null || echo install)"`,
            ...EmbeddedShell(scripts.hooks.postinstall, prefix, '"$lakutata_action"'),
            ''
        ].join('\n'))
        await chmod(path.join(directory, 'postinstall'), 0o755)
    }
    return directory
}

/**
 * The file of NSIS the installer of electron-builder includes: the one of the application, and its macros running the
 * scripts of the application (from its temporary directory): customInit the preinstall one (an upgrade finds the
 * application installed), customInstall the postinstall one, customUnInstall the preremove one (not the one of an
 * upgrade, which runs the uninstaller of the version it replaces)
 * @param scripts
 * @param directory where it is written, with the scripts (marked as UTF-8 for Windows PowerShell)
 */
async function NsisInclude(scripts: TargetScripts, directory: string): Promise<string | undefined> {
    const hooks = scripts.hooks
    if (!hooks.preinstall && !hooks.postinstall && !hooks.preremove) return scripts.include && path.resolve(scripts.include.file)
    await mkdir(directory, {recursive: true})
    const macros: Record<string, InstallerHook | undefined> = {customInit: hooks.preinstall || hooks.postinstall ? 'preinstall' : undefined, customInstall: hooks.postinstall && 'postinstall', customUnInstall: hooks.preremove && 'preremove'}
    for (const [macro, hook] of Object.entries(macros)) {
        if (hook && scripts.include && new RegExp(`!macro\\s+${macro}\\b`).test(scripts.include.content)) throw new Error(`The file of NSIS ${scripts.include.file} defines the macro ${macro}, which runs the ${hook} script of the application: run its code from the script`)
    }
    const run = (hook: InstallerHook, action: string): string[] => {
        const file: string = path.join(directory, `${hook}.ps1`)
        return [
            '  InitPluginsDir',
            '  System::Call \'Kernel32::SetEnvironmentVariable(t "LAKUTATA_INSTALL_DIR", t "$INSTDIR")i\'',
            `  File "/oname=$PLUGINSDIR\\${hook}.ps1" "${file.replace(/\$/g, '$$$$')}"`,
            `  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\\${hook}.ps1" ${action}'`,
            '  Pop $0',
            '  ${If} $0 != "0"',
            `    Abort "The ${hook} script failed ($0)"`,
            '  ${EndIf}'
        ]
    }
    for (const hook of ['preinstall', 'postinstall', 'preremove'] as const) {
        if (hooks[hook]) await writeFile(path.join(directory, `${hook}.ps1`), `\ufeff${hooks[hook]!.content}`)
    }
    const lines: string[] = [
        ...scripts.include ? [`!include "${scripts.include.file}"`, ''] : [],
        '; What the installation does: an upgrade replaces the application installed (the uninstaller, made apart, has none)',
        '!ifndef BUILD_UNINSTALLER',
        '  Var /GLOBAL lakutataAction',
        '!endif',
        '!macro customInit',
        '  StrCpy $lakutataAction "install"',
        '  ${If} ${FileExists} "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"',
        '    StrCpy $lakutataAction "upgrade"',
        '  ${EndIf}',
        ...hooks.preinstall ? run('preinstall', '$lakutataAction') : [],
        '!macroend',
        ...hooks.postinstall ? ['', '!macro customInstall', ...run('postinstall', '$lakutataAction'), '!macroend'] : [],
        ...hooks.preremove ? ['', '!macro customUnInstall', '  ${IfNot} ${isUpdated}', ...run('preremove', 'remove').map((line: string): string => `  ${line}`), '  ${EndIf}', '!macroend'] : [],
        ''
    ]
    const file: string = path.join(directory, 'installer.nsh')
    await writeFile(file, lines.join('\r\n'))
    return file
}

/**
 * Make the installers of an Electron application (lakutata.installer.runtime: electron) for the platform it is made on,
 * by electron-builder: its main process bundled with its dependencies (lakutata package bundle), Electron left out; its native
 * addons and its resources (lakutata.resources: its renderer, its preload script) next to its archive (app.asar), in the
 * resources of Electron. The configuration of electron-builder is made from lakutata.installer, lakutata.installer.electron
 * merged over it; the scripts of the application are run by its installers
 * @param project
 * @param manifest
 * @param config
 * @param options
 */
export async function BuildElectronInstaller(project: string, manifest: Record<string, any>, config: InstallerConfig, options: InstallerOptions): Promise<InstallerResult> {
    if (config.service) throw new Error('An Electron application is not a service (lakutata.installer.service): it runs in the session of its user')
    const platform: 'linux' | 'mac' | 'win' = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
    const warnings: string[] = []
    const targets: string[] = options.targets?.length ? options.targets : config[platform]?.targets ?? ELECTRON_TARGETS[platform]
    const nodeRequire: NodeJS.Require = createRequire(path.join(project, 'package.json'))
    let builder: string
    try {
        builder = nodeRequire.resolve('electron-builder')
    } catch {
        throw new Error('The installers of the Electron applications are made by electron-builder: install it (npm install --save-dev electron-builder)')
    }
    const electronBuilder = createRequire(builder)('electron-builder')
    const templates: string = path.join(path.dirname(createRequire(builder).resolve('app-builder-lib/package.json')), 'templates', 'linux')
    const {sanitizeFileName} = createRequire(builder)('builder-util/out/filename')
    let electron: string
    try {
        electron = path.dirname(nodeRequire.resolve('electron/package.json'))
    } catch {
        throw new Error('The Electron application has no electron package: install it (npm install --save-dev electron)')
    }
    const version: string = String(manifest.version ?? '')
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`The version of the application "${version}" must be a version (1.2.3) of the package.json`)
    const name: string = config.name ?? String(manifest.name ?? 'app').replace(/^@[^/]+\//, '').toLowerCase()
    const productName: string = config.productName ?? (typeof manifest.productName === 'string' ? manifest.productName : name)
    const appId: string = config.appId ?? name
    const description: string = config.description ?? manifest.description ?? productName
    const author: string | undefined = config.maintainer ?? (typeof manifest.author === 'string' ? manifest.author : manifest.author?.name && (manifest.author.email ? `${manifest.author.name} <${manifest.author.email}>` : manifest.author.name))
    //Where the installers put the application
    const prefix: string = platform === 'linux' ? `/opt/${sanitizeFileName(productName)}` : platform === 'mac' ? `/Applications/${productName}.app` : ''
    const scripts: Record<string, TargetScripts> = ResolveScripts(project, platform, config[platform] as PlatformScripts | undefined, targets, warnings, ElectronHooks(platform), false)
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-electron-'))
    try {
        //The application of electron-builder: its main process, its package.json; its native addons and its resources next to it
        const application: string = path.join(work, 'app')
        const bundle: BundleResult = await BundleProject({
            project: project,
            entry: options.entry,
            minify: options.minify,
            external: ['electron', ...options.external ?? []],
            outfile: path.join(application, 'main.cjs'),
            directories: {native: path.join(work, 'main.native'), resources: path.join(work, 'main.resources')}
        })
        const maintainer: string = platform === 'linux' ? Maintainer(author, name, warnings) : author ?? name
        //The packages of fpm need a homepage
        let homepage: string | undefined = config.homepage ?? (typeof manifest.homepage === 'string' ? manifest.homepage : undefined)
        if (!homepage && platform === 'linux') {
            warnings.push('The packages of Linux need the homepage of the application (the homepage of the package.json, or lakutata.installer.homepage): NONE is given')
            homepage = 'NONE'
        }
        await writeFile(path.join(application, 'package.json'), `${JSON.stringify({
            name: name,
            productName: productName,
            version: version,
            description: description,
            author: maintainer,
            homepage: homepage,
            license: config.license ?? manifest.license,
            //The name of the windows on Linux, which associates them with the launcher of the application
            desktopName: `${name}.desktop`,
            main: 'main.cjs'
        }, null, 2)}\n`)
        await writeFile(path.join(work, 'package.json'), `${JSON.stringify({name: name, version: version, private: true}, null, 2)}\n`)
        const outdir: string = path.resolve(project, options.outdir ?? path.join('dist', 'installer'))
        const own: Record<string, unknown> = {}
        for (const target of targets) {
            const resolved: TargetScripts | undefined = scripts[target]
            if (!resolved) continue
            if (platform === 'linux' && (target === 'deb' || target === 'rpm') && Object.keys(resolved.hooks).length) own[target] = await FpmScripts(target, resolved, prefix, templates, path.join(work, 'scripts'))
            if (platform === 'mac' && target === 'pkg' && Object.keys(resolved.hooks).length) own.pkg = {scripts: await PkgScripts(resolved, prefix, path.join(work, 'pkg-scripts'))}
            if (platform === 'win' && target === 'nsis') {
                const include: string | undefined = await NsisInclude({...resolved, include: resolved.include && {...resolved.include, file: path.resolve(project, resolved.include.file)}}, path.join(work, 'nsis'))
                if (include) own.nsis = {include: include}
            }
        }
        //The icon of the application, in the formats of the platform: icns (macOS), ico (Windows), the PNG of each size (Linux)
        const appIcon = ApplicationIcon(project, manifest)
        const icons: Record<string, unknown> = {}
        if (appIcon) {
            const directory: string = path.join(work, 'icons')
            await mkdir(directory, {recursive: true})
            if (platform === 'mac') {
                if (appIcon.image.width < 1024) warnings.push(`The icon of the application ${path.relative(project, appIcon.file)} is ${appIcon.image.width} pixels: 1024 make the icons of the Retina screens of macOS`)
                await writeFile(path.join(directory, 'icon.icns'), IcnsFile(appIcon.image))
                icons.mac = {icon: path.join(directory, 'icon.icns')}
            } else if (platform === 'win') {
                await writeFile(path.join(directory, 'icon.ico'), IcoFile(appIcon.image))
                icons.win = {icon: path.join(directory, 'icon.ico')}
            } else {
                await WriteLinuxIcons(appIcon.image, path.join(directory, 'linux'))
                icons.linux = {icon: path.join(directory, 'linux')}
            }
        }
        const electronDist: string = path.join(electron, 'dist')
        const generated: Record<string, unknown> = {
            appId: appId,
            productName: productName,
            electronVersion: JSON.parse(readFileSync(path.join(electron, 'package.json'), 'utf8')).version,
            //The Electron of the project (the one of the platform): not downloaded again
            ...existsSync(electronDist) ? {electronDist: electronDist} : {},
            directories: {app: 'app', output: outdir},
            files: ['main.cjs', 'package.json'],
            extraResources: [
                ...bundle.nativeDirectory ? [{from: bundle.nativeDirectory, to: path.basename(bundle.nativeDirectory)}] : [],
                ...bundle.resourcesDirectory ? [{from: bundle.resourcesDirectory, to: path.basename(bundle.resourcesDirectory)}] : []
            ],
            //The dependencies are bundled
            npmRebuild: false,
            ...platform === 'linux' ? {linux: {maintainer: maintainer, ...config.vendor ? {vendor: config.vendor} : {}}} : {},
            ...own
        }
        //Their own configurations (the one of Linux has its maintainer)
        for (const [key, value] of Object.entries(icons)) generated[key] = {...generated[key] as Record<string, unknown>, ...value as Record<string, unknown>}
        const electronConfig: unknown = config.electron ?? {}
        if (!electronConfig || typeof electronConfig !== 'object' || Array.isArray(electronConfig)) throw new Error('The configuration of electron-builder (lakutata.installer.electron) must be an object')
        for (const target of Object.keys(own)) {
            for (const option of ['afterInstall', 'afterRemove', 'fpm', 'include', 'scripts']) {
                if ((electronConfig as Record<string, any>)[target]?.[option] !== undefined && (own[target] as Record<string, unknown>)[option] !== undefined) throw new Error(`lakutata.installer.electron.${target}.${option} replaces what runs the scripts of the application: give the script to lakutata.installer.${platform}.scripts`)
            }
        }
        const merged: Record<string, any> = Merge(generated, electronConfig as Record<string, any>)
        //The 7-Zip of electron-builder filters the executables of ARM64 by its ARM64 filter, which the installers of NSIS
        //do not extract (they leave them out): the BCJ filter is the one they extract
        const filter: boolean = platform === 'win' && process.arch === 'arm64' && process.env.ELECTRON_BUILDER_7Z_FILTER === undefined
        if (filter) process.env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ'
        let artifacts: string[]
        try {
            artifacts = await electronBuilder.build({
                projectDir: work,
                targets: electronBuilder.Platform.current().createTarget(targets, electronBuilder.Arch[process.arch]),
                config: merged,
                publish: 'never'
            })
        } finally {
            if (filter) delete process.env.ELECTRON_BUILDER_7Z_FILTER
        }
        const files: { target: string, file: string, size: number }[] = []
        for (const file of artifacts.filter((artifact: string): boolean => !/\.(blockmap|yml)$/.test(artifact))) {
            const target: string = targets.find((candidate: string): boolean => file.toLowerCase().endsWith(`.${candidate.toLowerCase()}`)) ?? path.extname(file).slice(1)
            files.push({target: target, file: file, size: (await stat(file)).size})
        }
        const electronVersion: string = merged.electronVersion
        const executable: ExecutableResult = {
            name: productName,
            file: application,
            platform: `${process.platform}-${process.arch}`,
            size: bundle.size,
            native: bundle.native?.modules ?? [],
            resources: bundle.resources,
            runtime: `Electron v${electronVersion}`,
            warnings: []
        }
        return {name: name, version: version, files: files, executable: executable, warnings: warnings}
    } finally {
        await rm(work, {recursive: true, force: true})
    }
}

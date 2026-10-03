import {createHash} from 'node:crypto'
import {readdirSync} from 'node:fs'
import {copyFile, cp, mkdir, rm, stat, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {Run} from '../Processes.js'
import {EnsureTool} from '../Tools.js'
import type {InstallerPlan} from '../Installer.js'
import type {InstallerHook, ScriptFile, TargetScripts} from '../Scripts.js'

/**
 * The installers of Windows: the installer of NSIS (.exe), the package of Windows Installer (.msi), the zip archive of
 * the directory of the executable
 */
export const WINDOWS_TARGETS = ['nsis', 'msi', 'zip'] as const

export type WindowsTarget = typeof WINDOWS_TARGETS[number]

type Service = NonNullable<InstallerPlan['service']>

/**
 * The architecture of the packages (the one of the executable)
 */
function Arch(): string {
    return process.arch === 'arm64' ? 'arm64' : 'x64'
}

/**
 * A text of XML
 * @param value
 */
function Xml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * A value in double quotes, as the environment file of the application gives them (LAKUTATA_ENV_FILE)
 * @param value
 */
function DoubleQuoted(value: string): string {
    return `"${value.replace(/[\\"$`]/g, '\\$&')}"`
}

/**
 * An argument of a command line of Windows
 * @param arg
 */
function Argument(arg: string): string {
    if (arg && !/[\s"]/.test(arg)) return arg
    return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
}

/**
 * The name of the account of a service: a virtual account (NT SERVICE\<service>) by default, LocalService,
 * NetworkService, LocalSystem
 * @param service
 */
function Account(service: Service): { domain: string, user: string } | undefined {
    const user: string = service.user
    if (/^(LocalSystem|root)$/i.test(user)) return undefined
    if (/^(LocalService|NetworkService)$/i.test(user)) return {domain: 'NT AUTHORITY', user: user}
    const [domain, name] = user.includes('\\') ? user.split('\\') : ['NT SERVICE', user]
    return {domain: domain, user: name}
}

/**
 * The paths of an application installed on Windows: in Program Files, its data in ProgramData
 * @param plan
 */
function Paths(plan: InstallerPlan) {
    return {
        wrapper: `${plan.name}-service`,
        environment: `%ProgramData%\\${plan.name}\\${plan.name}.env`
    }
}

/**
 * The environment file of the service: its variables, which the administrators change (kept by the upgrades), read by
 * the application at its start (LAKUTATA_ENV_FILE)
 * @param service
 */
function EnvironmentFile(service: Service): string {
    return `# The environment of the service ${service.name}, read when it starts (Restart-Service ${service.name})\r\n${Object.entries(service.env).map(([name, value]: [string, string]): string => `${name}=${DoubleQuoted(value)}`).join('\r\n')}\r\n`
}

/**
 * The configuration of WinSW, the wrapper running the application as a service: stopped by Ctrl+C (SIGINT for node,
 * the application ends gracefully), its environment file, its directory, its account, its logs
 * @param plan
 * @param service
 */
function ServiceConfiguration(plan: InstallerPlan, service: Service): string {
    const account = Account(service)
    return [
        '<service>',
        `  <id>${Xml(service.name)}</id>`,
        `  <name>${Xml(plan.productName)}</name>`,
        `  <description>${Xml(service.description)}</description>`,
        `  <executable>%BASE%\\${Xml(plan.program)}.exe</executable>`,
        ...service.args.length ? [`  <arguments>${Xml(service.args.map(Argument).join(' '))}</arguments>`] : [],
        `  <workingdirectory>%ProgramData%\\${Xml(plan.name)}</workingdirectory>`,
        `  <env name="LAKUTATA_ENV_FILE" value="${Xml(Paths(plan).environment)}"/>`,
        `  <startmode>${service.autoStart ? 'Automatic' : 'Manual'}</startmode>`,
        '  <stoptimeout>30 sec</stoptimeout>',
        ...service.restart === 'no' ? [] : ['  <onfailure action="restart" delay="5 sec"/>'],
        ...account ? ['  <serviceaccount>', `    <domain>${Xml(account.domain)}</domain>`, `    <user>${Xml(account.user)}</user>`, '  </serviceaccount>'] : [],
        `  <logpath>%ProgramData%\\${Xml(plan.name)}\\logs</logpath>`,
        '  <log mode="roll-by-size">',
        '    <sizeThreshold>10240</sizeThreshold>',
        '    <keepFiles>8</keepFiles>',
        '  </log>',
        '</service>',
        ''
    ].join('\r\n')
}

/**
 * The script of the installer of NSIS (Windows PowerShell): install (the data, the environment file written once, the
 * PATH, the service registered), start (the service), stop (the service of the version replaced), uninstall
 * @param plan
 */
function InstallerScript(plan: InstallerPlan): string {
    const service: Service | undefined = plan.service
    const account = service && Account(service)
    const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`
    return [
        '# The installation of the application by its installer (NSIS): install, start, stop (before an upgrade), uninstall',
        'param([string]$Action, [string]$InstallDir)',
        '$ErrorActionPreference = \'Stop\'',
        `$data = Join-Path $env:ProgramData ${quote(plan.name)}`,
        `$wrapper = Join-Path $InstallDir ${quote(`${Paths(plan).wrapper}.exe`)}`,
        'function Invoke-Wrapper([string]$command) { if (Test-Path $wrapper) { & $wrapper $command | Out-Null } }',
        'if ($Action -eq \'install\') {',
        '    New-Item -ItemType Directory -Force $data, (Join-Path $data \'logs\') | Out-Null',
        ...service ? [
            `    $environment = Join-Path $data ${quote(`${plan.name}.env`)}`,
            '    #Kept by the upgrades: the administrators change it',
            `    if (-not (Test-Path $environment)) { [IO.File]::WriteAllText($environment, ${quote(EnvironmentFile(service))}) }`
        ] : [],
        ...plan.addToPath ? [
            '    $path = [Environment]::GetEnvironmentVariable(\'Path\', \'Machine\')',
            '    if (($path -split \';\') -notcontains $InstallDir) { [Environment]::SetEnvironmentVariable(\'Path\', ($path.TrimEnd(\';\') + \';\' + $InstallDir), \'Machine\') }'
        ] : [],
        ...service ? [
            '    Invoke-Wrapper install',
            ...account ? [`    icacls $data /grant ${quote(`${account.domain}\\${account.user}:(OI)(CI)M`)} /T /Q | Out-Null`] : []
        ] : [],
        //After the postinstall script of the application
        '} elseif ($Action -eq \'start\') {',
        ...service?.autoStart ? ['    Invoke-Wrapper start'] : [],
        '} else {',
        ...service ? ['    try { Invoke-Wrapper stop; Invoke-Wrapper uninstall } catch { }'] : [],
        ...plan.addToPath ? [
            '    if ($Action -eq \'uninstall\') {',
            '        $path = [Environment]::GetEnvironmentVariable(\'Path\', \'Machine\')',
            '        [Environment]::SetEnvironmentVariable(\'Path\', (($path -split \';\' | Where-Object { $_ -and $_ -ne $InstallDir }) -join \';\'), \'Machine\')',
            '    }'
        ] : [],
        '}',
        ''
    ].join('\r\n')
}

/**
 * The version of the files of Windows (four numbers)
 * @param version
 */
function NumericVersion(version: string): string {
    const [major, minor, patch] = version.split(/[.+-]/).map((part: string): number => Number.parseInt(part, 10) || 0)
    return `${major}.${minor}.${patch}`
}

/**
 * The script of NSIS of the installer: its files in Program Files, its uninstaller registered, its script run (the
 * service of the version it replaces stopped first, its files being replaced); the scripts of the application run from
 * its temporary directory (the preinstall one before its files are installed, the postinstall one before the service
 * starts, the preremove one once it is stopped, the postremove one once the files are removed), the macros of the file
 * of NSIS it includes inserted
 * @param plan
 * @param stage the files it installs
 * @param file
 * @param scripts the scripts of the application (written with the mark of UTF-8, which Windows PowerShell reads them by)
 */
function NsisScript(plan: InstallerPlan, stage: string, file: string, scripts: { hooks: Partial<Record<InstallerHook, string>>, include?: string }): string {
    const uninstallKey: string = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${plan.appId}`
    //A text given (its $ are not variables of NSIS), a path of NSIS (its variables: $INSTDIR)
    const string = (value: string): string => `"${value.replace(/\$/g, '$$$$').replace(/"/g, '$\\"')}"`
    const variables = (value: string): string => `"${value.replace(/"/g, '$\\"')}"`
    const script = (action: string): string => `nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\\installer.ps1" -Action ${action} -InstallDir "$INSTDIR"'`
    //A script of the application, extracted to the temporary directory of the installer, given what it does ($R9)
    const hook = (name: InstallerHook): string[] => {
        const source: string | undefined = scripts.hooks[name]
        return source ? [
            `  ; The ${name} script of the application`,
            '  InitPluginsDir',
            `  File ${variables(`/oname=$PLUGINSDIR\\${name}.ps1`)} ${string(source)}`,
            `  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\\${name}.ps1" $R9'`,
            '  Pop $0',
            '  StrCmp $0 "0" +2',
            `  Abort "The ${name} script failed ($0)"`
        ] : []
    }
    const macro = (name: string): string[] => scripts.include ? [`  !ifmacrodef ${name}`, `    !insertmacro ${name}`, '  !endif'] : []
    //The directory of the application, given to its scripts
    const environment: string = '  System::Call \'Kernel32::SetEnvironmentVariable(t "LAKUTATA_INSTALL_DIR", t "$INSTDIR")i\''
    return [
        'Unicode true',
        'ManifestDPIAware true',
        '!include "x64.nsh"',
        `Name ${string(plan.productName)}`,
        `OutFile ${string(file)}`,
        //The icon of the application
        ...plan.icon ? [`Icon ${string(plan.icon)}`, `UninstallIcon ${string(plan.icon)}`] : [],
        `InstallDir ${variables(`$PROGRAMFILES64\\${plan.name}`)}`,
        'RequestExecutionLevel admin',
        'SetCompressor /SOLID lzma',
        'ShowInstDetails show',
        'ShowUninstDetails show',
        `VIProductVersion "${NumericVersion(plan.version)}.0"`,
        `VIAddVersionKey "ProductName" ${string(plan.productName)}`,
        `VIAddVersionKey "ProductVersion" ${string(plan.version)}`,
        `VIAddVersionKey "FileVersion" ${string(plan.version)}`,
        `VIAddVersionKey "FileDescription" ${string(plan.description)}`,
        `VIAddVersionKey "CompanyName" ${string(plan.vendor ?? plan.maintainer)}`,
        ...scripts.include ? ['', '; The file of NSIS of the application (win.nsis.include)', `!include ${string(scripts.include)}`, ...macro('customHeader').map((line: string): string => line.trim())] : [],
        '',
        '; The 64-bit registry and system (the installer is a 32-bit program)',
        'Function .onInit',
        '  SetRegView 64',
        '  ${DisableX64FSRedirection}',
        ...macro('customInit'),
        'FunctionEnd',
        'Function un.onInit',
        '  SetRegView 64',
        '  ${DisableX64FSRedirection}',
        ...macro('customUnInit'),
        'FunctionEnd',
        '',
        'Section "Install"',
        '  SetShellVarContext all',
        environment,
        '  ; An upgrade replaces the application installed',
        '  StrCpy $R9 "install"',
        '  IfFileExists "$INSTDIR\\installer.ps1" 0 +2',
        '  StrCpy $R9 "upgrade"',
        ...hook('preinstall'),
        '  ; The service of the version replaced is stopped: its files are replaced',
        '  IfFileExists "$INSTDIR\\installer.ps1" 0 +3',
        `  ${script('stop')}`,
        '  Pop $0',
        '  SetOutPath "$INSTDIR"',
        `  File /r ${string(`${stage}\\*.*`)}`,
        '  WriteUninstaller "$INSTDIR\\uninstall.exe"',
        `  WriteRegStr HKLM ${string(uninstallKey)} "DisplayName" ${string(plan.productName)}`,
        `  WriteRegStr HKLM ${string(uninstallKey)} "DisplayVersion" ${string(plan.version)}`,
        `  WriteRegStr HKLM ${string(uninstallKey)} "Publisher" ${string(plan.vendor ?? plan.maintainer)}`,
        `  WriteRegStr HKLM ${string(uninstallKey)} "InstallLocation" "$INSTDIR"`,
        `  WriteRegStr HKLM ${string(uninstallKey)} "DisplayIcon" ${variables(`$INSTDIR\\${plan.program}.exe`)}`,
        `  WriteRegStr HKLM ${string(uninstallKey)} "UninstallString" '"$INSTDIR\\uninstall.exe"'`,
        `  WriteRegStr HKLM ${string(uninstallKey)} "QuietUninstallString" '"$INSTDIR\\uninstall.exe" /S'`,
        `  WriteRegDWORD HKLM ${string(uninstallKey)} "NoModify" 1`,
        `  WriteRegDWORD HKLM ${string(uninstallKey)} "NoRepair" 1`,
        `  ${script('install')}`,
        '  Pop $0',
        '  StrCmp $0 "0" +2',
        '  Abort "The installation failed ($0)"',
        ...hook('postinstall'),
        `  ${script('start')}`,
        '  Pop $0',
        ...macro('customInstall'),
        'SectionEnd',
        '',
        'Section "Uninstall"',
        '  SetShellVarContext all',
        environment,
        '  StrCpy $R9 "remove"',
        ...macro('customUnInstall'),
        `  ${script('uninstall')}`,
        '  Pop $0',
        ...hook('preremove'),
        '  RMDir /r "$INSTDIR"',
        `  DeleteRegKey HKLM ${string(uninstallKey)}`,
        ...hook('postremove'),
        'SectionEnd',
        ''
    ].join('\r\n')
}

/**
 * A UUID named after a text (version 5): the upgrade code of the packages of an application, the same for its versions
 * @param name
 */
function NamedUuid(name: string): string {
    //The namespace of the URLs (RFC 4122)
    const namespace: Buffer = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')
    const hash: Buffer = createHash('sha1').update(Buffer.concat([namespace, Buffer.from(`lakutata:${name}`)])).digest()
    hash[6] = (hash[6] & 0x0f) | 0x50
    hash[8] = (hash[8] & 0x3f) | 0x80
    const hex: string = hash.subarray(0, 16).toString('hex').toUpperCase()
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * The moments of Windows Installer the scripts of the application are run at (deferred, as the system): the preinstall
 * one before the files are installed (an upgrade has removed the version it replaces), the postinstall one before the
 * services start, the preremove one once they are stopped, the postremove one once the files are removed; not the ones
 * of the removal of the version an upgrade replaces
 */
const MSI_HOOKS: Record<InstallerHook, { id: string, at: string, condition: string }> = {
    preinstall: {id: 'LakutataPreinstall', at: 'Before="InstallFiles"', condition: 'NOT REMOVE'},
    postinstall: {id: 'LakutataPostinstall', at: 'Before="StartServices"', condition: 'NOT REMOVE'},
    preremove: {id: 'LakutataPreremove', at: 'After="StopServices"', condition: 'REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE'},
    postremove: {id: 'LakutataPostremove', at: 'After="RemoveFiles"', condition: 'REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE'}
}

/**
 * The longest command line of Windows
 */
const COMMAND_LINE_LIMIT: number = 32000

/**
 * The command running a script of the application from Windows Installer (a formatted text of it: its brackets are
 * escaped, but the ones of its properties): the script, embedded, written to a temporary file and run by Windows
 * PowerShell as the installer of NSIS runs it (given what it does, the directory of the application)
 * @param script
 * @param action
 */
function MsiCommand(script: ScriptFile, action: string): string {
    const encoded: string = Buffer.from(script.content, 'utf8').toString('base64')
    const formatted = (text: string): string => text.replace(/[[\]]/g, (bracket: string): string => bracket === '[' ? '[\\[]' : '[\\]]')
    const command: string = `"[System64Folder]WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$env:LAKUTATA_INSTALL_DIR='[INSTALLDIR]'.TrimEnd('\\'); ${formatted(`$f = [IO.Path]::Combine([IO.Path]::GetTempPath(), [Guid]::NewGuid().ToString() + '.ps1'); [IO.File]::WriteAllText($f, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')), (New-Object Text.UTF8Encoding $true)); & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $f ${action}; $c = $LASTEXITCODE; Remove-Item -Force $f; exit $c`)}"`
    if (command.length > COMMAND_LINE_LIMIT) throw new Error(`The script ${script.file} is too long for Windows Installer, which runs it by a command line: make it shorter (the one it embeds is ${command.length} characters long, ${COMMAND_LINE_LIMIT} at most)`)
    return command
}

/**
 * The custom actions of Windows Installer running the scripts of the application: the command of each (install or
 * upgrade: an upgrade has found the version it replaces), and when it is run
 * @param hooks
 */
function MsiScripts(hooks: Partial<Record<InstallerHook, ScriptFile>>): { actions: string[], sequence: string[] } {
    const actions: string[] = []
    const sequence: string[] = []
    for (const [hook, script] of Object.entries(hooks) as [InstallerHook, ScriptFile][]) {
        const {id, at, condition} = MSI_HOOKS[hook]
        const variants: [string, string, string][] = hook === 'preinstall' || hook === 'postinstall'
            ? [['Install', 'install', `${condition} AND NOT WIX_UPGRADE_DETECTED`], ['Upgrade', 'upgrade', `${condition} AND WIX_UPGRADE_DETECTED`]]
            : [['Remove', 'remove', condition]]
        for (const [name, action, when] of variants) actions.push(`    <SetProperty Id="${id}" Action="Set${id}${name}" Value="${Xml(MsiCommand(script, action))}" Before="${id}" Sequence="execute">${Xml(when)}</SetProperty>`)
        actions.push(`    <CustomAction Id="${id}" BinaryKey="WixCA" DllEntry="WixQuietExec64" Execute="deferred" Return="check" Impersonate="no"/>`)
        sequence.push(`      <Custom Action="${id}" ${at}>${Xml(condition)}</Custom>`)
    }
    return {actions: actions, sequence: sequence}
}

/**
 * The source of WiX of the package: its files (a component each, their directories), its service (WinSW) installed,
 * started, stopped and removed by Windows Installer, its PATH, its data in ProgramData (its environment file kept by
 * the upgrades and the removals), the versions replaced by the upgrades
 * @param plan
 * @param stage the files it installs
 * @param serviceDirectory the files of its service (WinSW and its configuration)
 * @param environment the environment file
 */
function WixSource(plan: InstallerPlan, stage: string, serviceDirectory: string, environment: string | undefined): string {
    const scripts = MsiScripts(plan.scripts.msi?.hooks ?? {})
    const id = (prefix: string, value: string): string => `${prefix}${createHash('sha1').update(value).digest('hex').slice(0, 30)}`
    const components: string[] = []
    const directory = (absolute: string, relative: string, depth: number): string[] => {
        const indent: string = '  '.repeat(depth)
        const lines: string[] = []
        for (const entry of readdirSync(absolute, {withFileTypes: true}).sort((a, b): number => a.name.localeCompare(b.name))) {
            const file: string = path.join(absolute, entry.name)
            const name: string = relative ? `${relative}/${entry.name}` : entry.name
            if (entry.isDirectory()) {
                lines.push(`${indent}<Directory Id="${id('d', name)}" Name="${Xml(entry.name)}">`, ...directory(file, name, depth + 1), `${indent}</Directory>`)
            } else if (entry.isFile()) {
                const component: string = id('c', name)
                components.push(component)
                lines.push(`${indent}<Component Id="${component}" Guid="*"><File Id="${id('f', name)}" Source="${Xml(file)}" KeyPath="yes"/></Component>`)
            }
        }
        return lines
    }
    const files: string[] = directory(stage, '', 6)
    const service: Service | undefined = plan.service
    const account = service && Account(service)
    const wrapper: string = `${Paths(plan).wrapper}.exe`
    const restart: string = service?.restart === 'no' ? 'none' : 'restart'
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi" xmlns:util="http://schemas.microsoft.com/wix/UtilExtension">',
        `  <Product Id="*" Name="${Xml(plan.productName)}" Language="1033" Version="${NumericVersion(plan.version)}" Manufacturer="${Xml(plan.vendor ?? plan.maintainer)}" UpgradeCode="${NamedUuid(plan.appId)}">`,
        `    <Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine" Description="${Xml(plan.description)}"/>`,
        '    <MajorUpgrade DowngradeErrorMessage="A newer version of [ProductName] is installed."/>',
        '    <MediaTemplate EmbedCab="yes"/>',
        //The icon of the application in the programs of Windows
        ...plan.icon ? [`    <Icon Id="ProductIcon.ico" SourceFile="${Xml(plan.icon)}"/>`, '    <Property Id="ARPPRODUCTICON" Value="ProductIcon.ico"/>'] : [],
        `    <Property Id="ARPINSTALLLOCATION" Value="[INSTALLDIR]"/>`,
        '    <Directory Id="TARGETDIR" Name="SourceDir">',
        '      <Directory Id="ProgramFiles64Folder">',
        `        <Directory Id="INSTALLDIR" Name="${Xml(plan.name)}">`,
        ...files,
        '        </Directory>',
        '      </Directory>',
        '      <Directory Id="CommonAppDataFolder">',
        `        <Directory Id="DATADIR" Name="${Xml(plan.name)}">`,
        '          <Directory Id="LOGSDIR" Name="logs"/>',
        '        </Directory>',
        '      </Directory>',
        '    </Directory>',
        //The data, the logs and the environment file are kept by the removals
        `    <Component Id="Data" Directory="DATADIR" Guid="${NamedUuid(`${plan.appId}:data`)}" Permanent="yes" KeyPath="yes"><CreateFolder/></Component>`,
        `    <Component Id="Logs" Directory="LOGSDIR" Guid="${NamedUuid(`${plan.appId}:logs`)}" Permanent="yes" KeyPath="yes"><CreateFolder/></Component>`,
        ...environment ? [`    <Component Id="Environment" Directory="DATADIR" Guid="${NamedUuid(`${plan.appId}:environment`)}" Permanent="yes" NeverOverwrite="yes"><File Id="EnvironmentFile" Name="${Xml(`${plan.name}.env`)}" Source="${Xml(environment)}" KeyPath="yes"/></Component>`] : [],
        ...plan.addToPath ? [`    <Component Id="Path" Directory="INSTALLDIR" Guid="${NamedUuid(`${plan.appId}:path`)}" KeyPath="yes"><Environment Id="Path" Name="PATH" Value="[INSTALLDIR]" Permanent="no" Part="last" Action="set" System="yes"/></Component>`] : [],
        ...service ? [
            `    <Component Id="Service" Directory="INSTALLDIR" Guid="${NamedUuid(`${plan.appId}:service`)}">`,
            `      <File Id="ServiceWrapper" Source="${Xml(path.join(serviceDirectory, wrapper))}" KeyPath="yes"/>`,
            `      <File Id="ServiceConfiguration" Source="${Xml(path.join(serviceDirectory, `${Paths(plan).wrapper}.xml`))}"/>`,
            `      <ServiceInstall Id="ServiceInstall" Name="${Xml(service.name)}" DisplayName="${Xml(plan.productName)}" Description="${Xml(service.description)}" Type="ownProcess" Start="${service.autoStart ? 'auto' : 'demand'}" ErrorControl="normal"${account ? ` Account="${Xml(`${account.domain}\\${account.user}`)}"` : ''}>`,
            `        <util:ServiceConfig FirstFailureActionType="${restart}" SecondFailureActionType="${restart}" ThirdFailureActionType="${restart}" RestartServiceDelayInSeconds="5" ResetPeriodInDays="1"/>`,
            '      </ServiceInstall>',
            `      <ServiceControl Id="ServiceControl" Name="${Xml(service.name)}"${service.autoStart ? ' Start="install"' : ''} Stop="both" Remove="uninstall" Wait="yes"/>`,
            '    </Component>',
            ...account ? [
                //The data of the service written by its account, once it exists (the service installed), before it starts
                `    <SetProperty Id="GrantData" Value="&quot;[System64Folder]icacls.exe&quot; &quot;[DATADIR].&quot; /grant &quot;${Xml(`${account.domain}\\${account.user}`)}:(OI)(CI)M&quot; /T /Q" Before="GrantData" Sequence="execute"/>`,
                '    <CustomAction Id="GrantData" BinaryKey="WixCA" DllEntry="WixQuietExec64" Execute="deferred" Return="check" Impersonate="no"/>'
            ] : []
        ] : [],
        ...scripts.actions,
        ...account || scripts.sequence.length ? [
            '    <InstallExecuteSequence>',
            ...account ? ['      <Custom Action="GrantData" After="InstallServices">NOT REMOVE</Custom>'] : [],
            ...scripts.sequence,
            '    </InstallExecuteSequence>'
        ] : [],
        '    <Feature Id="Application" Level="1">',
        ...components.map((component: string): string => `      <ComponentRef Id="${component}"/>`),
        '      <ComponentRef Id="Data"/>',
        '      <ComponentRef Id="Logs"/>',
        ...environment ? ['      <ComponentRef Id="Environment"/>'] : [],
        ...plan.addToPath ? ['      <ComponentRef Id="Path"/>'] : [],
        ...service ? ['      <ComponentRef Id="Service"/>'] : [],
        '    </Feature>',
        '  </Product>',
        '</Wix>',
        ''
    ].join('\r\n')
}

/**
 * Run a tool of the builder, which must succeed
 * @param command
 * @param args
 * @param cwd
 * @param what
 */
async function Must(command: string, args: string[], cwd: string, what: string): Promise<void> {
    const result = await Run(command, args, cwd)
    if (result.code !== 0) throw new Error(`${what} cannot be made: ${result.output.trim()}`)
}

/**
 * Make the installers of Windows of an application: the installer of NSIS, the package of Windows Installer (WiX), the
 * zip archive of the directory of the executable; its service run by WinSW
 * @param plan
 * @param targets
 * @param work
 * @param outdir
 */
export async function BuildWindowsPackages(plan: InstallerPlan, targets: WindowsTarget[], work: string, outdir: string): Promise<{ target: string, file: string, size: number }[]> {
    await mkdir(work, {recursive: true})
    const files: { target: string, file: string, size: number }[] = []
    const service: Service | undefined = plan.service
    //The files of the service: WinSW named after the application, its configuration next to it
    const serviceDirectory: string = path.join(work, 'service')
    await rm(serviceDirectory, {recursive: true, force: true})
    await mkdir(serviceDirectory, {recursive: true})
    let environment: string | undefined
    if (service) {
        await copyFile(await EnsureTool('winsw'), path.join(serviceDirectory, `${Paths(plan).wrapper}.exe`))
        await writeFile(path.join(serviceDirectory, `${Paths(plan).wrapper}.xml`), ServiceConfiguration(plan, service))
        environment = path.join(serviceDirectory, `${plan.name}.env`)
        await writeFile(environment, EnvironmentFile(service))
    }
    for (const target of targets) {
        if (target === 'zip') {
            const base: string = `${plan.name}-${plan.version}-win-${Arch()}`
            await rm(path.join(work, base), {recursive: true, force: true})
            await cp(plan.directory, path.join(work, base), {recursive: true})
            const file: string = path.join(outdir, `${base}.zip`)
            await rm(file, {force: true})
            //The tar of Windows writes zip archives (-a)
            await Must('tar', ['-a', '-c', '-f', file, base], work, 'The zip archive')
            files.push({target: target, file: file, size: (await stat(file)).size})
            continue
        }
        if (target === 'nsis') {
            //The files installed: the application, its service, its installation script
            const stage: string = path.join(work, 'nsis')
            await rm(stage, {recursive: true, force: true})
            await cp(plan.directory, stage, {recursive: true})
            if (service) for (const name of readdirSync(serviceDirectory).filter((name: string): boolean => !name.endsWith('.env'))) await copyFile(path.join(serviceDirectory, name), path.join(stage, name))
            //Windows PowerShell reads the scripts of UTF-8 by their mark
            await writeFile(path.join(stage, 'installer.ps1'), `\ufeff${InstallerScript(plan)}`)
            //The scripts of the application, extracted by the installer when it runs them
            const own: TargetScripts | undefined = plan.scripts.nsis
            const hooks: Partial<Record<InstallerHook, string>> = {}
            const directory: string = path.join(work, 'nsis-scripts')
            await rm(directory, {recursive: true, force: true})
            await mkdir(directory, {recursive: true})
            for (const [hook, script] of Object.entries(own?.hooks ?? {}) as [InstallerHook, ScriptFile][]) {
                hooks[hook] = path.join(directory, `${hook}.ps1`)
                await writeFile(hooks[hook], `\ufeff${script.content}`)
            }
            let include: string | undefined
            if (own?.include) {
                include = path.join(directory, 'include.nsh')
                await writeFile(include, own.include.content)
            }
            const file: string = path.join(outdir, `${plan.name}-${plan.version}-${Arch()}-setup.exe`)
            await rm(file, {force: true})
            const script: string = path.join(work, 'installer.nsi')
            await writeFile(script, `\ufeff${NsisScript(plan, stage, file, {hooks: hooks, include: include})}`)
            await Must(await EnsureTool('nsis'), ['/V2', '/INPUTCHARSET', 'UTF8', script], work, 'The installer of NSIS')
            files.push({target: target, file: file, size: (await stat(file)).size})
            continue
        }
        //msi: compiled by candle, linked by light
        const source: string = path.join(work, 'package.wxs')
        await writeFile(source, WixSource(plan, plan.directory, serviceDirectory, environment))
        const candle: string = await EnsureTool('wix')
        const light: string = path.join(path.dirname(candle), 'light.exe')
        const file: string = path.join(outdir, `${plan.name}-${plan.version}-${Arch()}.msi`)
        await rm(file, {force: true})
        await Must(candle, ['-nologo', '-arch', Arch(), '-ext', 'WixUtilExtension', '-out', path.join(work, 'package.wixobj'), source], work, 'The package of Windows Installer')
        await Must(light, ['-nologo', '-ext', 'WixUtilExtension', '-spdb', '-out', file, path.join(work, 'package.wixobj')], work, 'The package of Windows Installer')
        files.push({target: target, file: file, size: (await stat(file)).size})
    }
    return files
}

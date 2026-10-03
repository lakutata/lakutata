import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execSync, spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {BuildInstaller} from '../index.js'
import {WriteServiceFixture} from './support/Fixture.js'

/**
 * The installers of Windows are installed on the machine running the tests (Windows, as an administrator): their
 * service run by WinSW, as its virtual account
 */
const INSTALL: boolean = process.platform === 'win32' && process.env.LAKUTATA_WINDOWS_INSTALL === '1'

const INSTALL_DIRECTORY: string = 'C:\\Program Files\\hello-service'
const DATA_DIRECTORY: string = 'C:\\ProgramData\\hello-service'

/**
 * The log the scripts of the application write to
 */
const HOOKS_LOG: string = 'C:\\ProgramData\\hello-hooks.log'

/**
 * What the scripts of the application were run with: the moment, what the installer does, whether the files of the
 * application are installed, their directory
 */
function Hooks(): string[] {
    return existsSync(HOOKS_LOG) ? readFileSync(HOOKS_LOG, 'utf8').split(/\r?\n/).filter(Boolean) : []
}

/**
 * Run a script of PowerShell, its output given back; it must succeed
 * @param script
 */
function PowerShell(script: string): string {
    const encoded: string = Buffer.from(`$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; ${script}`, 'utf16le').toString('base64')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {encoding: 'utf8'})
    if (result.status !== 0) throw new Error(`${script} failed (${result.status}):\n${result.stdout}${result.stderr}`)
    return result.stdout.trim()
}

/**
 * The directories of the PATH of the machine (Windows Installer gives them with their trailing backslash)
 */
function MachinePath(): string[] {
    return PowerShell(`[Environment]::GetEnvironmentVariable('Path', 'Machine')`).split(';').map((directory: string): string => directory.replace(/\\+$/, ''))
}

/**
 * Remove what the tests left installed: the application of NSIS or of Windows Installer, its data
 */
function RemoveInstalled(): void {
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
        `$entry = Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object { $_.DisplayName -eq 'hello-service' }`,
        `if ($entry.PSChildName -match '^\\{') { Start-Process msiexec.exe -ArgumentList '/x', $entry.PSChildName, '/qn', '/norestart' -Wait }` +
        ` elseif (Test-Path '${INSTALL_DIRECTORY}\\uninstall.exe') { Start-Process '${INSTALL_DIRECTORY}\\uninstall.exe' -ArgumentList '/S' -Wait; Start-Sleep 3 }`
    ].join('; ')])
    rmSync(DATA_DIRECTORY, {recursive: true, force: true, maxRetries: 5})
    rmSync(HOOKS_LOG, {force: true})
}

/**
 * What the service answers, once it answers
 */
async function Answer(): Promise<Record<string, string>> {
    let last: unknown
    for (let attempt = 0; attempt < 60; attempt++) {
        try {
            return await (await fetch('http://127.0.0.1:18080/')).json() as Record<string, string>
        } catch (error) {
            last = error
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
        }
    }
    throw new Error(`The service does not answer: ${last}`)
}

/**
 * The version of the application installed, by its uninstaller (the ones of NSIS and of Windows Installer)
 */
function InstalledVersion(): string {
    return PowerShell(`(Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object { $_.DisplayName -eq 'hello-service' }).DisplayVersion`)
}

describe('The installers of Windows', {skip: !INSTALL && 'LAKUTATA_WINDOWS_INSTALL=1 installs them on this machine (Windows, an administrator)'}, (): void => {

    let work: string
    let out: string

    before(async (): Promise<void> => {
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-installer-win-')))
        out = path.join(work, 'out')
        const fixture: string = path.join(work, 'fixture')
        WriteServiceFixture(fixture)
        //npm.cmd, run by the shell
        execSync('npm install --no-audit --no-fund', {cwd: fixture, stdio: 'ignore'})
        //The installers of the two versions (the upgrades)
        for (const version of ['1.0.0', '1.0.1']) {
            const manifest = JSON.parse(readFileSync(path.join(fixture, 'package.json'), 'utf8'))
            writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({...manifest, version: version}))
            mkdirSync(path.join(out, version), {recursive: true})
            await BuildInstaller({project: fixture, targets: ['nsis', 'msi', 'zip'], outdir: path.join(out, version)})
        }
    })

    after((): void => {
        RemoveInstalled()
        rmSync(work, {recursive: true, force: true})
    })

    it('makes the installers of each kind, named after the version and the architecture', (): void => {
        const files: string[] = PowerShell(`Get-ChildItem '${path.join(out, '1.0.0')}' | ForEach-Object { $_.Name }`).split(/\r?\n/).sort()
        assert.deepStrictEqual(files, [`hello-service-1.0.0-${process.arch}-setup.exe`, `hello-service-1.0.0-${process.arch}.msi`, `hello-service-1.0.0-win-${process.arch}.zip`].sort())
    })

    for (const kind of ['nsis', 'msi'] as const) {
        it(`installs by ${kind} the program and its service, upgrades and removes them`, async (): Promise<void> => {
            RemoveInstalled()
            const installer = (version: string): string => kind === 'nsis' ? path.join(out, version, `hello-service-${version}-${process.arch}-setup.exe`) : path.join(out, version, `hello-service-${version}-${process.arch}.msi`)
            const install = (version: string): string => PowerShell(kind === 'nsis'
                ? `$p = Start-Process -FilePath '${installer(version)}' -ArgumentList '/S' -Wait -PassThru; $p.ExitCode`
                : `$p = Start-Process -FilePath msiexec.exe -ArgumentList '/i', '"${installer(version)}"', '/qn', '/norestart' -Wait -PassThru; $p.ExitCode`)
            assert.strictEqual(install('1.0.0'), '0')
            //The scripts of the application (the macro of the file of NSIS included after them); the upgrades of Windows
            //Installer remove the version they replace first
            const line = (hook: string, action: string, files: boolean): string => `${hook} ${action} ${files ? 'files' : 'nofiles'} ${INSTALL_DIRECTORY}`
            const custom: string[] = kind === 'nsis' ? ['customInstall'] : []
            const installed: string[] = [line('preinstall', 'install', false), line('postinstall', 'install', true), ...custom]
            const upgraded: string[] = [line('preinstall', 'upgrade', kind === 'nsis'), line('postinstall', 'upgrade', true), ...custom]
            assert.deepStrictEqual(Hooks(), installed)
            //Started by the installation, as its virtual account, in its directory, with its environment, its resources
            //and its addon
            const answer = await Answer()
            assert.deepStrictEqual(answer, {greeting: 'Hi', mode: 'production', user: 'hello-service', cwd: DATA_DIRECTORY, text: 'Hello', arch: process.arch})
            const service: string = PowerShell(`$s = Get-CimInstance Win32_Service -Filter "Name='hello-service'"; "$($s.State) $($s.StartMode) $($s.StartName)"`)
            assert.strictEqual(service, 'Running Auto NT SERVICE\\hello-service')
            //The program in the PATH of the machine
            assert.ok(MachinePath().includes(INSTALL_DIRECTORY), MachinePath().join(';'))
            assert.strictEqual(spawnSync('cmd.exe', ['/d', '/c', 'hello', 'hello'], {encoding: 'utf8', env: {...process.env, Path: MachinePath().join(';')}}).stdout.trim(), `Hello ${process.arch}`)
            //The administrators change its environment
            PowerShell(`(Get-Content '${DATA_DIRECTORY}\\hello-service.env') -replace '^GREETING=.*', 'GREETING="Bonjour"' | Set-Content '${DATA_DIRECTORY}\\hello-service.env'; Restart-Service hello-service`)
            assert.strictEqual((await Answer()).greeting, 'Bonjour')
            //Upgraded, it runs again, its environment kept
            assert.strictEqual(install('1.0.1'), '0')
            assert.strictEqual((await Answer()).greeting, 'Bonjour')
            assert.strictEqual(InstalledVersion(), '1.0.1')
            assert.deepStrictEqual(Hooks(), [...installed, ...upgraded])
            //Removed: its service, its files and its PATH removed, its data and its environment kept
            assert.strictEqual(PowerShell(kind === 'nsis'
                ? `$p = Start-Process -FilePath '${INSTALL_DIRECTORY}\\uninstall.exe' -ArgumentList '/S' -Wait -PassThru; $p.ExitCode`
                : `$p = Start-Process -FilePath msiexec.exe -ArgumentList '/x', '"${installer('1.0.1')}"', '/qn', '/norestart' -Wait -PassThru; $p.ExitCode`), '0')
            //The uninstaller of NSIS ends while its copy removes the files
            for (let attempt = 0; attempt < 30 && PowerShell(`Test-Path '${INSTALL_DIRECTORY}'`) === 'True'; attempt++) await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
            assert.strictEqual(PowerShell(`Test-Path '${INSTALL_DIRECTORY}'`), 'False')
            for (let attempt = 0; attempt < 30 && Hooks().length < installed.length + upgraded.length + 2; attempt++) await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 500))
            assert.deepStrictEqual(Hooks(), [...installed, ...upgraded, line('preremove', 'remove', true), line('postremove', 'remove', false)])
            assert.strictEqual(PowerShell(`[bool](Get-Service hello-service -ErrorAction SilentlyContinue)`), 'False')
            assert.ok(!MachinePath().includes(INSTALL_DIRECTORY))
            assert.strictEqual(InstalledVersion(), '')
            assert.match(readFileSync(path.join(DATA_DIRECTORY, 'hello-service.env'), 'utf8'), /GREETING="Bonjour"/)
        })
    }
})

import {spawn} from 'node:child_process'
import {readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import type {NwjsRelease, NwjsRuntime, NwjsStage} from '@lakutata/builder'
import {NwjsRunDTO} from '../dtos/NwjsRunDTO.js'
import {NwjsUseDTO} from '../dtos/NwjsUseDTO.js'
import {NwjsVersionsDTO} from '../dtos/NwjsVersionsDTO.js'
import {loadBuilder} from '../lib/Builder.js'
import {done, step} from '../lib/Output.js'

/**
 * The last release of NW.js running on Windows 7, 8 and 8.1 (Chromium 109)
 */
const WINDOWS_7: string = '0.72.0'

/**
 * Whether a version of NW.js is at most another one
 * @param version
 * @param other
 */
function atMost(version: string, other: string): boolean {
    const parts = (value: string): number[] => value.split('.').map((part: string): number => parseInt(part, 10) || 0)
    const [a, b] = [parts(version), parts(other)]
    for (let index: number = 0; index < 3; index++) if (a[index] !== b[index]) return (a[index] ?? 0) < (b[index] ?? 0)
    return true
}

/**
 * The systems a release of NW.js runs on, as its users see them
 * @param release
 */
function systemsOf(release: NwjsRelease): string {
    const windows: string = atMost(release.version, WINDOWS_7) ? 'Windows 7 or later' : 'Windows 10 or later'
    const mac: string = release.platforms.includes('osx-arm64') ? 'macOS (Intel, Apple silicon)' : 'macOS (Intel; Apple silicon through Rosetta)'
    const linux: string = `Linux (${release.platforms.filter((platform: string): boolean => platform.startsWith('linux-')).map((platform: string): string => platform.slice(6)).join(', ')})`
    return `${windows}, ${mac}, ${linux}`
}

/**
 * The commands of the applications of NW.js: its releases, the one of the application, the run of the development
 */
export class NwjsController extends Controller {

    @CLIAction('nwjs versions', NwjsVersionsDTO, {description: 'List the releases of NW.js lakutata runs on: their Node.js, their Chromium, their systems'})
    public async versions(input: NwjsVersionsDTO): Promise<undefined> {
        const {nwjsReleases} = await loadBuilder(process.cwd())
        const releases: NwjsRelease[] = (await nwjsReleases()).filter((release: NwjsRelease): boolean => !atMost(release.node, '18.9.99'))
        const shown: NwjsRelease[] = input.all ? releases : releases.filter((release: NwjsRelease, index: number): boolean => index < 10 || release.version === WINDOWS_7)
        for (const release of shown) {
            const marks: string = [release === releases[0] ? 'latest' : '', release.version === WINDOWS_7 ? 'win7: the last one running on Windows 7, 8 and 8.1' : ''].filter(Boolean).join(', ')
            step(`${release.version.padEnd(9)} ${release.date.padEnd(11)} Node.js ${release.node.padEnd(8)} Chromium ${release.chromium.split('.')[0]}  ${release.platforms.join(' ')}${marks ? `  (${marks})` : ''}`)
        }
        return undefined
    }

    @CLIAction('nwjs use <version>', NwjsUseDTO, {description: 'Give the application of the current directory its version of NW.js (lakutata.nwjs), and write its Node.js and its Chromium into nwjs.json'})
    public async use(input: NwjsUseDTO): Promise<undefined> {
        const {nwjsRelease, downloadNwjs} = await loadBuilder(process.cwd())
        const release: NwjsRelease = await nwjsRelease(input.version)
        const file: string = path.join(process.cwd(), 'package.json')
        const manifest: Record<string, any> = JSON.parse(readFileSync(file, 'utf8'))
        manifest.lakutata = {...manifest.lakutata, nwjs: {...manifest.lakutata?.nwjs, version: release.version}}
        writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
        //What the builds of the user interface and of the application are made for
        writeFileSync(path.join(process.cwd(), 'nwjs.json'), `${JSON.stringify({version: release.version, node: release.node, chromium: release.chromium}, null, 2)}\n`)
        done(`NW.js ${release.version}: Node.js ${release.node}, Chromium ${release.chromium}`)
        step(`Runs on ${systemsOf(release)}`)
        if (input.download) {
            const runtime: NwjsRuntime = await downloadNwjs({version: release.version, flavor: 'sdk'})
            done(`Downloaded NW.js ${runtime.version} (sdk, ${runtime.platform})`)
        }
        return undefined
    }

    @CLIAction('nwjs run [args...]', NwjsRunDTO, {description: 'Run the compiled application of the current directory in NW.js (the build with its developer tools, by default)'})
    public async run(input: NwjsRunDTO): Promise<undefined> {
        const {stageNwjsApp, downloadNwjs} = await loadBuilder(process.cwd())
        const stage: NwjsStage = await stageNwjsApp({project: process.cwd(), outdir: path.join('.nwjs', 'app'), version: input.version})
        const runtime: NwjsRuntime = await downloadNwjs({version: stage.release.version, flavor: input.flavor})
        step(`NW.js ${runtime.version} (${runtime.flavor}, ${runtime.platform}): Node.js ${runtime.node}, Chromium ${runtime.chromium.split('.')[0]}`)
        const code: number = await new Promise((resolve: (code: number) => void, reject: (error: Error) => void): void => {
            const child = spawn(runtime.executable, [stage.directory, ...input.args ?? []], {stdio: 'inherit'})
            child.once('error', reject)
            //Stopped by a signal (Ctrl-C in the terminal): a normal end of the run
            child.once('exit', (exitCode: number | null, signal: NodeJS.Signals | null): void => resolve(signal ? 0 : exitCode ?? 1))
        })
        if (code !== 0) throw new Error(`NW.js exited with ${code}`)
        return undefined
    }
}

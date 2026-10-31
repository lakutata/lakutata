import {existsSync} from 'node:fs'
import {cp, mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {programName} from '../Bundle.js'
import {applicationIcon, icnsFile, icoFile, setExecutableIcon} from '../Icons.js'
import {runCommand} from '../Processes.js'
import {downloadNwjs, type NwjsRuntime} from './Runtime.js'
import {stageNwjsApp, type NwjsStage, type NwjsStageOptions} from './Stage.js'

/**
 * The options of {@link buildNwjsApp}
 */
export type NwjsAppOptions = Omit<NwjsStageOptions, 'outdir'> & {
    /**
     * The directory of the application made (dist/nwjs by default): <program>-<build of NW.js> in it
     */
    outdir?: string
}

/**
 * The application of NW.js made by {@link buildNwjsApp}, distributed as it is or by its installers
 */
export type NwjsApp = {
    /**
     * Its directory: the runtime of NW.js and the application (Windows, Linux), the bundle of macOS (<product>.app)
     */
    directory: string
    /**
     * Its executable, named after the program (<program>.exe, <product>.app/Contents/MacOS/nwjs, <program>)
     */
    executable: string
    /**
     * The name of its program and of its product
     */
    program: string
    productName: string
    runtime: NwjsRuntime
    /**
     * The application staged (its release, its addons): its directory is removed once copied
     */
    stage: NwjsStage
}

/**
 * Run a command which must succeed
 * @param command
 * @param args
 * @param cwd
 * @param what
 */
async function must(command: string, args: string[], cwd: string, what: string): Promise<void> {
    const result = await runCommand(command, args, cwd)
    if (result.code !== 0) throw new Error(`${what}: ${result.output.trim()}`)
}

/**
 * The four numbers of a version of Windows (1.2.3 → 1.2.3.0)
 * @param version
 */
function windowsVersion(version: string): [number, number, number, number] {
    const parts: number[] = version.split(/[.+-]/).slice(0, 3).map((part: string): number => Math.min(parseInt(part, 10) || 0, 65535))
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, 0]
}

/**
 * Give the executable of NW.js of Windows the identity of the application: its icon, and the names and the version of its
 * version information (the ones the task manager and the properties of the file show)
 * @param file
 * @param identity
 */
async function windowsIdentity(file: string, identity: { productName: string, program: string, version: string, company: string, ico?: Buffer }): Promise<void> {
    if (identity.ico) await setExecutableIcon(file, identity.ico)
    const {NtExecutable, NtExecutableResource, Resource} = await import('resedit')
    const executable = NtExecutable.from(await readFile(file), {ignoreCert: true})
    const resource = NtExecutableResource.from(executable)
    const information = Resource.VersionInfo.fromEntries(resource.entries)[0] ?? Resource.VersionInfo.createEmpty()
    const numbers: [number, number, number, number] = windowsVersion(identity.version)
    information.setFileVersion(...numbers)
    information.setProductVersion(...numbers)
    const languages = information.getAllLanguagesForStringValues()
    for (const language of languages.length ? languages : [{lang: 1033, codepage: 1200}]) {
        information.setStringValues(language, {
            FileDescription: identity.productName,
            ProductName: identity.productName,
            CompanyName: identity.company,
            InternalName: identity.program,
            OriginalFilename: `${identity.program}.exe`,
            FileVersion: identity.version,
            ProductVersion: identity.version
        })
    }
    information.outputToResourceEntries(resource.entries)
    resource.outputResource(executable)
    await writeFile(file, Buffer.from(executable.generate()))
}

/**
 * Make the application of NW.js of a project for this system: the runtime of NW.js (normal) with the application
 * (stageNwjsApp: its bundle, its native addons made to load in NW.js, its resources, its manifest), named after it.
 * On Windows and Linux, the files of the application are next to its executable (nw.exe, nw renamed after its program:
 * the name of its installers, lakutata.installer.name, else the program of its package; on Windows, its icon and its
 * version information are the ones of the application); on macOS, they are in the bundle
 * (<product>.app/Contents/Resources/app.nw), whose Info.plist gives its name, its identifier (the appId of the
 * installer), its version and its icon, signed again (ad hoc). The icon is lakutata.icon
 * @param options
 * @example
 * import {buildNwjsApp} from '@lakutata/builder'
 *
 * //dist/nwjs/desk-osx-arm64/Desk.app on a Mac with Apple silicon
 * const app = await buildNwjsApp({})
 * console.log(app.directory, app.runtime.version)
 */
export async function buildNwjsApp(options: NwjsAppOptions): Promise<NwjsApp> {
    const project: string = path.resolve(options.project ?? process.cwd())
    const manifest: Record<string, any> = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'))
    //The program is named after the package of its installers, else after the program of the package (the package of an
    //application of a workspace is often named app)
    const program: string = String(manifest.lakutata?.installer?.name ?? programName(manifest))
    const productName: string = String(manifest.productName ?? manifest.lakutata?.installer?.productName ?? program)
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-nwjs-app-'))
    try {
        const stage: NwjsStage = await stageNwjsApp({...options, project: project, outdir: path.join(work, 'app'), minify: options.minify ?? true})
        const runtime: NwjsRuntime = await downloadNwjs({version: stage.release.version, flavor: 'normal', platform: options.platform, arch: options.arch})
        const directory: string = path.join(path.resolve(project, options.outdir ?? path.join('dist', 'nwjs')), `${program}-${runtime.platform}`)
        await rm(directory, {recursive: true, force: true})
        await mkdir(directory, {recursive: true})
        const icon = applicationIcon(project, manifest)
        const version: string = String(manifest.version ?? '0.0.0')
        if (runtime.platform.startsWith('osx-')) {
            //ditto keeps the links of the frameworks and the signatures of the helpers
            const bundle: string = path.join(directory, `${productName}.app`)
            await must('ditto', [path.join(runtime.directory, 'nwjs.app'), bundle], directory, 'The bundle of macOS cannot be copied')
            await must('ditto', [stage.directory, path.join(bundle, 'Contents', 'Resources', 'app.nw')], directory, 'The application cannot be copied into the bundle')
            const plist: string = path.join(bundle, 'Contents', 'Info.plist')
            const appId: string = String(manifest.lakutata?.installer?.appId ?? `com.${program}.app`)
            for (const [key, value] of Object.entries({CFBundleName: productName, CFBundleDisplayName: productName, CFBundleIdentifier: appId, CFBundleShortVersionString: version, CFBundleVersion: version})) {
                await must('plutil', ['-replace', key, '-string', value, plist], directory, `${key} cannot be written into the Info.plist`)
            }
            if (icon) await writeFile(path.join(bundle, 'Contents', 'Resources', 'app.icns'), icnsFile(icon.image))
            //Its files changed, the bundle is signed again (ad hoc: the signature of a developer is given by its installer)
            await must('codesign', ['--force', '--deep', '--sign', '-', bundle], directory, 'The bundle cannot be signed')
            return {directory: bundle, executable: path.join(bundle, 'Contents', 'MacOS', 'nwjs'), program: program, productName: productName, runtime: runtime, stage: stage}
        }
        //The links of the runtime of Linux kept as they are (cp -a); the runtime of Windows has none
        for (const source of [runtime.directory, stage.directory]) {
            if (process.platform === 'win32') await cp(source, directory, {recursive: true})
            else await must('cp', ['-a', `${source}/.`, directory], directory, 'The application cannot be copied')
        }
        const windows: boolean = runtime.platform.startsWith('win-')
        const executable: string = path.join(directory, windows ? `${program}.exe` : program)
        await rename(path.join(directory, windows ? 'nw.exe' : 'nw'), executable)
        if (windows) {
            await windowsIdentity(executable, {
                productName: productName,
                program: program,
                version: version,
                company: String(manifest.lakutata?.installer?.vendor ?? (typeof manifest.author === 'string' ? manifest.author : manifest.author?.name) ?? productName),
                ico: icon && icoFile(icon.image)
            })
        }
        if (!existsSync(executable)) throw new Error(`The executable of NW.js ${runtime.version} (${runtime.platform}) is missing`)
        return {directory: directory, executable: executable, program: program, productName: productName, runtime: runtime, stage: stage}
    } finally {
        await rm(work, {recursive: true, force: true})
    }
}

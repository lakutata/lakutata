import {existsSync} from 'node:fs'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {Component} from 'lakutata'
import {Autoload, Singleton} from 'lakutata/decorator/di'
import {Settings} from './Settings.js'
import {Warn} from './Output.js'
import {CachedPackage, DownloadPackage, LatestManifest, type PackageVersion, ResolvePackage} from './Registry.js'
import {ExtractTarGz, Under} from './Tar.js'
import {ToolMajor} from './Versions.js'

/**
 * An official template
 */
export type TemplateInfo = {
    name: string
    description: string
    package: string
}

/**
 * Where a template comes from
 */
export type TemplateSource =
    { kind: 'npm', package: string, version?: string, official: boolean } |
    { kind: 'github', repository: string, ref?: string } |
    { kind: 'local', directory: string }

/**
 * The files of a template ready to be copied
 */
export type PreparedTemplate = {
    /**
     * What the template is ("@lakutata/template-default@3.0.0")
     */
    label: string
    /**
     * The directory of the files of the template
     */
    root: string
    /**
     * Remove the downloaded files
     */
    cleanup(): Promise<void>
}

type CatalogCache = {
    updatedAt: number
    registry: string
    templates: TemplateInfo[]
}

/**
 * The package listing the official templates (its "lakutata.templates" field)
 */
const CATALOG_PACKAGE: string = '@lakutata/templates'

/**
 * The official templates known when the tool was released, when the catalog cannot be fetched
 */
const BUILTIN_TEMPLATES: TemplateInfo[] = [
    {name: 'default', description: 'A minimal application serving HTTP actions', package: '@lakutata/template-default'},
    {name: 'service', description: 'An HTTP API deployed as a Docker image', package: '@lakutata/template-service'},
    {name: 'web-react', description: 'An HTTP API serving a React single-page application (Vite)', package: '@lakutata/template-web-react'},
    {name: 'web-next', description: 'An HTTP API serving a Next.js application from the same process', package: '@lakutata/template-web-next'},
    {name: 'web-vue', description: 'An HTTP API serving a Vue single-page application (Vite)', package: '@lakutata/template-web-vue'},
    {name: 'web-nuxt', description: 'An HTTP API serving a Nuxt application from the same process', package: '@lakutata/template-web-nuxt'}
]

/**
 * How long the catalog is kept, 1 day
 */
const CACHE_TTL: number = 24 * 3600 * 1000

/**
 * The project templates: the official ones are the packages "@lakutata/template-<name>" of the npm registry,
 * the others npm packages, GitHub repositories or local directories
 */
@Autoload()
@Singleton()
export class TemplateCatalog extends Component {

    /**
     * The file of the cache of the catalog
     */
    protected get cacheFile(): string {
        return path.join(Settings.cacheDirectory, 'templates.json')
    }

    /**
     * Read the cached catalog of the registry
     */
    protected async readCache(): Promise<CatalogCache | undefined> {
        try {
            const cache: CatalogCache = JSON.parse(await readFile(this.cacheFile, 'utf8'))
            return cache.registry === Settings.registry && Array.isArray(cache.templates) ? cache : undefined
        } catch {
            return undefined
        }
    }

    /**
     * The official templates: the catalog of the registry, cached for a day
     * @param refresh fetch the catalog even when it is cached
     */
    public async list(refresh: boolean = false): Promise<TemplateInfo[]> {
        const cache: CatalogCache | undefined = await this.readCache()
        if (cache && !refresh && Date.now() - cache.updatedAt < CACHE_TTL) return cache.templates
        const templates: unknown = (await LatestManifest(CATALOG_PACKAGE))?.lakutata?.templates
        if (Array.isArray(templates)) {
            await mkdir(path.dirname(this.cacheFile), {recursive: true})
            await writeFile(this.cacheFile, JSON.stringify({updatedAt: Date.now(), registry: Settings.registry, templates: templates} satisfies CatalogCache, null, 2))
            return templates
        }
        if (cache) {
            Warn(`The catalog of the templates cannot be fetched from ${Settings.registry}, the catalog of ${new Date(cache.updatedAt).toLocaleString()} is used`)
            return cache.templates
        }
        Warn(`The catalog of the templates cannot be fetched from ${Settings.registry}, the templates known by the tool are listed`)
        return BUILTIN_TEMPLATES
    }

    /**
     * Where a template comes from: "npm:<package>[@<version>]", "github:<owner>/<repo>[#<ref>]", a local directory,
     * or the name of an official template
     * @param template
     */
    public async resolve(template: string): Promise<TemplateSource> {
        if (template.startsWith('npm:')) {
            const matched: RegExpExecArray | null = /^((?:@[^/@]+\/)?[^/@]+)(?:@(.+))?$/.exec(template.slice(4))
            if (!matched) throw new Error(`Invalid npm template "${template}": npm:<package>[@<version>]`)
            return {kind: 'npm', package: matched[1], version: matched[2], official: false}
        }
        if (template.startsWith('github:')) {
            const matched: RegExpExecArray | null = /^([^/#]+\/[^/#]+)(?:#(.+))?$/.exec(template.slice(7))
            if (!matched) throw new Error(`Invalid GitHub template "${template}": github:<owner>/<repo>[#<ref>]`)
            return {kind: 'github', repository: matched[1], ref: matched[2]}
        }
        if (/^[./~]/.test(template) || path.isAbsolute(template) || existsSync(template)) {
            const directory: string = path.resolve(template.replace(/^~(?=$|\/)/, os.homedir()))
            if (!existsSync(directory)) throw new Error(`The template directory ${directory} does not exist`)
            return {kind: 'local', directory: directory}
        }
        const official: TemplateInfo | undefined = (await this.list()).find((info: TemplateInfo): boolean => info.name === template)
        return {kind: 'npm', package: official?.package ?? `@lakutata/template-${template}`, official: true}
    }

    /**
     * The package of a template, the cached one when the registry cannot be reached
     * @param source
     * @param work
     */
    protected async preparePackage(source: Extract<TemplateSource, { kind: 'npm' }>, work: string): Promise<string> {
        //An official template has the major version of the tool
        const wanted: string | number | undefined = source.version ?? (source.official ? ToolMajor() : undefined)
        let pkg: PackageVersion | undefined
        let archive: Buffer
        let version: string
        try {
            pkg = await ResolvePackage(source.package, wanted)
        } catch (error: unknown) {
            const cached = typeof wanted === 'string' ? undefined : await CachedPackage(source.package, wanted)
            if (!cached) throw error
            Warn(`${(error as Error).message}, the cached ${source.package}@${cached.version} is used`)
            await ExtractTarGz(cached.archive, work, Under('package'))
            return `${source.package}@${cached.version}`
        }
        if (!pkg) {
            const names: string = source.official ? `, the templates are: ${(await this.list()).map((info: TemplateInfo): string => info.name).join(', ')}` : ''
            throw new Error(`The template ${source.official ? `"${source.package.replace('@lakutata/template-', '')}" ` : ''}does not exist (${source.package} is not on ${Settings.registry})${names}`)
        }
        archive = await DownloadPackage(pkg)
        version = pkg.version
        await ExtractTarGz(archive, work, Under('package'))
        return `${source.package}@${version}`
    }

    /**
     * Get the files of a template
     * @param source
     */
    public async prepare(source: TemplateSource): Promise<PreparedTemplate> {
        if (source.kind === 'local') {
            const root: string = existsSync(path.join(source.directory, 'template')) ? path.join(source.directory, 'template') : source.directory
            return {label: source.directory, root: root, cleanup: async (): Promise<void> => undefined}
        }
        const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-template-'))
        const cleanup = async (): Promise<void> => rm(work, {recursive: true, force: true})
        try {
            let label: string
            if (source.kind === 'npm') {
                label = await this.preparePackage(source, work)
            } else {
                const url: string = `${Settings.githubDownload}/${source.repository}/archive/${source.ref ?? 'HEAD'}.tar.gz`
                const response: Response = await fetch(url, {headers: {'User-Agent': 'lakutata-cli'}, signal: AbortSignal.timeout(60000)})
                if (!response.ok) throw new Error(`The template ${source.repository} cannot be downloaded from ${url}: ${response.status} ${response.statusText}`)
                //The archives of GitHub have a root directory
                await ExtractTarGz(Buffer.from(await response.arrayBuffer()), work, Under(1))
                label = `github:${source.repository}${source.ref ? `#${source.ref}` : ''}`
            }
            //A template package has its files in template/, the other sources are the template
            const root: string = existsSync(path.join(work, 'template')) ? path.join(work, 'template') : work
            return {label: label, root: root, cleanup: cleanup}
        } catch (error: unknown) {
            await cleanup()
            throw error
        }
    }
}

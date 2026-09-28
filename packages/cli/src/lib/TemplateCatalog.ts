import {mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {Component} from 'lakutata'
import {Autoload, Singleton} from 'lakutata/decorator/di'
import {Settings, TEMPLATE_PREFIX} from './Settings.js'
import {Warn} from './Output.js'

/**
 * A project template
 */
export type Template = {
    name: string
    description: string
    repository: string
    branch: string
}

type TemplateCache = {
    updatedAt: number
    source: string
    templates: Template[]
}

/**
 * How long the list of the templates is kept, 1 day
 */
const CACHE_TTL: number = 24 * 3600 * 1000

/**
 * The project templates: the repositories "lakutata-template-<name>" of the owner of the templates, cached for a day
 */
@Autoload()
@Singleton()
export class TemplateCatalog extends Component {

    /**
     * The file of the cache
     */
    protected get cacheFile(): string {
        return path.join(Settings.cacheDirectory, 'templates.json')
    }

    /**
     * The source of the list (the cache of another source is not used)
     */
    protected get source(): string {
        return `${Settings.templateAPI}/users/${Settings.templateOwner}`
    }

    /**
     * Read the cache
     */
    protected async readCache(): Promise<TemplateCache | undefined> {
        try {
            const cache: TemplateCache = JSON.parse(await readFile(this.cacheFile, 'utf8'))
            return cache.source === this.source && Array.isArray(cache.templates) ? cache : undefined
        } catch {
            return undefined
        }
    }

    /**
     * Fetch the templates, all the pages of the repositories
     */
    protected async fetchTemplates(): Promise<Template[]> {
        const templates: Template[] = []
        const headers: Record<string, string> = {'Accept': 'application/vnd.github+json', 'User-Agent': 'lakutata-cli'}
        if (Settings.githubToken) headers.Authorization = `Bearer ${Settings.githubToken}`
        for (let page: number = 1; ; page++) {
            const response: Response = await fetch(`${this.source}/repos?per_page=100&page=${page}`, {headers: headers, signal: AbortSignal.timeout(15000)})
            if (!response.ok) throw new Error(`The list of the templates cannot be fetched: ${response.status} ${response.statusText}${response.status === 403 ? ' (the rate limit of the API may be reached: set GITHUB_TOKEN)' : ''}`)
            const repositories: { name: string, description: string | null, full_name: string, default_branch: string, archived?: boolean }[] = await response.json() as any
            for (const repository of repositories) {
                if (!repository.name.startsWith(TEMPLATE_PREFIX) || repository.archived) continue
                templates.push({
                    name: repository.name.slice(TEMPLATE_PREFIX.length),
                    description: repository.description ?? '',
                    repository: repository.full_name,
                    branch: repository.default_branch
                })
            }
            if (repositories.length < 100) break
        }
        //The default template first
        return templates.sort((a: Template, b: Template): number => a.name === 'default' ? -1 : b.name === 'default' ? 1 : a.name.localeCompare(b.name))
    }

    /**
     * The templates: the cached list when it is recent, the fetched one otherwise (the cached one when it cannot be fetched)
     * @param refresh fetch the list even when it is cached
     */
    public async list(refresh: boolean = false): Promise<Template[]> {
        const cache: TemplateCache | undefined = await this.readCache()
        if (cache && !refresh && Date.now() - cache.updatedAt < CACHE_TTL) return cache.templates
        try {
            const templates: Template[] = await this.fetchTemplates()
            await mkdir(path.dirname(this.cacheFile), {recursive: true})
            await writeFile(this.cacheFile, JSON.stringify({updatedAt: Date.now(), source: this.source, templates: templates} satisfies TemplateCache, null, 2))
            return templates
        } catch (error: unknown) {
            if (!cache) throw error
            Warn(`${(error as Error).message}, the list of ${new Date(cache.updatedAt).toLocaleString()} is used`)
            return cache.templates
        }
    }

    /**
     * A template by name, the list is fetched again when it is not in it
     * @param name
     */
    public async find(name: string): Promise<Template> {
        let template: Template | undefined = (await this.list()).find((candidate: Template): boolean => candidate.name === name)
        if (!template) template = (await this.list(true)).find((candidate: Template): boolean => candidate.name === name)
        if (!template) throw new Error(`The template "${name}" does not exist, the templates are: ${(await this.list()).map((candidate: Template): string => candidate.name).join(', ')}`)
        return template
    }
}

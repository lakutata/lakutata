import os from 'node:os'
import path from 'node:path'

/**
 * The settings of the tool, from the environment variables (the mirrors of GitHub and of npm, the cache)
 */
export const Settings = {
    /**
     * The API listing the template repositories
     */
    get templateAPI(): string {
        return process.env.LAKUTATA_TEMPLATE_API ?? 'https://api.github.com'
    },
    /**
     * The host of the archives of the template repositories
     */
    get templateDownload(): string {
        return process.env.LAKUTATA_TEMPLATE_DOWNLOAD ?? 'https://codeload.github.com'
    },
    /**
     * The owner of the template repositories
     */
    get templateOwner(): string {
        return process.env.LAKUTATA_TEMPLATE_OWNER ?? 'lakutata'
    },
    /**
     * The token of the API (a higher rate limit)
     */
    get githubToken(): string | undefined {
        return process.env.GITHUB_TOKEN || undefined
    },
    /**
     * The npm registry
     */
    get registry(): string {
        return (process.env.LAKUTATA_NPM_REGISTRY ?? process.env.npm_config_registry ?? 'https://registry.npmjs.org').replace(/\/+$/, '')
    },
    /**
     * The directory of the cache of the tool
     */
    get cacheDirectory(): string {
        return process.env.LAKUTATA_CACHE_DIR ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'lakutata')
    }
}

/**
 * The prefix of the names of the template repositories
 */
export const TEMPLATE_PREFIX: string = 'lakutata-template-'

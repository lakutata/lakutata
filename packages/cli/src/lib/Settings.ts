import os from 'node:os'
import path from 'node:path'

/**
 * The settings of the tool, from the environment variables (the npm registry and the GitHub mirror, the cache)
 */
export const Settings = {
    /**
     * The npm registry of the templates and of the versions: the one of npm (npm_config_registry) by default
     */
    get registry(): string {
        return (process.env.LAKUTATA_NPM_REGISTRY ?? process.env.npm_config_registry ?? 'https://registry.npmjs.org').replace(/\/+$/, '')
    },
    /**
     * The host of the archives of the GitHub repositories (the templates "github:owner/repo")
     */
    get githubDownload(): string {
        return (process.env.LAKUTATA_GITHUB_DOWNLOAD ?? 'https://github.com').replace(/\/+$/, '')
    },
    /**
     * The directory of the cache of the tool
     */
    get cacheDirectory(): string {
        return process.env.LAKUTATA_CACHE_DIR ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'lakutata')
    }
}

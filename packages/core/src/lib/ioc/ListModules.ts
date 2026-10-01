import {GlobSync} from '@lakutata/utils/helper/Glob'
import * as path from 'path'
import {flatten} from './Utils.js'
import {BuildResolverOptions, type ResolverOptions} from './Resolvers.js'
import {LifetimeType} from './Lifetime.js'

/**
 * The options when invoking listModules().
 * @interface ListModulesOptions
 */
export interface ListModulesOptions {
    cwd?: string
    glob?: (pattern: string, options: { cwd: string }) => string[]
}

/**
 * An object containing the module name and path (full path to module).
 *
 * @interface ModuleDescriptor
 */
export interface ModuleDescriptor {
    name: string
    path: string
    opts: any
}

/**
 * A glob pattern with associated registration options.
 */
export type GlobWithOptions =
    | [string]
    | [string, BuildResolverOptions<any> | LifetimeType]

/**
 * Default glob: matches files only and follows symbolic links, like the previous fast-glob based lookup
 * @param pattern
 * @param options
 */
function defaultGlob(pattern: string, options: { cwd: string }): string[] {
    return GlobSync(pattern, {cwd: options.cwd, nodir: true, follow: true})
}

// Regex to extract the module name.
const nameExpr = /(.*)\..*/i

/**
 * Internal method for globbing a single pattern.
 *
 * @param  {String} globPattern
 * The glob pattern.
 *
 * @param opts
 * @param  {String} opts.cwd
 * Current working directory, used for resolving filepaths.
 * Defaults to `process.cwd()`.
 *
 * @return {[{name, path, opts}]}
 * The module names and paths.
 *
 * @api private
 */
function _listModules(
    globPattern: string | GlobWithOptions,
    opts?: ListModulesOptions
): Array<ModuleDescriptor> {
    opts = {cwd: process.cwd(), glob: defaultGlob, ...opts}
    let patternOpts: ResolverOptions<any> | null = null
    if (Array.isArray(globPattern)) {
        patternOpts = globPattern[1] as ResolverOptions<any>
        globPattern = globPattern[0]
    }

    // Replace Windows path separators with Posix path
    globPattern = globPattern.replace(/\\/g, '/')

    const result = opts.glob!(globPattern, {cwd: opts.cwd!})
    const mapped = result.map((p) => ({
        name: nameExpr.exec(path.basename(p))![1],
        path: path.resolve(opts!.cwd!, p),
        opts: patternOpts
    }))
    return mapped
}

/**
 * Returns a list of {name, path} pairs,
 * where the name is the module name, and path is the actual
 * full path to the module.
 *
 * @param  {String|Array<String>} globPatterns
 * The glob pattern as a string or an array of strings.
 *
 * @param  {String} opts.cwd
 * Current working directory, used for resolving filepaths.
 * Defaults to `process.cwd()`.
 *
 * @return {[{name, path}]}
 * An array of objects with the module names and paths.
 */
export function listModules(
    globPatterns: string | Array<string | GlobWithOptions>,
    opts?: ListModulesOptions
) {
    if (Array.isArray(globPatterns)) {
        return flatten(globPatterns.map((p) => _listModules(p, opts)))
    }

    return _listModules(globPatterns, opts)
}

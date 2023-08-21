import * as glob from 'fast-glob'
import * as path from 'path'
import {flatten} from './Utils'
import {BuildResolverOptions, ResolverOptions} from './Resolvers'
import {LifetimeType} from './Lifetime'

/**
 * 调用listModules()时的选项
 * @interface ListModulesOptions
 */
export interface ListModulesOptions {
    cwd?: string
    glob?: typeof glob.sync
}

/**
 * 一个包含模块名称和路径（模块的完整路径）的对象
 * @interface ModuleDescriptor
 */
export interface ModuleDescriptor {
    name: string
    path: string
    opts: any
}

/**
 * 一个带有关联注册选项的 glob 模式
 */
export type GlobWithOptions =
    | [string]
    | [string, BuildResolverOptions<any> | LifetimeType]

const nameExpr: RegExp = /(.*)\..*/i

/**
 * 用于模糊匹配单个模式的内部方法
 * @param globPattern
 * @param opts
 */
function _listModules(
    globPattern: string | GlobWithOptions,
    opts?: ListModulesOptions
): Array<ModuleDescriptor> {
    opts = {cwd: process.cwd(), glob: glob.sync, ...opts}
    let patternOpts: ResolverOptions<any> | null = null
    if (Array.isArray(globPattern)) {
        patternOpts = globPattern[1] as ResolverOptions<any>
        globPattern = globPattern[0]
    }
    // Replace Windows path separators with Posix path
    globPattern = globPattern.replace(/\\/g, '/')
    const result: string[] = opts.glob!(globPattern, {cwd: opts.cwd})
    const mapped = result.map((p: string) => ({
        name: nameExpr.exec(path.basename(p))![1],
        path: path.resolve(opts!.cwd!, p),
        opts: patternOpts
    }))
    return mapped
}

/**
 * 返回一个{name, path}对的列表，其中name是模块名称，path是模块的实际完整路径
 * @param globPatterns
 * @param opts
 */
export function listModules(
    globPatterns: string | Array<string | GlobWithOptions>,
    opts?: ListModulesOptions
): ModuleDescriptor[] {
    if (Array.isArray(globPatterns)) return flatten(globPatterns.map((p: string | GlobWithOptions) => _listModules(p, opts)))
    return _listModules(globPatterns, opts)
}

import 'reflect-metadata'
import {pathToFileURL} from 'url'
import {ModuleDescriptor, GlobWithOptions, listModules} from './ListModules.js'
import {Lifetime} from './Lifetime.js'
import {
    RESOLVER,
    asClass,
    asFunction,
    BuildResolverOptions, BuildResolver
} from './Resolvers.js'
import {IDependencyInjectionContainer} from './DependencyInjectionContainer.js'
import {isClass, isFunction} from './Utils.js'
import {camelCase} from 'camel-case'

/**
 * 模块的元数据以及加载的模块本身
 * @interface LoadedModuleDescriptor
 */
export interface LoadedModuleDescriptor extends ModuleDescriptor {
    value: unknown
}

/**
 * 调用loadModules()时的选项
 * @interface LoadModulesOptions
 */
export interface LoadModulesOptions<ESM extends boolean = false> {
    cwd?: string
    formatName?: NameFormatter | BuiltInNameFormatters
    resolverOptions?: BuildResolverOptions<any>
    esModules?: ESM
}

/**
 * 在使用loadModules()时，名称格式化的选项
 * @type BuiltInNameFormatters
 */
export type BuiltInNameFormatters = 'camelCase'

/**
 * 接受正在加载的模块的文件名和模块描述符，并返回一个字符串，用于在容器中注册模块
 * descriptor.name与name相同
 * @type {NameFormatter}
 */
export type NameFormatter = (
    name: string,
    descriptor: LoadedModuleDescriptor
) => string

/**
 * loadModules的依赖项
 */
export interface LoadModulesDeps {
    listModules: typeof listModules
    container: IDependencyInjectionContainer

    require(path: string): any | Promise<any>
}

const nameFormatters: Record<string, NameFormatter> = {
    camelCase: (s: string) => camelCase(s)
}

/**
 * 加载的模块列表
 */
export interface LoadModulesResult {
    loadedModules: Array<ModuleDescriptor>
}

export function loadModules<ESM extends boolean = false>(
    dependencies: LoadModulesDeps,
    globPatterns: string | Array<string | GlobWithOptions>,
    opts?: LoadModulesOptions<ESM>
): ESM extends true ? Promise<LoadModulesResult> : LoadModulesResult
/**
 * 给定一个 glob 字符串数组，将在它们上调用 require，并将容器作为第一个参数调用其默认导出的函数
 *
 * @param  {IDependencyInjectionContainer} dependencies.container
 * 要安装加载的模块的容器
 *
 * @param  {Function} dependencies.listModules
 * 用于列出模块的listModules函数
 *
 * @param  {Function} dependencies.require
 * require函数 - 这是一个依赖项，因为它使得测试更加容易
 *
 * @param  {String[]} globPatterns
 * 加载模块时要使用的 glob 数组
 *
 * @param  {Object} opts
 * 传递给listModules的选项，例如{ cwd: '...' }
 *
 * @param  {(string, ModuleDescriptor) => string} opts.formatName
 * 用于格式化模块在容器中注册的名称
 *
 * @param  {boolean} opts.esModules
 * 将其设置为true以使用Node的原生ECMAScript模块
 *
 * @return {Object}
 * 返回描述结果的对象
 */
export function loadModules<ESM extends boolean>(
    dependencies: LoadModulesDeps,
    globPatterns: string | Array<string | GlobWithOptions>,
    opts?: LoadModulesOptions<ESM>
): Promise<LoadModulesResult> | LoadModulesResult {
    opts ??= {}
    const container: IDependencyInjectionContainer = dependencies.container
    opts = optsWithDefaults(opts, container)
    const modules: ModuleDescriptor[] = dependencies.listModules(globPatterns, opts)
    if (opts.esModules) {
        return loadEsModules(dependencies, container, modules, opts)
    } else {
        const result: LoadedModuleDescriptor[][] = modules.map((m: ModuleDescriptor) => {
            const loaded = dependencies.require(m.path)
            return parseLoadedModule(loaded, m)
        })
        return registerModules(result, container, modules, opts)
    }
}

/**
 * 使用原生的ES6模块和异步的import()加载模块
 * @param {IDependencyInjectionContainer} container
 * @param {ModuleDescriptor[]} modules
 * @param {LoadModulesOptions} opts
 */
async function loadEsModules<ESM extends boolean>(
    dependencies: LoadModulesDeps,
    container: IDependencyInjectionContainer,
    modules: ModuleDescriptor[],
    opts: LoadModulesOptions<ESM>
): Promise<LoadModulesResult> {
    const importPromises: any[] = []
    for (const m of modules) {
        const fileUrl = pathToFileURL(m.path).toString()
        importPromises.push(dependencies.require(fileUrl))
    }
    const imports: any[] = await Promise.all(importPromises)
    const result: any[] = []
    for (let i = 0; i < modules.length; i++) result.push(parseLoadedModule(imports[i], modules[i]))
    return registerModules(result, container, modules, opts)
}

/**
 * 解析已经被引入的模块
 * @param {any} loaded
 * @param {ModuleDescriptor} m
 */
function parseLoadedModule(
    loaded: any,
    m: ModuleDescriptor
): Array<LoadedModuleDescriptor> {
    const items: Array<LoadedModuleDescriptor> = []
    if (!loaded) return items
    if (isFunction(loaded)) {
        items.push({
            name: m.name,
            path: m.path,
            value: loaded,
            opts: m.opts
        })
        return items
    }
    if (loaded.default && isFunction(loaded.default)) {
        // ES6 default export
        items.push({
            name: m.name,
            path: m.path,
            value: loaded.default,
            opts: m.opts
        })
    }
    // loop through non-default exports, but require the RESOLVER property set for
    // it to be a valid service module export.
    for (const key of Object.keys(loaded)) {
        if (key === 'default') {
            // default case handled separately due to its different name (file name)
            continue
        }
        if (isFunction(loaded[key]) && RESOLVER in loaded[key]) {
            items.push({
                name: key,
                path: m.path,
                value: loaded[key],
                opts: m.opts
            })
        }
    }
    return items
}

/**
 * 注册模块
 * @param {ModuleDescriptorVal[][]} modulesToRegister
 * @param {IDependencyInjectionContainer} container
 * @param {ModuleDescriptor[]} modules
 * @param {LoadModulesOptions} opts
 */
function registerModules<ESM extends boolean>(
    modulesToRegister: LoadedModuleDescriptor[][],
    container: IDependencyInjectionContainer,
    modules: ModuleDescriptor[],
    opts: LoadModulesOptions<ESM>
): LoadModulesResult {
    modulesToRegister
        .reduce((acc, cur) => acc.concat(cur), [])
        .filter((x) => x)
        .forEach(registerDescriptor.bind(null, container, opts))
    return {
        loadedModules: modules
    }
}

/**
 * 返回一个具有应用默认值的新选项对象
 */
function optsWithDefaults<ESM extends boolean = false>(
    opts: Partial<LoadModulesOptions<ESM>> | undefined,
    container: IDependencyInjectionContainer
): LoadModulesOptions<ESM> {
    return {
        // Does a somewhat-deep merge on the registration options.
        resolverOptions: {
            lifetime: Lifetime.TRANSIENT,
            ...(opts && opts.resolverOptions)
        },
        ...opts
    }
}

/**
 * 给定一个模块描述符，读取它并将其值注册到容器中
 * @param {IDependencyInjectionContainer} container
 * @param {LoadModulesOptions} opts
 * @param {ModuleDescriptor} moduleDescriptor
 */
function registerDescriptor<ESM extends boolean = false>(
    container: IDependencyInjectionContainer,
    opts: LoadModulesOptions<ESM>,
    moduleDescriptor: LoadedModuleDescriptor & { value: any }
): void {
    const inlineConfig = moduleDescriptor.value[RESOLVER]
    let name = inlineConfig && inlineConfig.name
    if (!name) {
        name = moduleDescriptor.name
        let formatter = opts.formatName
        if (formatter) {
            if (typeof formatter === 'string') formatter = nameFormatters[formatter]
            if (formatter) name = formatter(name, moduleDescriptor)
        }
    }
    let moduleDescriptorOpts = moduleDescriptor.opts
    if (typeof moduleDescriptorOpts === 'string') moduleDescriptorOpts = {lifetime: moduleDescriptorOpts}
    const regOpts: BuildResolver<any> = {
        ...opts.resolverOptions,
        ...moduleDescriptorOpts,
        ...inlineConfig
    }
    const reg: Function = regOpts.register
        ? regOpts.register
        : isClass(moduleDescriptor.value)
            ? asClass
            : asFunction
    container.register(name, reg(moduleDescriptor.value, regOpts))
}

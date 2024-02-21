import {pathToFileURL} from 'url'
import {IDependencyInjectionContainer} from './DependencyInjectionContainer.js'
import {Lifetime} from './Lifetime.js'
import {GlobWithOptions, ModuleDescriptor, listModules} from './ListModules.js'
import {
    BuildResolver,
    BuildResolverOptions,
    RESOLVER,
    asClass,
    asFunction
} from './Resolvers.js'
import {isClass, isFunction} from './Utils.js'
import {CamelCase} from '../base/func/CamelCase.js'
import {As} from '../base/func/As.js'

/**
 * Metadata of the module as well as the loaded module itself.
 * @interface LoadedModuleDescriptor
 */
export interface LoadedModuleDescriptor extends ModuleDescriptor {
    value: unknown
}

/**
 * The options when invoking loadModules().
 * @interface LoadModulesOptions
 */
export interface LoadModulesOptions<ESM extends boolean = false> {
    cwd?: string
    formatName?: NameFormatter | BuiltInNameFormatters
    resolverOptions?: BuildResolverOptions<any>
    esModules?: ESM
}

/**
 * Name formatting options when using loadModules().
 * @type BuiltInNameFormatters
 */
export type BuiltInNameFormatters = 'camelCase'

/**
 * Takes in the filename of the module being loaded as well as the module descriptor,
 * and returns a string which is used to register the module in the container.
 *
 * `descriptor.name` is the same as `name`.
 *
 * @type {NameFormatter}
 */
export type NameFormatter = (
    name: string,
    descriptor: LoadedModuleDescriptor
) => string

/**
 * Dependencies for `loadModules`
 */
export interface LoadModulesDeps {
    listModules: typeof listModules
    container: IDependencyInjectionContainer

    require(path: string): any | Promise<any>
}

const nameFormatters: Record<string, NameFormatter> = {
    camelCase: (s: string) => CamelCase(s)
}

/**
 * The list of loaded modules
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
 * Given an array of glob strings, will call `require`
 * on them, and call their default exported function with the
 * container as the first parameter.
 * @param dependencies
 * @param globPatterns
 * @param opts
 */
export function loadModules<ESM extends boolean>(
    dependencies: LoadModulesDeps,
    globPatterns: string | Array<string | GlobWithOptions>,
    opts?: LoadModulesOptions<ESM>
): Promise<LoadModulesResult> | LoadModulesResult {
    opts ??= {}
    const container: IDependencyInjectionContainer = dependencies.container
    opts = optsWithDefaults(opts)
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
 * Loads the modules using native ES6 modules and the async import()
 * @param dependencies
 * @param container
 * @param modules
 * @param opts
 */
async function loadEsModules<ESM extends boolean>(
    dependencies: LoadModulesDeps,
    container: IDependencyInjectionContainer,
    modules: ModuleDescriptor[],
    opts: LoadModulesOptions<ESM>
): Promise<LoadModulesResult> {
    const importPromises: Promise<any>[] = []
    for (const m of modules) {
        const fileUrl: string = pathToFileURL(m.path).toString()
        importPromises.push(As(dependencies.require(fileUrl)))
    }
    const imports: any[] = await Promise.all(importPromises)
    const result: any[] = []
    for (let i: number = 0; i < modules.length; i++) {
        result.push(As(parseLoadedModule(imports[i], modules[i])))
    }
    return registerModules(result, container, modules, opts)
}

/**
 * Parses the module which has been required
 *
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
        // for module.exports = ...
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
        if (key === 'default') continue
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
 * Registers the modules
 * @param modulesToRegister
 * @param container
 * @param modules
 * @param opts
 */
function registerModules<ESM extends boolean>(
    modulesToRegister: LoadedModuleDescriptor[][],
    container: IDependencyInjectionContainer,
    modules: ModuleDescriptor[],
    opts: LoadModulesOptions<ESM>
): LoadModulesResult {
    modulesToRegister
        .reduce((acc: LoadedModuleDescriptor[], cur: LoadedModuleDescriptor[]) => acc.concat(cur), [])
        .filter((x: LoadedModuleDescriptor) => x)
        .forEach(registerDescriptor.bind(null, container, opts))
    return {
        loadedModules: modules
    }
}

/**
 * Returns a new options object with defaults applied.
 * @param opts
 */
function optsWithDefaults<ESM extends boolean = false>(
    opts: Partial<LoadModulesOptions<ESM>> | undefined
): LoadModulesOptions<ESM> {
    return {
        resolverOptions: {
            lifetime: Lifetime.TRANSIENT,
            ...(opts && opts.resolverOptions)
        },
        ...opts
    }
}

/**
 * Given a module descriptor, reads it and registers it's value with the container.
 * @param container
 * @param opts
 * @param moduleDescriptor
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
        let formatter: NameFormatter | 'camelCase' | undefined = opts.formatName
        if (formatter) {
            if (typeof formatter === 'string') {
                formatter = nameFormatters[formatter]
            }
            if (formatter) {
                name = formatter(name, moduleDescriptor)
            }
        }
    }
    let moduleDescriptorOpts = moduleDescriptor.opts
    if (typeof moduleDescriptorOpts === 'string') {
        moduleDescriptorOpts = {lifetime: moduleDescriptorOpts}
    }
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

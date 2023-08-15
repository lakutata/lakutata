import 'reflect-metadata'
import * as util from 'util'
import {GlobWithOptions, listModules} from './ListModules.js'
import {
    LoadModulesOptions,
    loadModules as realLoadModules,
    LoadModulesResult
} from './LoadModules.js'
import {
    Resolver,
    Constructor,
    asClass,
    asFunction,
    DisposableResolver,
    BuildResolverOptions, BuildResolver
} from './Resolvers.js'
import {last, nameValueToObject, isClass} from './Utils.js'
import {InjectionMode, InjectionModeType} from './InjectionMode.js'
import {Lifetime} from './Lifetime.js'
import {DependencyInjectionResolutionError, DependencyInjectionTypeError} from './Errors.js'
import {importModule} from './LoadModuleNative.js'
import {
    DI_CONTAINER_CREATOR_CONSTRUCTOR,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT_NAME
} from '../../constants/MetadataKey.js'

/**
 * 从createContainer返回的容器具有一些方法和属性。
 * @interface IDependencyInjectionContainer
 */
export interface IDependencyInjectionContainer<Cradle extends object = any> {
    /**
     * 容器配置的选项。
     */
    options: ContainerOptions
    /**
     * 在使用PROXY注入模式时注入的代理对象。
     * 可以直接使用。
     */
    readonly cradle: Cradle
    /**
     * 获取合并容器族谱的注册信息的获取器。
     */
    readonly registrations: RegistrationHash
    /**
     * 已解析模块的缓存。
     */
    readonly cache: Map<string | symbol, CacheEntry>

    /**
     * 以当前容器为父容器，创建一个作用域容器。
     */
    createScope<T extends object = {}>(): IDependencyInjectionContainer<Cradle & T>

    /**
     * Used by `util.inspect`.
     */
    inspect(depth: number, opts?: any): string

    /**
     * 将lib/loadModules绑定到当前容器，并提供它所依赖的实际实现。
     * 此外，将解析使用dependsOn API的任何模块。
     */
    loadModules<ESM extends boolean = false>(
        globPatterns: Array<string | GlobWithOptions>,
        options?: LoadModulesOptions<ESM>
    ): ESM extends false ? this : Promise<this>

    /**
     * 添加一个单独的注册，使用预先构建的解析器。
     */
    register<T>(name: string | symbol, registration: Resolver<T>): this

    /**
     * 将解析器与注册名称配对并进行注册。
     */
    register(nameAndRegistrationPair: NameAndRegistrationPair<Cradle>): this

    /**
     * 解析具有给定名称的注册
     * @param name
     * @param resolveOptions
     */
    resolve<K extends keyof Cradle>(
        name: K,
        resolveOptions?: ResolveOptions
    ): Cradle[K]

    /**
     * 解析具有给定名称的注册
     * @param name
     * @param resolveOptions
     */
    resolve<T>(name: string | symbol, resolveOptions?: ResolveOptions): T

    /**
     * 检查具有给定名称的注册是否存在
     * @param name
     */
    hasRegistration(name: string | symbol): boolean

    /**
     * 递归地通过名称获取注册（如果存在于当前容器或其任何父容器中）
     * @param name
     */
    getRegistration<K extends keyof Cradle>(name: K): Resolver<Cradle[K]> | null

    /**
     * 如果当前容器或其任何父容器中存在具有指定名称的注册，则递归获取该注册
     * @param name
     */
    getRegistration<T = unknown>(name: string | symbol): Resolver<T> | null

    /**
     * 给定一个解析器、类或函数，构建它并返回
     * 不缓存它，这意味着如果传递了一个解析器，那么不会使用任何在生命周期中配置的设置
     * @param targetOrResolver
     * @param opts
     */
    build<T>(
        targetOrResolver: ClassOrFunctionReturning<T> | Resolver<T>,
        opts?: BuildResolverOptions<T>
    ): T

    /**
     * 销毁该容器及其子容器，对所有可释放的注册进行清理并清除缓存
     * 仅适用于具有SCOPED或SINGLETON生命周期的注册
     */
    dispose(): Promise<void>
}

/**
 * 可选的解析选项。
 */
export interface ResolveOptions {
    /**
     * 如果设置为true，并且resolve无法找到请求的依赖项，则返回undefined而不是抛出错误。
     */
    allowUnregistered?: boolean
}

/**
 * 缓存条目。
 */
export interface CacheEntry<T = any> {
    /**
     * 解析值的解析器。
     */
    resolver: Resolver<T>
    /**
     * 解析的值。
     */
    value: T
}

/**
 * 注册一个注册项。
 * @interface NameAndRegistrationPair
 */
export type NameAndRegistrationPair<T> = {
    [U in keyof T]?: Resolver<T[U]>
}

/**
 * 返回类型为 T 的函数。
 */
export type FunctionReturning<T> = (...args: Array<any>) => T

/**
 * 返回 T 的类或函数。
 */
export type ClassOrFunctionReturning<T> = FunctionReturning<T> | Constructor<T>

/**
 * createContainer 函数的选项。
 */
export interface ContainerOptions {
    require?: (id: string) => any
    injectionMode?: InjectionModeType
}

/**
 * 包含注册项的散列，其中名称是键。
 */
export type RegistrationHash = Record<string | symbol | number, Resolver<any>>

/**
 * 解析堆栈。
 */
export interface ResolutionStack extends Array<string | symbol> {
}

/**
 * 家族树符号。
 */
const FAMILY_TREE = Symbol('familyTree')

/**
 * 合并注册项符号。
 */
const ROLL_UP_REGISTRATIONS = Symbol('rollUpRegistrations')

/**
 * 调用 toString 时的字符串表示形式。
 */
const CRADLE_STRING_TAG: string = 'DependencyInjectionContainerCradle'

/**
 * 创建一个依赖注入容器实例
 * @param options
 * @param parentContainer
 */
export function createContainer<T extends object = any, U extends object = any>(
    options?: ContainerOptions,
    parentContainer?: IDependencyInjectionContainer<U>
): IDependencyInjectionContainer<T> {
    options = {
        injectionMode: InjectionMode.PROXY,
        ...options
    }

    // 解析堆栈用于跟踪正在解析的模块
    let resolutionStack: ResolutionStack = []

    // 此容器的内部注册存储
    const registrations: RegistrationHash = {}

    /**
     * 传递给函数的Proxy，使它们可以在不知道依赖项来自何处的情况下解析它们。我称之为“cradle（摇篮）”，因为它是注册事物在解析时产生生命的地方。
     */
    const cradle: T = new Proxy(
        {
            [util.inspect.custom]: toStringRepresentationFn
        },
        {
            /**
             * 当进行container.cradle.*的get调用时，会调用get处理程序
             * @param _target
             * @param name
             */
            get: (_target: object, name: string): any => resolve(name),

            /**
             * 在cradle上设置内容会抛出错误
             * @param _target
             * @param name
             */
            set: (_target: object, name: string): boolean => {
                throw new Error(
                    `Attempted setting property "${
                        name as any
                    }" on container cradle - this is not allowed.`
                )
            },

            /**
             * Used for `Object.keys`.
             */
            ownKeys() {
                return Array.from(cradle as any)
            },

            /**
             * Used for `Object.keys`.
             */
            getOwnPropertyDescriptor(target: object, key: string | symbol): PropertyDescriptor | undefined {
                const regs: RegistrationHash = rollUpRegistrations()
                if (Object.getOwnPropertyDescriptor(regs, key)) return {
                    enumerable: true,
                    configurable: true
                }
                return undefined
            }
        }
    ) as T

    // The container being exposed.
    const container: IDependencyInjectionContainer & any = {
        options,
        cradle,
        inspect,
        cache: new Map<string | symbol, CacheEntry>(),
        loadModules,
        createScope,
        register: register as any,
        build,
        resolve,
        hasRegistration,
        dispose,
        getRegistration,
        [util.inspect.custom]: inspect,
        // tslint:disable-next-line
        [ROLL_UP_REGISTRATIONS!]: rollUpRegistrations,
        get registrations() {
            return rollUpRegistrations()
        }
    }

    // 跟踪家族树
    const familyTree: Array<IDependencyInjectionContainer> = parentContainer
            ? [container].concat((parentContainer as any)[FAMILY_TREE])
            : [container]
        // 保存它，以便我们可以从作用域容器中访问它
    ;(container as any)[FAMILY_TREE] = familyTree

    // 我们需要对根容器的引用，以便我们可以检索和存储单例对象
    const rootContainer: IDependencyInjectionContainer = last(familyTree)

    return container

    /**
     * 由util.inspect使用（util.inspect又被console.log使用）
     */
    function inspect(): string {
        return `[DependencyInjectionContainer (${
            parentContainer ? 'scoped, ' : ''
        }registrations: ${Object.keys(container.registrations).length})]`
    }

    /**
     * 从家族树中合并注册项
     * 这可能会非常耗费资源。仅在迭代摇篮代理时使用，这并不是日常使用中应该做的事情，主要用于调试
     */
    function rollUpRegistrations(): RegistrationHash {
        return {
            ...(parentContainer && (parentContainer as any)[ROLL_UP_REGISTRATIONS]()),
            ...registrations
        }
    }

    /**
     * 用于为摇篮提供迭代器。
     */
    function* cradleIterator(): Generator {
        const registrations: RegistrationHash = rollUpRegistrations()
        for (const registrationName in registrations) {
            yield registrationName
        }
    }

    /**
     * 创建一个作用域容器
     */
    function createScope<P extends object>(): IDependencyInjectionContainer<P & T> {
        return createContainer(options, container as IDependencyInjectionContainer<T>)
    }

    /**
     * 为解析器添加一个注册项。
     */
    function register(arg1: any, arg2: any): IDependencyInjectionContainer<T> {
        const obj: Record<string | symbol, any> = nameValueToObject(arg1, arg2)
        const keys: (string | symbol)[] = [...Object.keys(obj), ...Object.getOwnPropertySymbols(obj)]
        for (const key of keys) {
            const value: Resolver<any> = obj[key as any] as Resolver<any>
            registrations[key as any] = value
        }
        return container
    }

    /**
     * 在尝试解析摇篮上的自定义检查器函数时，返回给util.inspect和Symbol.toStringTag。
     */
    function toStringRepresentationFn() {
        return Object.prototype.toString.call(cradle)
    }

    /**
     * 如果在当前容器或其任何父容器中存在具有指定名称的注册项，则递归获取该注册项
     * @param name
     */
    function getRegistration(name: string | symbol) {
        const resolver: Resolver<any> = registrations[name]
        if (resolver) return resolver
        if (parentContainer) return parentContainer.getRegistration(name)
        return null
    }

    /**
     * 使用给定名称解析注册项
     * @param name
     * @param resolveOpts
     */
    function resolve(name: string | symbol, resolveOpts?: ResolveOptions): any {
        resolveOpts = resolveOpts || {}
        try {
            // Grab the registration by name.
            const resolver: Resolver<any> | null = getRegistration(name)
            if (resolutionStack.indexOf(name) > -1) {
                throw new DependencyInjectionResolutionError(
                    name,
                    resolutionStack,
                    'Cyclic dependencies detected.'
                )
            }
            // Used in JSON.stringify.
            if (name === 'toJSON') return toStringRepresentationFn
            // Used in console.log.
            if (name === 'constructor') return createContainer
            if (!resolver) {
                // Checks for some edge cases.
                switch (name) {
                    // The following checks ensure that console.log on the cradle does not
                    // throw an error (issue #7).
                    case util.inspect.custom:
                    case 'inspect':
                    case 'toString':
                        return toStringRepresentationFn
                    case Symbol.toStringTag:
                        return CRADLE_STRING_TAG
                    // Edge case: Promise unwrapping will look for a "then" property and attempt to call it.
                    // Return undefined so that we won't cause a resolution error.
                    case 'then':
                        return undefined
                    // When using `Array.from` or spreading the cradle, this will
                    // return the registration names.
                    case Symbol.iterator:
                        return cradleIterator
                }

                if (resolveOpts.allowUnregistered) {
                    return undefined
                }
                throw new DependencyInjectionResolutionError(name, resolutionStack)
            }
            // Pushes the currently-resolving module name onto the stack
            resolutionStack.push(name)
            // Do the thing
            let cached: CacheEntry | undefined
            let resolved: any
            switch (resolver.lifetime || Lifetime.TRANSIENT) {
                case Lifetime.TRANSIENT:
                    // Transient lifetime means resolve every time.
                    resolved = resolver.resolve(container)
                    break
                case Lifetime.SINGLETON:
                    // Singleton lifetime means cache at all times, regardless of scope.
                    cached = rootContainer.cache.get(name)
                    if (!cached) {
                        resolved = resolver.resolve(container)
                        rootContainer.cache.set(name, {resolver, value: resolved})
                    } else {
                        resolved = cached.value
                    }
                    break
                case Lifetime.SCOPED:
                    // Scoped lifetime means that the container
                    // that resolves the registration also caches it.
                    // When a registration is not found, we travel up
                    // the family tree until we find one that is cached.
                    cached = container.cache.get(name)
                    if (cached !== undefined) {
                        // We found one!
                        resolved = cached.value
                        break
                    }
                    // 如果我们还没有找到一个，我们需要解析并缓存它
                    resolved = resolver.resolve(container)
                    container.cache.set(name, {resolver, value: resolved})
                    break
                default:
                    throw new DependencyInjectionResolutionError(
                        name,
                        resolutionStack,
                        `Unknown lifetime "${resolver.lifetime}"`
                    )
            }
            // 再次从堆栈中Pop出对象，为下一次解析做好准备
            resolutionStack.pop()
            /**
             * 用于加载配置对象至注入项目内
             */
            if ((typeof resolved === 'object' || typeof resolved === 'function') && !Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT_NAME, resolved))
                Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT_NAME, name, resolved)
            return resolved
        } catch (err) {
            // 当遇到错误时，需要重置堆栈
            resolutionStack = []
            throw err
        }
    }

    /**
     * 检查是否存在具有给定名称的注册项
     * @param name
     */
    function hasRegistration(name: string | symbol): boolean {
        return !!getRegistration(name)
    }

    /**
     * 给定一个注册项、类或函数，构建其并返回。不会缓存它，这意味着如果传递了注册项，则不会使用任何配置的生命周期
     * @param targetOrResolver
     * @param opts
     */
    function build<T>(
        targetOrResolver: Resolver<T> | ClassOrFunctionReturning<T>,
        opts?: BuildResolverOptions<T>
    ): T {
        if (targetOrResolver && (targetOrResolver as Resolver<T>).resolve) return (targetOrResolver as Resolver<T>).resolve(container)
        const funcName: string = 'build'
        const paramName: string = 'targetOrResolver'
        DependencyInjectionTypeError.assert(
            targetOrResolver,
            funcName,
            paramName,
            'a registration, function or class',
            targetOrResolver
        )
        DependencyInjectionTypeError.assert(
            typeof targetOrResolver === 'function',
            funcName,
            paramName,
            'a function or class',
            targetOrResolver
        )
        const resolver: BuildResolver<T> & DisposableResolver<T> = isClass(targetOrResolver as any)
            ? asClass(targetOrResolver as Constructor<T>, opts)
            : asFunction(targetOrResolver as FunctionReturning<T>, opts)
        return resolver.resolve(container)
    }

    function loadModules<ESM extends boolean = false>(
        globPatterns: Array<string | GlobWithOptions>,
        opts: LoadModulesOptions<ESM>
    ): ESM extends false ? IDependencyInjectionContainer : Promise<IDependencyInjectionContainer>
    /**
     * 将 lib/loadModules 绑定到此容器，并提供其依赖项的真实实现。此外，任何使用 dependsOn API 的模块都将被解析
     * @param globPatterns
     * @param opts
     */
    function loadModules<ESM extends boolean = false>(
        globPatterns: Array<string | GlobWithOptions>,
        opts: LoadModulesOptions<ESM>
    ): Promise<IDependencyInjectionContainer> | IDependencyInjectionContainer {
        const _loadModulesDeps = {
            require:
                options!.require ||
                function (uri: string) {
                    return require(uri)
                },
            listModules,
            container
        }
        if (opts?.esModules) {
            _loadModulesDeps.require = importModule
            return (
                realLoadModules(
                    _loadModulesDeps,
                    globPatterns,
                    opts
                ) as Promise<LoadModulesResult>
            ).then(() => container)
        } else {
            realLoadModules(_loadModulesDeps, globPatterns, opts)
            return container
        }
    }

    /**
     * 销毁该容器及其子容器，对所有可释放的注册进行清理并清除缓存
     */
    async function dispose(): Promise<void> {
        const entries: [(string | symbol), CacheEntry][] = Array.from(container.cache.entries())
        container.cache.clear()
        return Promise.all(
            entries.map(([name, entry]): Promise<void> => {
                const {resolver, value} = entry
                const disposable: DisposableResolver<any> = resolver as DisposableResolver<any>
                if (disposable.dispose) return Promise.resolve().then(() => disposable.dispose!(value))
                return Promise.resolve()
            })
        ).then(() => undefined)
    }
}

Reflect.defineMetadata(DI_CONTAINER_CREATOR_CONSTRUCTOR, true, createContainer)

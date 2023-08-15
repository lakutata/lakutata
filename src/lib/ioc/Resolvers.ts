import 'reflect-metadata'
import {Lifetime, LifetimeType} from './Lifetime.js'
import {InjectionMode, InjectionModeType} from './InjectionMode.js'
import {isFunction, uniq} from './Utils.js'
import {parseParameterList, Parameter} from './ParamParser.js'
import {DependencyInjectionTypeError} from './Errors.js'
import {IDependencyInjectionContainer, FunctionReturning, ResolveOptions} from './DependencyInjectionContainer.js'
import {DI_CONTAINER_INJECT_PROPERTIES} from '../../constants/MetadataKey.js'

/**
 * RESOLVER符号可以由通过loadModules加载的模块使用，用于配置它们的生命周期、注入模式等。
 */
export const RESOLVER = Symbol('Dependency Injection Resolver Config')

/**
 * 在传递给容器后，预期RESOLVER返回一个对象，该对象的属性在配置的解析器的构造时可访问。
 * @type {Function}
 */
export type InjectorFunction = <T extends object>(
    container: IDependencyInjectionContainer<T>
) => object

/**
 * asClass()、asFunction()或asValue()返回的解析器对象。
 */
export interface Resolver<T> extends ResolverOptions<T> {
    resolve<U extends object>(container: IDependencyInjectionContainer<U>): T
}

/**
 * 由asClass()或asFunction()创建的解析器对象。
 */
export interface BuildResolver<T> extends Resolver<T>, BuildResolverOptions<T> {
    injectionMode?: InjectionModeType
    injector?: InjectorFunction

    setLifetime(lifetime: LifetimeType): this

    setInjectionMode(mode: InjectionModeType): this

    singleton(): this

    scoped(): this

    transient(): this

    proxy(): this

    classic(): this

    inject(injector: InjectorFunction): this
}

/**
 * 可供一次性解析器使用的选项。
 */
export interface DisposableResolverOptions<T> extends ResolverOptions<T> {
    dispose?: Disposer<T>
}

/**
 * 一次性解析器（Disposable resolver）
 */
export interface DisposableResolver<T>
    extends Resolver<T>,
        DisposableResolverOptions<T> {
    disposer(dispose: Disposer<T>): this
}

/**
 * 清理函数类型（Disposer function type）。
 */
export type Disposer<T> = (value: T) => any | Promise<any>

/**
 * 在注册类（class）、函数（function）或值（value）时的选项。
 * @type RegistrationOptions
 */
export interface ResolverOptions<T> {
    /**
     * 仅用于与loadModules一起进行内联配置。
     */
    name?: string
    /**
     * 生命周期设置。
     */
    lifetime?: LifetimeType
    /**
     * 要使用的注册函数。仅用于与loadModules一起进行内联配置。
     */
    register?: (...args: any[]) => Resolver<T>
}

/**
 * 生成器解析器选项（Builder resolver options）。
 */
export interface BuildResolverOptions<T>
    extends ResolverOptions<T>,
        DisposableResolverOptions<T> {
    /**
     * 解析模式（Resolution mode）。
     */
    injectionMode?: InjectionModeType
    /**
     * 注入器函数，用于提供额外的参数（Injector function to provide additional parameters）。
     */
    injector?: InjectorFunction
}

/**
 * 一个类的构造函数。例如：
 *
 *    class MyClass {}
 *
 *    container.registerClass('myClass', MyClass)
 *                                       ^^^^^^^
 */
export type Constructor<T> = { new(...args: any[]): T }

/**
 * 创建一个简单的值解析器，其中给定的值将始终被解析
 * @param value
 */
export function asValue<T>(value: T): Resolver<T> {
    return {
        resolve: () => value
    }
}

/**
 * 创建一个工厂解析器，当请求时，将使用new调用给定的工厂函数
 * @param fn
 * @param opts
 */
export function asFunction<T>(
    fn: FunctionReturning<T>,
    opts?: BuildResolverOptions<T>
): BuildResolver<T> & DisposableResolver<T> {
    if (!isFunction(fn)) {
        throw new DependencyInjectionTypeError('asFunction', 'fn', 'function', fn)
    }
    const defaults = {
        lifetime: Lifetime.TRANSIENT
    }
    opts = makeOptions(defaults, opts, (fn as any)[RESOLVER])
    const resolve = generateResolve(fn)
    let result = {
        resolve,
        ...opts
    }
    return createDisposableResolver(createBuildResolver(result))
}

/**
 * 类似于工厂解析器，但适用于需要 new 的类
 * @param Type
 * @param opts
 */
export function asClass<T = {}>(
    Type: Constructor<T>,
    opts?: BuildResolverOptions<T>
): BuildResolver<T> & DisposableResolver<T> {
    if (!isFunction(Type)) {
        throw new DependencyInjectionTypeError('asClass', 'Type', 'class', Type)
    }
    const defaults: { lifetime: LifetimeType } = {
        lifetime: Lifetime.TRANSIENT
    }
    opts = makeOptions(defaults, opts, (Type as any)[RESOLVER])
    // A function to handle object construction for us, as to make the generateResolve more reusable
    const newClass = function newClass() {
        return Reflect.construct(Type, arguments)
    }
    const resolve = generateResolve(newClass, Type)
    return createDisposableResolver(
        createBuildResolver({
            ...opts,
            resolve
        })
    )
}

/**
 * 解析为指定的注册。
 */
export function aliasTo<T>(name: string): Resolver<T> {
    return {
        resolve(container: IDependencyInjectionContainer): T {
            return container.resolve(name)
        }
    }
}

/**
 * 给定一个选项对象，创建一个流式接口以管理它
 * @param obj
 */
export function createBuildResolver<T, B extends Resolver<T>>(
    obj: B
): BuildResolver<T> & B {
    function setLifetime(this: any, value: LifetimeType) {
        return createBuildResolver({
            ...this,
            lifetime: value
        })
    }

    function setInjectionMode(this: any, value: InjectionModeType) {
        return createBuildResolver({
            ...this,
            injectionMode: value
        })
    }

    function inject(this: any, injector: InjectorFunction) {
        return createBuildResolver({
            ...this,
            injector
        })
    }

    return updateResolver(obj, {
        setLifetime,
        inject,
        transient: partial(setLifetime, Lifetime.TRANSIENT),
        scoped: partial(setLifetime, Lifetime.SCOPED),
        singleton: partial(setLifetime, Lifetime.SINGLETON),
        setInjectionMode,
        proxy: partial(setInjectionMode, InjectionMode.PROXY),
        classic: partial(setInjectionMode, InjectionMode.CLASSIC)
    })
}

/**
 * 给定一个解析器，返回一个带有方法的对象，用于管理清理函数。
 * @param obj
 */
export function createDisposableResolver<T, B extends Resolver<T>>(
    obj: B
): DisposableResolver<T> & B {
    function disposer(this: any, dispose: Disposer<T>) {
        return createDisposableResolver({
            ...this,
            dispose
        })
    }

    return updateResolver(obj, {
        disposer
    })
}

/**
 * 部分应用参数到给定的函数
 */
function partial<T1, R>(fn: (arg1: T1) => R, arg1: T1): () => R {
    return function partiallyApplied(this: any): R {
        return fn.call(this, arg1)
    }
}

/**
 * 基于默认值创建一个选项对象
 * @param defaults
 * @param rest
 */
function makeOptions<T, O>(defaults: T, ...rest: Array<O | undefined>): T & O {
    return Object.assign({}, defaults, ...rest) as T & O
}

/**
 * 创建一个新的解析器，其属性从两者中合并
 * @param source
 * @param target
 */
function updateResolver<T, A extends Resolver<T>, B>(
    source: A,
    target: B
): Resolver<T> & A & B {
    const result = {
        ...(source as any),
        ...(target as any)
    }
    return result
}

/**
 * 返回一个包装的resolve函数，从注入器提供值，并推迟到container.resolve
 * @param container
 * @param locals
 */
function wrapWithLocals<T extends object>(
    container: IDependencyInjectionContainer<T>,
    locals: any
) {
    return function wrappedResolve(name: string, resolveOpts: ResolveOptions) {
        if (name in locals) return locals[name]
        return container.resolve(name, resolveOpts)
    }
}

/**
 * 返回一个新的代理（Proxy），在委托给实际容器之前，检查来自injector的结果是否包含值
 * @param container
 * @param injector
 */
function createInjectorProxy<T extends object>(
    container: IDependencyInjectionContainer<T>,
    injector: InjectorFunction
) {
    const locals = injector(container) as any
    const allKeys = uniq([
        ...Reflect.ownKeys(container.cradle),
        ...Reflect.ownKeys(locals)
    ])
    // TODO: Lots of duplication here from the container proxy.
    // Need to refactor.
    const proxy = new Proxy(
        {},
        {
            /**
             * 首先通过检查局部变量，然后再检查容器来解析值
             */
            get(target: any, name: string | symbol) {
                if (name === Symbol.iterator) {
                    return function* iterateRegistrationsAndLocals() {
                        for (const prop in container.cradle) {
                            yield prop
                        }
                        for (const prop in locals) {
                            yield prop
                        }
                    }
                }
                if (name in locals) {
                    return locals[name]
                }
                return container.resolve(name as string)
            },
            /**
             * Used for `Object.keys`.
             */
            ownKeys() {
                return allKeys
            },
            /**
             * Used for `Object.keys`.
             */
            getOwnPropertyDescriptor(target: any, key: string) {
                if (allKeys.indexOf(key) > -1) {
                    return {
                        enumerable: true,
                        configurable: true
                    }
                }
                return undefined
            }
        }
    )
    return proxy
}

/**
 * 返回一个用于构建依赖图的解析函数
 * @param fn
 * @param dependencyParseTarget
 */
function generateResolve(fn: Function, dependencyParseTarget?: Function) {
    // If the function used for dependency parsing is falsy, use the supplied function
    if (!dependencyParseTarget) dependencyParseTarget = fn
    // Parse out the dependencies
    // NOTE: we do this regardless of whether PROXY is used or not,
    // because if this fails, we want it to fail early (at startup) rather
    // than at resolution time.
    const dependencies: Parameter[] = parseDependencies(dependencyParseTarget)
    // Use a regular function instead of an arrow function to facilitate binding to the resolver.
    return function resolve<T extends object>(
        this: BuildResolver<any>,
        container: IDependencyInjectionContainer<T>
    ) {
        // Because the container holds a global reolutionMode we need to determine it in the proper order of precedence:
        // resolver -> container -> default value
        const injectionMode: InjectionModeType =
            this.injectionMode ||
            container.options.injectionMode ||
            InjectionMode.PROXY
        if (injectionMode !== InjectionMode.CLASSIC) {
            // If we have a custom injector, we need to wrap the cradle.
            const cradle = this.injector
                ? createInjectorProxy(container, this.injector)
                : container.cradle
            //Define inject properties metadata
            Reflect.defineMetadata(DI_CONTAINER_INJECT_PROPERTIES, true, cradle)
            // Return the target injected with the cradle
            return fn(cradle)
        }
        // We have dependencies so we need to resolve them manually
        if (dependencies.length > 0) {
            const resolve = this.injector
                ? wrapWithLocals(container, this.injector(container))
                : container.resolve
            const children: any[] = dependencies.map((p: Parameter) => resolve(p.name, {allowUnregistered: p.optional}))
            return fn(...children)
        }
        return fn()
    }
}

/**
 * 从给定的函数中解析依赖项。
 * 如果它是一个继承自另一个类的类，并且它没有定义构造函数，则尝试解析它的父类构造函数。
 */
function parseDependencies(fn: Function): Array<Parameter> {
    const result: Parameter[] | null = parseParameterList(fn.toString())
    if (!result) {
        // No defined constructor for a class, check if there is a parent
        // we can parse.
        const parent = Object.getPrototypeOf(fn)
        if (typeof parent === 'function' && parent !== Function.prototype) {
            // Try to parse the parent
            return parseDependencies(parent)
        }
        return []
    }
    return result
}

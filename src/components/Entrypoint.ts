import {Component} from '../lib/core/Component.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {CLIContext} from '../lib/context/CLIContext.js'
import {HTTPContext} from '../lib/context/HTTPContext.js'
import {ServiceContext} from '../lib/context/ServiceContext.js'
import {ActionPattern} from '../types/ActionPattern.js'
import {Module} from '../lib/core/Module.js'
import {
    ActionDetails,
    ActionPatternMap,
    GetModuleControllerActionMap
} from '../lib/base/internal/ControllerEntrypoint.js'
import {PatternManager} from '../lib/base/internal/PatternManager.js'
import {Controller} from '../lib/core/Controller.js'
import {As} from '../lib/helpers/As.js'
import {ControllerActionNotFoundException} from '../exceptions/ControllerActionNotFoundException.js'
import {JSONSchema} from '../types/JSONSchema.js'
import {Container} from '../lib/core/Container.js'
import {DestroyRuntimeContainerException} from '../exceptions/DestroyRuntimeContainerException.js'
import {GetObjectPropertyPaths} from '../lib/helpers/GetObjectPropertyPaths.js'
import unset from 'unset-value'
import {UniqueArray} from '../lib/helpers/UniqueArray.js'
import {DTO} from '../lib/core/DTO.js'
import {Singleton} from '../decorators/di/Lifetime.js'

export {ContextType, BaseContext} from '../lib/base/Context.js'
export {CLIContext} from '../lib/context/CLIContext.js'
export {HTTPContext} from '../lib/context/HTTPContext.js'
export {ServiceContext} from '../lib/context/ServiceContext.js'

export type CLIEntrypoint = (module: Module, cliMap: CLIMap, handler: CLIEntrypointHandler, registerDestroy: EntrypointDestroyerRegistrar) => void
export type HTTPEntrypoint = (module: Module, routeMap: HTTPRouteMap, handler: HTTPEntrypointHandler, registerDestroy: EntrypointDestroyerRegistrar) => void
export type ServiceEntrypoint = (module: Module, handler: ServiceEntrypointHandler, registerDestroy: EntrypointDestroyerRegistrar) => void

export type CLIMap = Map<string, JSONSchema>
export type HTTPRouteMap<HTTPMethods = string> = Map<string, Set<HTTPMethods>>

export type CLIEntrypointHandler<T = unknown> = (context: CLIContext, abortController?: AbortController) => Promise<T>
export type HTTPEntrypointHandler<T = unknown> = (context: HTTPContext, abortController?: AbortController) => Promise<T>
export type ServiceEntrypointHandler<T = unknown> = (context: ServiceContext, abortController?: AbortController) => Promise<T>

export type EntrypointDestroyer = () => void | Promise<void>
export type EntrypointDestroyerRegistrar = (destroyer: EntrypointDestroyer) => void

export type EntrypointOptions = {
    cli?: CLIEntrypoint | CLIEntrypoint[]
    http?: HTTPEntrypoint | HTTPEntrypoint[]
    service?: ServiceEntrypoint | ServiceEntrypoint[]
}

/**
 * Build cli entrypoint
 * @param entrypoint
 * @constructor
 */
export const BuildCLIEntrypoint: (entrypoint: CLIEntrypoint) => CLIEntrypoint = (entrypoint: CLIEntrypoint) => entrypoint

/**
 * Build http entrypoint
 * @param entrypoint
 * @constructor
 */
export const BuildHTTPEntrypoint: (entrypoint: HTTPEntrypoint) => HTTPEntrypoint = (entrypoint: HTTPEntrypoint) => entrypoint

/**
 * Build service entrypoint
 * @param entrypoint
 * @constructor
 */
export const BuildServiceEntrypoint: (entrypoint: ServiceEntrypoint) => ServiceEntrypoint = (entrypoint: ServiceEntrypoint) => entrypoint

/**
 * Build entrypoints options for Entrypoint component
 * @param options
 * @constructor
 */
export const BuildEntrypoints: (options: EntrypointOptions) => EntrypointOptions = (options: EntrypointOptions) => options


/**
 * Entrypoint Component
 */
@Singleton()
export class Entrypoint extends Component {

    protected readonly CLIActionPatternMap: ActionPatternMap = new Map()

    protected readonly HTTPActionPatternMap: ActionPatternMap = new Map()

    protected readonly ServiceActionPatternMap: ActionPatternMap = new Map()

    protected readonly CLIActionPatternManager: PatternManager = new PatternManager()

    protected readonly HTTPActionPatternManager: PatternManager = new PatternManager()

    protected readonly ServiceActionPatternManager: PatternManager = new PatternManager()

    protected readonly entrypointDestroyers: EntrypointDestroyer[] = []

    @Configurable()
    public cli?: CLIEntrypoint | CLIEntrypoint[]

    @Configurable()
    public http?: HTTPEntrypoint | HTTPEntrypoint[]

    @Configurable()
    public service?: ServiceEntrypoint | ServiceEntrypoint[]


    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        const {CLI, HTTP, Service} = GetModuleControllerActionMap(this.getModule())
        CLI.forEach((details: ActionDetails, actionPattern: ActionPattern) => {
            this.CLIActionPatternMap.set(actionPattern, details)
            this.CLIActionPatternManager.add(actionPattern, details)
        })
        HTTP.forEach((details: ActionDetails, actionPattern: ActionPattern) => {
            this.HTTPActionPatternMap.set(actionPattern, details)
            this.HTTPActionPatternManager.add(actionPattern, details)
        })
        Service.forEach((details: ActionDetails, actionPattern: ActionPattern) => {
            this.ServiceActionPatternMap.set(actionPattern, details)
            this.ServiceActionPatternManager.add(actionPattern, details)
        })
        this.register(this.service, (entrypoint: ServiceEntrypoint) => this.registerServiceEntrypoint(entrypoint))
        this.register(this.cli, (entrypoint: CLIEntrypoint) => this.registerCLIEntrypoint(entrypoint))
        this.register(this.http, (entrypoint: HTTPEntrypoint) => this.registerHTTPEntrypoint(entrypoint))
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        await Promise.all(this.entrypointDestroyers.map((destroyer: EntrypointDestroyer) => new Promise((resolve, reject) => Promise.resolve(destroyer()).then(resolve).catch(reject))))
    }

    /**
     * Run controller's method and return its result (without AbortController)
     * @param details
     * @param context
     * @param dtoConstructor
     * @protected
     */
    protected async runControllerMethodWithoutAbortController<DTOConstructor extends typeof DTO = typeof DTO>(details: ActionDetails, context: CLIContext | HTTPContext | ServiceContext, dtoConstructor: DTOConstructor): Promise<unknown> {
        const runtimeContainer: Container = this.createScope()
        const controller: Controller = await runtimeContainer.get(details.constructor, {context: context})
        try {
            return await controller.getMethod(As(details.method))(await dtoConstructor.validateAsync(context.data))
        } catch (e) {
            throw e
        } finally {
            runtimeContainer
                .destroy()
                .catch((error: Error) => {
                    throw new DestroyRuntimeContainerException(error.message)
                })
        }
    }

    /**
     * Run controller's method and return its result (with AbortController)
     * @param details
     * @param context
     * @param dtoConstructor
     * @param abortController
     * @protected
     */
    protected async runControllerMethodWithAbortController<DTOConstructor extends typeof DTO = typeof DTO>(details: ActionDetails, context: CLIContext | HTTPContext | ServiceContext, dtoConstructor: DTOConstructor, abortController: AbortController): Promise<unknown> {
        let isAborted: boolean = false
        const abortHandler: () => void = () => {
            isAborted = true
            runtimeContainer
                .destroy()
                .catch((error: Error) => {
                    throw new DestroyRuntimeContainerException(error.message)
                })
        }
        abortController.signal.addEventListener('abort', abortHandler, {once: true})
        const runtimeContainer: Container = this.createScope()
        const controller: Controller = await runtimeContainer.get(details.constructor, {context: context})
        try {
            const runResult: any = await controller.getMethod(As(details.method))(await dtoConstructor.validateAsync(context.data))
            if (!isAborted) return runResult
        } catch (e) {
            if (!isAborted) abortController.signal.removeEventListener('abort', abortHandler)
            throw e
        }
    }

    /**
     * Run controller's method and return its result
     * @param details
     * @param context
     * @param dtoConstructor
     * @param abortController
     * @protected
     */
    protected async runControllerMethod<DTOConstructor extends typeof DTO = typeof DTO>(details: ActionDetails, context: CLIContext | HTTPContext | ServiceContext, dtoConstructor: DTOConstructor, abortController?: AbortController): Promise<unknown> {
        if (abortController) return await this.runControllerMethodWithAbortController<DTOConstructor>(details, context, dtoConstructor, abortController)
        return await this.runControllerMethodWithoutAbortController<DTOConstructor>(details, context, dtoConstructor)
    }

    /**
     * Register
     * @param eps
     * @param registerFunc
     * @protected
     */
    protected register<T>(eps: any | any[] | undefined, registerFunc: (entrypoint: T) => void): void {
        (eps ? Array.isArray(eps) ? eps : [eps] : []).forEach((entrypoint: T) => registerFunc(entrypoint))
    }

    /**
     * Register CLI entrypoint
     * @param entrypoint
     * @protected
     */
    protected registerCLIEntrypoint(entrypoint: CLIEntrypoint): void {
        const cliMap: CLIMap = new Map()
        this.CLIActionPatternMap.forEach((details: ActionDetails, actionPattern: ActionPattern) => cliMap.set(actionPattern.command, details.jsonSchema))
        return entrypoint(this.getModule(), cliMap, async (context: CLIContext, abortController?: AbortController) => {
            const actionPattern: ActionPattern = {
                command: context.command
            }
            const details: ActionDetails | null = this.CLIActionPatternManager.find(actionPattern)
            if (!details) throw new ControllerActionNotFoundException('Command not found')
            return await this.runControllerMethod(details, context, details.dtoConstructor, abortController)
        }, (destroyer: EntrypointDestroyer) => this.entrypointDestroyers.push(destroyer))
    }

    /**
     * Register http entrypoint
     * @param entrypoint
     * @protected
     */
    protected registerHTTPEntrypoint(entrypoint: HTTPEntrypoint): void {
        const routeMap: HTTPRouteMap = new Map()
        for (const actionPattern of this.HTTPActionPatternMap.keys()) {
            const methodsSet: Set<string> = routeMap.get(actionPattern.route) || new Set()
            methodsSet.add(actionPattern.method)
            routeMap.set(actionPattern.route, methodsSet)
        }
        return entrypoint(this.getModule(), routeMap, async (context: HTTPContext, abortController?: AbortController) => {
            const actionPattern: ActionPattern = {
                route: context.route,
                method: context.method
            }
            const details: ActionDetails | null = this.HTTPActionPatternManager.find(actionPattern)
            if (!details) throw new ControllerActionNotFoundException('Route \'{route}\' not found', context)
            return await this.runControllerMethod(details, context, details.dtoConstructor, abortController)
        }, (destroyer: EntrypointDestroyer) => this.entrypointDestroyers.push(destroyer))
    }

    /**
     * Register service entrypoint
     * @param entrypoint
     * @protected
     */
    protected registerServiceEntrypoint(entrypoint: ServiceEntrypoint): void {
        return entrypoint(this.getModule(), async (context: ServiceContext, abortController?: AbortController) => {
            const details: ActionDetails | null = this.ServiceActionPatternManager.find(context.input)
            if (!details) throw new ControllerActionNotFoundException('Controller action not found')
            const patternPaths: string[] = GetObjectPropertyPaths(details.pattern)
            patternPaths.forEach((path: string) => unset(context.data, path))
            const checkPatternPaths: string[] = UniqueArray(patternPaths
                .map((path: string) => path.substring(0, path.lastIndexOf('.')))
                .filter((path: string) => !!path))
            checkPatternPaths.forEach((path: string) => {
                let target: ActionPattern = context.data
                path.split('.').forEach((key: string) => target = target[key] ? target[key] : undefined)
                if (target && !Object.keys(target).length) unset(context.data, path)
            })
            return await this.runControllerMethod(details, context, details.dtoConstructor, abortController)
        }, (destroyer: EntrypointDestroyer) => this.entrypointDestroyers.push(destroyer))
    }
}

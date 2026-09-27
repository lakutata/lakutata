import {Component} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {CLIContext} from './context/CLIContext.js'
import {HTTPContext} from './context/HTTPContext.js'
import {ServiceContext} from './context/ServiceContext.js'
import {ActionPattern} from '@lakutata/core'
import {Module} from '@lakutata/core'
import {
    ActionDetails,
    ActionPatternMap,
    BindControllerToComponent,
    GetComponentControllerActionMap
} from './lib/ControllerEntrypoint.js'
import {PatternManager} from './lib/PatternManager.js'
import {Controller} from './lib/Controller.js'
import {As} from '@lakutata/core/helper'
import {ControllerActionNotFoundException} from './exceptions/ControllerActionNotFoundException.js'
import {JSONSchema} from '@lakutata/core'
import {Container} from '@lakutata/core'
import {DevNull} from '@lakutata/core/helper'
import {GetObjectPropertyPaths} from '@lakutata/core/helper'
import {UniqueArray} from '@lakutata/core/helper'
import {DTO} from '@lakutata/core'
import {Singleton} from '@lakutata/core/decorator/di'
import type {IBaseObjectConstructor} from '@lakutata/core'
import {DuplicateActionNameException} from './exceptions/DuplicateActionNameException.js'
import {AccessControl} from './lib/AccessControl.js'
import {ContextType} from './context/BaseContext.js'
import {AccessControlRule} from './lib/AccessControlRule.js'
import {InvalidActionGroupException} from './exceptions/InvalidActionGroupException.js'
import {
    ActionInvocation,
    ComposeMiddlewares,
    GetClassMiddlewares,
    GetMethodMiddlewares,
    InvocationRunner,
    IsMiddlewareClass,
    Middleware,
    MiddlewareDefinition,
    ValidateMiddlewares
} from './lib/Middleware.js'

//Self-implemented (replaces the `unset-value` package dependency).
function unset(obj: Record<string, any>, path: string): boolean {
    const keys: string[] = path.split('.')
    let current: any = obj
    for (let i = 0; i < keys.length - 1; i++) {
        if (current[keys[i]] === undefined) return false
        current = current[keys[i]]
    }
    const lastKey: string = keys[keys.length - 1]
    if (current[lastKey] !== undefined) { delete current[lastKey]; return true }
    return false
}

export {ContextType, BaseContext} from './context/BaseContext.js'
export {CLIContext} from './context/CLIContext.js'
export {HTTPContext} from './context/HTTPContext.js'
export {ServiceContext} from './context/ServiceContext.js'

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
    controllers: IBaseObjectConstructor<Controller>[]
    middlewares?: MiddlewareDefinition[]
    rules?: IBaseObjectConstructor<AccessControlRule>[]
    cliActionGroups?: Record<string, string>
    cli?: CLIEntrypoint | CLIEntrypoint[]
    httpActionGroups?: Record<string, string>
    http?: HTTPEntrypoint | HTTPEntrypoint[]
    serviceActionGroups?: Record<string, string>
    service?: ServiceEntrypoint | ServiceEntrypoint[]
}

export interface BaseActionInfo {
    readonly id: string
    readonly acl: boolean
    readonly name: string
    readonly description: string
    readonly groups: string[]
    readonly controller: string
    readonly method: string
    readonly jsonSchema: JSONSchema
}

export interface HTTPActionInfo extends BaseActionInfo {
    readonly route: string
}

export interface ServiceActionInfo extends BaseActionInfo {
    readonly pattern: ActionPattern
}

export interface CLIActionInfo extends BaseActionInfo {
    readonly command: string
}

export interface ActionGroupInfo<T extends BaseActionInfo> {
    readonly id: string
    readonly name: string
    actions: T[]
}

export interface EntrypointActions<T extends BaseActionInfo> {
    readonly groups: ActionGroupInfo<T>[],
    readonly actions: T[]
}

/**
 * Build cli entrypoint
 * @param entrypoint
 * @constructor
 */
export const BuildCLIEntrypoint: (entrypoint: CLIEntrypoint) => CLIEntrypoint = (entrypoint: CLIEntrypoint): CLIEntrypoint => entrypoint

/**
 * Build http entrypoint
 * @param entrypoint
 * @constructor
 */
export const BuildHTTPEntrypoint: (entrypoint: HTTPEntrypoint) => HTTPEntrypoint = (entrypoint: HTTPEntrypoint): HTTPEntrypoint => entrypoint

/**
 * Build service entrypoint
 * @param entrypoint
 * @constructor
 */
export const BuildServiceEntrypoint: (entrypoint: ServiceEntrypoint) => ServiceEntrypoint = (entrypoint: ServiceEntrypoint): ServiceEntrypoint => entrypoint

/**
 * Build entrypoints options for Entrypoint component
 * @param options
 * @constructor
 */
export const BuildEntrypoints: (options: EntrypointOptions) => EntrypointOptions = (options: EntrypointOptions): EntrypointOptions => options

type ActionContext = CLIContext | HTTPContext | ServiceContext

/**
 * A dispatchable action: its details, its information and its pipeline
 */
type ActionEntry = {
    details: ActionDetails
    info: BaseActionInfo
    run: InvocationRunner
}

/**
 * The key of an HTTP action
 * @param route
 * @param method
 */
function HTTPActionKey(route: string, method: string): string {
    return `${method}\u0000${route}`
}

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

    //The exact matches of the commands and the routes, the pattern managers match the glob patterns
    protected readonly CLIActions: Map<string, ActionEntry> = new Map()

    protected readonly HTTPActions: Map<string, ActionEntry> = new Map()

    protected readonly entrypointDestroyers: EntrypointDestroyer[] = []

    protected readonly httpActionInfoMap: Map<string, HTTPActionInfo> = new Map()

    protected readonly serviceActionInfoMap: Map<string, ServiceActionInfo> = new Map()

    protected readonly cliActionInfoMap: Map<string, CLIActionInfo> = new Map()

    protected readonly accessControl: IBaseObjectConstructor<AccessControl> = AccessControl

    /**
     * Controllers
     * @protected
     */
    @Configurable(DTO.Array(DTO.Class(Controller)).optional().default([]))
    protected readonly controllers: IBaseObjectConstructor<Controller>[]

    /**
     * Middlewares of all the actions
     * @protected
     */
    @Configurable(DTO.Array(DTO.Function()).optional().default([]))
    protected readonly middlewares: MiddlewareDefinition[]

    /**
     * Access control rules
     * @protected
     */
    @Configurable(DTO.Array(DTO.Class(AccessControlRule)).optional().default([]))
    protected readonly rules: IBaseObjectConstructor<AccessControlRule>[]

    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    protected readonly cliActionGroups: Record<string, string>

    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    protected readonly httpActionGroups: Record<string, string>

    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    protected readonly serviceActionGroups: Record<string, string>

    @Configurable()
    protected readonly cli?: CLIEntrypoint | CLIEntrypoint[]

    @Configurable()
    protected readonly http?: HTTPEntrypoint | HTTPEntrypoint[]

    @Configurable()
    protected readonly service?: ServiceEntrypoint | ServiceEntrypoint[]

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        ValidateMiddlewares(this.middlewares)
        await Promise.all(this.controllers.map((controllerConstructor: IBaseObjectConstructor<Controller>): Promise<void> => {
            BindControllerToComponent(this, controllerConstructor)
            return this.container.register(controllerConstructor)
        }))
        const middlewareClasses: Set<IBaseObjectConstructor<Middleware>> = new Set()
        const {CLI, HTTP, Service} = GetComponentControllerActionMap(this)
        this.collectActions('CLI', CLI, middlewareClasses, (details: ActionDetails, info: BaseActionInfo, entry: ActionEntry): void => {
            const cliInfo: CLIActionInfo = {...info, command: details.pattern.command}
            entry.info = cliInfo
            this.cliActionInfoMap.set(details.id, cliInfo)
            this.CLIActionPatternMap.set(details.pattern, details)
            this.CLIActionPatternManager.add(details.pattern, entry)
            this.CLIActions.set(details.pattern.command, entry)
        })
        this.collectActions('HTTP', HTTP, middlewareClasses, (details: ActionDetails, info: BaseActionInfo, entry: ActionEntry): void => {
            const httpInfo: HTTPActionInfo = {...info, route: details.pattern.route}
            entry.info = httpInfo
            this.httpActionInfoMap.set(details.id, httpInfo)
            this.HTTPActionPatternMap.set(details.pattern, details)
            this.HTTPActionPatternManager.add(details.pattern, entry)
            this.HTTPActions.set(HTTPActionKey(details.pattern.route, details.pattern.method), entry)
        })
        this.collectActions('Service', Service, middlewareClasses, (details: ActionDetails, info: BaseActionInfo, entry: ActionEntry): void => {
            const serviceInfo: ServiceActionInfo = {...info, pattern: details.pattern}
            entry.info = serviceInfo
            this.serviceActionInfoMap.set(details.id, serviceInfo)
            this.ServiceActionPatternMap.set(details.pattern, details)
            this.ServiceActionPatternManager.add(details.pattern, entry)
        })
        //The middleware classes are created in the container of each request
        await Promise.all([...middlewareClasses].map((middlewareClass: IBaseObjectConstructor<Middleware>): Promise<void> => this.container.register(middlewareClass)))
        this.register(this.service, (entrypoint: ServiceEntrypoint): void => this.registerServiceEntrypoint(entrypoint))
        this.register(this.cli, (entrypoint: CLIEntrypoint): void => this.registerCLIEntrypoint(entrypoint))
        this.register(this.http, (entrypoint: HTTPEntrypoint): void => this.registerHTTPEntrypoint(entrypoint))
        this.checkActions('CLI', this.cliActionInfoMap, this.cliActionGroups)
        this.checkActions('HTTP', this.httpActionInfoMap, this.httpActionGroups)
        this.checkActions('Service', this.serviceActionInfoMap, this.serviceActionGroups)
    }

    /**
     * Collect the actions of a transport, with their pipelines
     * @param type
     * @param actions
     * @param middlewareClasses
     * @param add
     * @protected
     */
    protected collectActions(type: 'CLI' | 'HTTP' | 'Service', actions: ActionPatternMap, middlewareClasses: Set<IBaseObjectConstructor<Middleware>>, add: (details: ActionDetails, info: BaseActionInfo, entry: ActionEntry) => void): void {
        actions.forEach((details: ActionDetails): void => {
            const info: BaseActionInfo = {
                id: details.id,
                acl: details.acl,
                name: details.name,
                description: details.description,
                groups: details.groups,
                controller: details.constructor.className,
                method: details.method.toString(),
                jsonSchema: details.jsonSchema
            }
            const middlewares: MiddlewareDefinition[] = [
                ...this.middlewares,
                ...GetClassMiddlewares(details.constructor),
                ...details.middlewares,
                ...GetMethodMiddlewares(details.constructor, As<string | symbol>(details.method))
            ]
            middlewares.filter(IsMiddlewareClass).forEach((middlewareClass: IBaseObjectConstructor<Middleware>): unknown => middlewareClasses.add(middlewareClass))
            const entry: ActionEntry = {
                details: details,
                info: info,
                run: ComposeMiddlewares(middlewares, (invocation: ActionInvocation): Promise<unknown> => this.runAction(details, invocation))
            }
            add(details, info, entry)
        })
    }

    /**
     * Check the action groups and names of a transport
     * @param type
     * @param actionInfoMap
     * @param actionGroups
     * @protected
     */
    protected checkActions(type: 'CLI' | 'HTTP' | 'Service', actionInfoMap: Map<string, BaseActionInfo>, actionGroups: Record<string, string>): void {
        const invalidGroupIds: string[] = this.findInvalidActionGroupIds(actionInfoMap, As(type.toLowerCase()))
        if (invalidGroupIds.length) throw new InvalidActionGroupException('Found {type} action groups are not defined in {option}: {groupIds}', {
            type: type,
            option: `${type === 'Service' ? 'service' : type.toLowerCase()}ActionGroups`,
            groupIds: invalidGroupIds
        })
        const duplicateNames: string[] = this.findDuplicateActionNames(actionInfoMap)
        if (duplicateNames.length) throw new DuplicateActionNameException('Duplicate {type} action names found: {names}', {
            type: type,
            names: duplicateNames
        })
    }

    protected get HTTP_ACTIONS(): HTTPActionInfo[] {
        return [...this.httpActionInfoMap.values()]
    }

    /**
     * Service action info getter
     * @constructor
     * @protected
     */
    protected get SERVICE_ACTIONS(): ServiceActionInfo[] {
        return [...this.serviceActionInfoMap.values()]
    }

    /**
     * Cli action info getter
     * @constructor
     * @protected
     */
    protected get CLI_ACTIONS(): CLIActionInfo[] {
        return [...this.cliActionInfoMap.values()]
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        await Promise.all(this.entrypointDestroyers.map((destroyer: EntrypointDestroyer) => new Promise((resolve, reject) => Promise.resolve(destroyer()).then(resolve).catch(reject))))
    }

    /**
     * Get entrypoint actions
     * @param type
     * @protected
     */
    protected getEntrypointActions<T extends BaseActionInfo>(type: 'http' | 'cli' | 'service'): EntrypointActions<T> {
        const groupMap: Map<string, ActionGroupInfo<T>> = new Map()
        let actionGroups: Record<string, string>
        let actions: T[]
        switch (type) {
            case 'http': {
                actions = As<T[]>(this.HTTP_ACTIONS)
                actionGroups = this.httpActionGroups
            }
                break
            case 'cli': {
                actions = As<T[]>(this.CLI_ACTIONS)
                actionGroups = this.cliActionGroups
            }
                break
            case 'service': {
                actions = As<T[]>(this.SERVICE_ACTIONS)
                actionGroups = this.serviceActionGroups
            }
                break
            default: {
                actions = []
                actionGroups = {}
            }
        }
        actions.forEach((action: T) => {
            action.groups.forEach((groupId: string) => {
                if (!groupMap.has(groupId)) groupMap.set(groupId, {
                    id: groupId,
                    name: actionGroups[groupId],
                    actions: []
                })
                groupMap.get(groupId)?.actions.push(action)
            })
        })
        return {
            groups: [...groupMap.values()],
            actions: actions
        }
    }

    /**
     * Find invalid action group ids
     * @param actionInfoMap
     * @param type
     * @protected
     */
    protected findInvalidActionGroupIds(actionInfoMap: Map<string, BaseActionInfo>, type: 'cli' | 'http' | 'service'): string[] {
        const actions: BaseActionInfo[] = [...actionInfoMap.values()]
        const notfoundGroupIdSet: Set<string> = new Set()
        actions.forEach((action: BaseActionInfo) => {
            action.groups.forEach((groupId: string) => {
                switch (type) {
                    case 'cli':
                        if (this.cliActionGroups[groupId] !== undefined) return
                        break
                    case 'http':
                        if (this.httpActionGroups[groupId] !== undefined) return
                        break
                    case 'service':
                        if (this.serviceActionGroups[groupId] !== undefined) return
                        break
                }
                notfoundGroupIdSet.add(groupId)
            })
        })
        return [...notfoundGroupIdSet]
    }

    /**
     * Find duplicate action names
     * @protected
     * @param actionInfoMap
     */
    protected findDuplicateActionNames(actionInfoMap: Map<string, BaseActionInfo>): string[] {
        const actionNames: string[] = [...actionInfoMap.values()].map((value: BaseActionInfo): string => value.name)
        const seen = new Set<string>()
        const duplicates = new Set<string>()
        actionNames.forEach((item: string) => seen.has(item) ? duplicates.add(item) : seen.add(item))
        return Array.from(duplicates)
    }

    /**
     * Run access control
     * @param rules
     * @param runtimeContainer
     * @param context
     * @param input
     * @param details
     * @protected
     */
    protected async runAccessControl(rules: IBaseObjectConstructor<AccessControlRule>[], runtimeContainer: Container, context: CLIContext | HTTPContext | ServiceContext, input: Record<string, any>, details: ActionDetails) {
        const [allowed, exception] = await this.accessControl.run(rules, runtimeContainer, context, input, details, (type: ContextType) => {
            switch (type) {
                case ContextType.HTTP:
                    return this.HTTP_ACTIONS
                case ContextType.SERVICE:
                    return this.SERVICE_ACTIONS
                case ContextType.CLI:
                    return this.CLI_ACTIONS
                default:
                    return []
            }
        })
        if (!allowed) throw exception
    }

    /**
     * Run controller's method and return its result (without AbortController)
     * @param details
     * @param context
     * @param dtoConstructor
     * @protected
     */
    /**
     * Run an action in the container of its request: create the controller, validate the input, check the access and call the action
     * @param details
     * @param invocation
     * @protected
     */
    protected async runAction(details: ActionDetails, invocation: ActionInvocation): Promise<unknown> {
        const {context, container} = invocation
        const controller: Controller = await container.get(details.constructor, {context: context})
        const input: Record<string, any> = structuredClone(await details.dtoConstructor.validateAsync(context.data))
        await this.runAccessControl(this.rules, container, context, input, details)
        return await controller.getMethod(As(details.method))(input)
    }

    /**
     * Dispatch a request to an action, in a new request container
     * @param entry
     * @param context
     * @param abortController
     * @protected
     */
    protected async dispatch(entry: ActionEntry, context: ActionContext, abortController?: AbortController): Promise<unknown> {
        //An already aborted request is not executed at all
        if (abortController?.signal.aborted) return
        const runtimeContainer: Container = this.createScope()
        let isAborted: boolean = false
        //Aborting destroys the request scope right away, container destruction is idempotent
        const abortHandler: () => void = (): void => {
            isAborted = true
            runtimeContainer.destroy().catch(DevNull)
        }
        abortController?.signal.addEventListener('abort', abortHandler, {once: true})
        try {
            const result: unknown = await entry.run({
                context: context,
                action: As(entry.info),
                container: runtimeContainer,
                signal: abortController?.signal
            })
            if (!isAborted) return result
        } catch (e) {
            if (!isAborted) throw e
        } finally {
            //The request scope is always destroyed once the dispatch ends, its destruction never rejects
            abortController?.signal.removeEventListener('abort', abortHandler)
            runtimeContainer.destroy().catch(DevNull)
        }
    }

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
            const entry: ActionEntry | null = this.CLIActions.get(context.command) ?? this.CLIActionPatternManager.find(actionPattern)
            if (!entry) throw new ControllerActionNotFoundException('Command not found')
            return await this.dispatch(entry, context, abortController)
        }, (destroyer: EntrypointDestroyer): number => this.entrypointDestroyers.push(destroyer))
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
            const entry: ActionEntry | null = this.HTTPActions.get(HTTPActionKey(context.route, context.method)) ?? this.HTTPActionPatternManager.find(actionPattern)
            if (!entry) throw new ControllerActionNotFoundException('Route \'{route}\' not found', context)
            return await this.dispatch(entry, context, abortController)
        }, (destroyer: EntrypointDestroyer): number => this.entrypointDestroyers.push(destroyer))
    }

    /**
     * Register service entrypoint
     * @param entrypoint
     * @protected
     */
    protected registerServiceEntrypoint(entrypoint: ServiceEntrypoint): void {
        return entrypoint(this.getModule(), async (context: ServiceContext, abortController?: AbortController) => {
            const entry: ActionEntry | null = this.ServiceActionPatternManager.find(context.input)
            if (!entry) throw new ControllerActionNotFoundException('Controller action not found')
            const details: ActionDetails = entry.details
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
            return await this.dispatch(entry, context, abortController)
        }, (destroyer: EntrypointDestroyer): number => this.entrypointDestroyers.push(destroyer))
    }

    /**
     * Get HTTP action groups
     */
    public getHttpActionGroups(): Record<string, string> {
        return this.httpActionGroups
    }

    /**
     * Get Service action groups
     */
    public getServiceActionGroups(): Record<string, string> {
        return this.serviceActionGroups
    }

    /**
     * Get CLI action groups
     */
    public getCliActionGroups(): Record<string, string> {
        return this.cliActionGroups
    }

    /**
     * Get entrypoint HTTP actions
     */
    public getHttpActions(): EntrypointActions<HTTPActionInfo> {
        return this.getEntrypointActions('http')
    }

    /**
     * Get entrypoint Service actions
     */
    public getServiceActions(): EntrypointActions<ServiceActionInfo> {
        return this.getEntrypointActions('service')
    }

    /**
     * Get entrypoint CLI actions
     */
    public getCliActions(): EntrypointActions<CLIActionInfo> {
        return this.getEntrypointActions('cli')
    }
}

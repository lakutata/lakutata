import {Component} from '../../lib/core/Component.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {CLIContext} from '../../lib/context/CLIContext.js'
import {HTTPContext} from '../../lib/context/HTTPContext.js'
import {ServiceContext} from '../../lib/context/ServiceContext.js'
import {ActionPattern} from '../../types/ActionPattern.js'
import {Module} from '../../lib/core/Module.js'
import {
    ActionDetails,
    ActionPatternMap,
    BindControllerToComponent,
    GetComponentControllerActionMap
} from '../../lib/base/internal/ControllerEntrypoint.js'
import {PatternManager} from '../../lib/base/internal/PatternManager.js'
import {Controller} from './lib/Controller.js'
import {As} from '../../lib/helpers/As.js'
import {ControllerActionNotFoundException} from './exceptions/ControllerActionNotFoundException.js'
import {JSONSchema} from '../../types/JSONSchema.js'
import {Container} from '../../lib/core/Container.js'
import {DestroyRuntimeContainerException} from '../../exceptions/DestroyRuntimeContainerException.js'
import {GetObjectPropertyPaths} from '../../lib/helpers/GetObjectPropertyPaths.js'
import unset from 'unset-value'
import {UniqueArray} from '../../lib/helpers/UniqueArray.js'
import {DTO} from '../../lib/core/DTO.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import type {IBaseObjectConstructor} from '../../interfaces/IBaseObjectConstructor.js'
import CloneDeep from 'lodash/cloneDeep.js'
import {DuplicateActionNameException} from './exceptions/DuplicateActionNameException.js'
import {AccessControl} from './lib/AccessControl.js'
import {ContextType} from '../../lib/base/Context.js'
import {AccessControlRule} from './lib/AccessControlRule.js'
import {InvalidActionGroupException} from './exceptions/InvalidActionGroupException.js'

export {ContextType, BaseContext} from '../../lib/base/Context.js'
export {CLIContext} from '../../lib/context/CLIContext.js'
export {HTTPContext} from '../../lib/context/HTTPContext.js'
export {ServiceContext} from '../../lib/context/ServiceContext.js'

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

    protected readonly httpActionInfoMap: Map<string, HTTPActionInfo> = new Map()

    protected readonly serviceActionInfoMap: Map<string, ServiceActionInfo> = new Map()

    protected readonly cliActionInfoMap: Map<string, CLIActionInfo> = new Map()

    protected readonly accessControl: IBaseObjectConstructor<AccessControl> = AccessControl

    @Configurable(DTO.Array(DTO.Class(Controller)).optional().default([]))
    protected readonly controllers: IBaseObjectConstructor<Controller>[]

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
        await Promise.all(this.controllers.map((controllerConstructor: IBaseObjectConstructor<Controller>): Promise<void> => {
            BindControllerToComponent(this, controllerConstructor)
            return new Promise<void>((resolve, reject) => this.container.register(controllerConstructor).then(resolve).catch(reject))
        }))
        const {CLI, HTTP, Service} = GetComponentControllerActionMap(this)
        CLI.forEach((details: ActionDetails, actionPattern: ActionPattern): void => {
            this.cliActionInfoMap.set(details.id, {
                id: details.id,
                command: details.pattern.command,
                acl: details.acl,
                name: details.name,
                groups: details.groups,
                controller: details.constructor.className,
                method: details.method.toString(),
                jsonSchema: details.jsonSchema
            })
            this.CLIActionPatternMap.set(actionPattern, details)
            this.CLIActionPatternManager.add(actionPattern, details)
        })
        HTTP.forEach((details: ActionDetails, actionPattern: ActionPattern): void => {
            this.httpActionInfoMap.set(details.id, {
                id: details.id,
                route: details.pattern.route,
                acl: details.acl,
                name: details.name,
                groups: details.groups,
                controller: details.constructor.className,
                method: details.method.toString(),
                jsonSchema: details.jsonSchema
            })
            this.HTTPActionPatternMap.set(actionPattern, details)
            this.HTTPActionPatternManager.add(actionPattern, details)
        })
        Service.forEach((details: ActionDetails, actionPattern: ActionPattern): void => {
            this.serviceActionInfoMap.set(details.id, {
                id: details.id,
                pattern: details.pattern,
                acl: details.acl,
                name: details.name,
                groups: details.groups,
                controller: details.constructor.className,
                method: details.method.toString(),
                jsonSchema: details.jsonSchema
            })
            this.ServiceActionPatternMap.set(actionPattern, details)
            this.ServiceActionPatternManager.add(actionPattern, details)
        })
        this.register(this.service, (entrypoint: ServiceEntrypoint): void => this.registerServiceEntrypoint(entrypoint))
        this.register(this.cli, (entrypoint: CLIEntrypoint): void => this.registerCLIEntrypoint(entrypoint))
        this.register(this.http, (entrypoint: HTTPEntrypoint): void => this.registerHTTPEntrypoint(entrypoint))
        const invalidCliActionGroupIds: string[] = this.findInvalidActionGroupIds(this.cliActionInfoMap, 'cli')
        if (invalidCliActionGroupIds.length) throw new InvalidActionGroupException('Found {type} action groups are not defined in cliActionGroups: {groupIds}', {
            type: 'CLI',
            groupIds: invalidCliActionGroupIds
        })
        const invalidHttpActionGroupIds: string[] = this.findInvalidActionGroupIds(this.httpActionInfoMap, 'http')
        if (invalidHttpActionGroupIds.length) throw new InvalidActionGroupException('Found {type} action groups are not defined in httpActionGroups: {groupIds}', {
            type: 'HTTP',
            groupIds: invalidHttpActionGroupIds
        })
        const invalidServiceActionGroupIds: string[] = this.findInvalidActionGroupIds(this.serviceActionInfoMap, 'service')
        if (invalidServiceActionGroupIds.length) throw new InvalidActionGroupException('Found {type} action groups are not defined in serviceActionGroups: {groupIds}', {
            type: 'Service',
            groupIds: invalidServiceActionGroupIds
        })
        const duplicateCliActionNames: string[] = this.findDuplicateActionNames(this.cliActionInfoMap)
        if (duplicateCliActionNames.length) throw new DuplicateActionNameException('Duplicate {type} action names found: {names}', {
            type: 'CLI',
            names: duplicateCliActionNames
        })
        const duplicateHttpActionNames: string[] = this.findDuplicateActionNames(this.httpActionInfoMap)
        if (duplicateHttpActionNames.length) throw new DuplicateActionNameException('Duplicate {type} action names found: {names}', {
            type: 'HTTP',
            names: duplicateHttpActionNames
        })
        const duplicateServiceActionNames: string[] = this.findDuplicateActionNames(this.serviceActionInfoMap)
        if (duplicateServiceActionNames.length) throw new DuplicateActionNameException('Duplicate {type} action names found: {names}', {
            type: 'Service',
            names: duplicateServiceActionNames
        })
    }

    /**
     * Http action info getter
     * @constructor
     * @protected
     */
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
     * Get HTTP actions
     */
    public getHttpActions(): HTTPActionInfo[] {
        return this.HTTP_ACTIONS
    }

    /**
     * Get Service actions
     */
    public getServiceActions(): ServiceActionInfo[] {
        return this.SERVICE_ACTIONS
    }

    /**
     * Get CLI actions
     */
    public getCliActions(): CLIActionInfo[] {
        return this.CLI_ACTIONS
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        await Promise.all(this.entrypointDestroyers.map((destroyer: EntrypointDestroyer) => new Promise((resolve, reject) => Promise.resolve(destroyer()).then(resolve).catch(reject))))
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
    protected async runControllerMethodWithoutAbortController<DTOConstructor extends typeof DTO = typeof DTO>(details: ActionDetails, context: CLIContext | HTTPContext | ServiceContext, dtoConstructor: DTOConstructor): Promise<unknown> {
        const runtimeContainer: Container = this.createScope()
        const controller: Controller = await runtimeContainer.get(details.constructor, {context: context})
        try {
            const input: Record<string, any> = CloneDeep(await dtoConstructor.validateAsync(context.data))
            await this.runAccessControl(this.rules, runtimeContainer, context, input, details)
            return await controller.getMethod(As(details.method))(input)
        } catch (e) {
            throw e
        } finally {
            runtimeContainer
                .destroy()
                .catch((error: Error): never => {
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
        const abortHandler: () => void = (): void => {
            isAborted = true
            runtimeContainer
                .destroy()
                .catch((error: Error): never => {
                    throw new DestroyRuntimeContainerException(error.message)
                })
        }
        abortController.signal.addEventListener('abort', abortHandler, {once: true})
        const runtimeContainer: Container = this.createScope()
        const controller: Controller = await runtimeContainer.get(details.constructor, {context: context})
        try {
            const input: Record<string, any> = CloneDeep(await dtoConstructor.validateAsync(context.data))
            await this.runAccessControl(this.rules, runtimeContainer, context, input, details)
            const runResult: any = await controller.getMethod(As(details.method))(input)
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
            const details: ActionDetails | null = this.HTTPActionPatternManager.find(actionPattern)
            if (!details) throw new ControllerActionNotFoundException('Route \'{route}\' not found', context)
            return await this.runControllerMethod(details, context, details.dtoConstructor, abortController)
        }, (destroyer: EntrypointDestroyer): number => this.entrypointDestroyers.push(destroyer))
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
        }, (destroyer: EntrypointDestroyer): number => this.entrypointDestroyers.push(destroyer))
    }
}

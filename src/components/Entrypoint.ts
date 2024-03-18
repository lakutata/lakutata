import {Component} from '../lib/core/Component.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {type CLIContext} from '../lib/context/CLIContext.js'
import {type HTTPContext} from '../lib/context/HTTPContext.js'
import {type ServiceContext} from '../lib/context/ServiceContext.js'
import {type ActionPattern} from '../types/ActionPattern.js'
import {type Module} from '../lib/core/Module.js'
import {
    type ActionDetails, type ActionPatternMap,
    GetModuleControllerActionMap
} from '../lib/base/internal/ControllerEntrypoint.js'
import {PatternManager} from '../lib/base/internal/PatternManager.js'
import {type Controller} from '../lib/core/Controller.js'
import {As} from '../lib/functions/As.js'
import {ControllerActionNotFoundException} from '../exceptions/ControllerActionNotFoundException.js'
import {type JSONSchema} from '../types/JSONSchema.js'

export type CLIEntrypoint = (module: Module, cliMap: CLIMap, handler: CLIEntrypointHandler) => void
export type HTTPEntrypoint = (module: Module, routeMap: HTTPRouteMap, handler: HTTPEntrypointHandler) => void
export type ServiceEntrypoint = (module: Module, handler: ServiceEntrypointHandler) => void

export type CLIMap = Map<string, JSONSchema>
export type HTTPRouteMap<HTTPMethods = string> = Map<string, Set<HTTPMethods>>

export type CLIEntrypointHandler<T = unknown> = (context: CLIContext) => Promise<T>
export type HTTPEntrypointHandler<T = unknown> = (context: HTTPContext) => Promise<T>
export type ServiceEntrypointHandler<T = unknown> = (context: ServiceContext) => Promise<T>

export const CLIEntrypointBuilder: (entrypoint: CLIEntrypoint) => CLIEntrypoint = (entrypoint: CLIEntrypoint) => entrypoint

export const HTTPEntrypointBuilder: (entrypoint: HTTPEntrypoint) => HTTPEntrypoint = (entrypoint: HTTPEntrypoint) => entrypoint

export const ServiceEntrypointBuilder: (entrypoint: ServiceEntrypoint) => ServiceEntrypoint = (entrypoint: ServiceEntrypoint) => entrypoint

export class Entrypoint extends Component {

    protected readonly CLIActionPatternMap: ActionPatternMap = new Map()

    protected readonly HTTPActionPatternMap: ActionPatternMap = new Map()

    protected readonly ServiceActionPatternMap: ActionPatternMap = new Map()

    protected readonly CLIActionPatternManager: PatternManager = new PatternManager()

    protected readonly HTTPActionPatternManager: PatternManager = new PatternManager()

    protected readonly ServiceActionPatternManager: PatternManager = new PatternManager()

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
        this.CLIActionPatternMap.forEach((details: ActionDetails, actionPattern: ActionPattern) => {
            //TODO 也许details可以将action的说明放在里边
            cliMap.set(actionPattern.command, details.extra)
        })
        return entrypoint(this.getModule(), cliMap, async (context: CLIContext) => {
            const actionPattern: ActionPattern = {
                command: context.command
            }
            const details: ActionDetails | null = this.CLIActionPatternManager.find(actionPattern)
            if (!details) throw new ControllerActionNotFoundException('Command not found')
            const controller: Controller = await this.createScope().get(details.constructor, {
                context: context
            })
            return await controller.getMethod(As(details.method))()//TODO 调用时需要传入参数
        })
    }

    /**
     * Register http entrypoint
     * @param entrypoint
     * @protected
     */
    protected registerHTTPEntrypoint(entrypoint: HTTPEntrypoint): void {
        const routeMap: HTTPRouteMap = new Map()
        this.HTTPActionPatternMap.forEach((details: ActionDetails, actionPattern: ActionPattern) => {
            //TODO 也许details可以将action的说明放在里边
            const methodsSet: Set<string> = routeMap.get(actionPattern.route) || new Set()
            methodsSet.add(actionPattern.method)
            routeMap.set(actionPattern.route, methodsSet)
        })
        return entrypoint(this.getModule(), routeMap, async (context: HTTPContext) => {
            const actionPattern: ActionPattern = {
                route: context.route,
                method: context.method
            }
            const details: ActionDetails | null = this.HTTPActionPatternManager.find(actionPattern)
            if (!details) throw new ControllerActionNotFoundException('Route \'{route}\' not found', context)
            const controller: Controller = await this.createScope().get(details.constructor, {
                context: context
            })
            return await controller.getMethod(As(details.method))()//TODO 调用时需要传入参数
        })
    }

    /**
     * Register service entrypoint
     * @param entrypoint
     * @protected
     */
    protected registerServiceEntrypoint(entrypoint: ServiceEntrypoint): void {
        return entrypoint(this.getModule(), async (context: ServiceContext) => {
            const details: ActionDetails | null = this.ServiceActionPatternManager.find(context.input)
            if (!details) throw new ControllerActionNotFoundException('Controller action not found')
            const controller: Controller = await this.createScope().get(details.constructor, {
                context: context
            })
            return await controller.getMethod(As(details.method))()//TODO 调用时需要传入参数
        })
    }
}

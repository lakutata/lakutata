import {Component} from '../lib/core/Component.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {CLIContext} from '../lib/context/CLIContext.js'
import {HTTPContext} from '../lib/context/HTTPContext.js'
import {ServiceContext} from '../lib/context/ServiceContext.js'
import {ActionPattern} from '../types/ActionPattern.js'
import {Module} from '../lib/core/Module.js'
import {
    ActionDetails,
    GetModuleControllerActionMap,
    TotalActionPatternMap
} from '../lib/base/internal/ControllerEntrypoint.js'
import {PatternManager} from '../lib/base/internal/PatternManager.js'
import {Controller} from '../lib/core/Controller.js'
import {As} from '../lib/functions/As.js'
import {ControllerActionNotFoundException} from '../exceptions/ControllerActionNotFoundException.js'

export type CLIEntrypoint = (module: Module, handler: (context: CLIContext) => Promise<unknown>) => void
export type HTTPEntrypoint = (module: Module, handler: (context: HTTPContext) => Promise<unknown>) => void
export type ServiceEntrypoint = (module: Module, handler: (context: ServiceContext) => Promise<unknown>) => void

export class Entrypoint extends Component {
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
        const totalActionPatternMap: TotalActionPatternMap = GetModuleControllerActionMap(this.getModule())
        totalActionPatternMap.CLI
            .forEach((details: ActionDetails, actionPattern: ActionPattern) => this.CLIActionPatternManager.add(actionPattern, details))
        totalActionPatternMap.HTTP
            .forEach((details: ActionDetails, actionPattern: ActionPattern) => this.HTTPActionPatternManager.add(actionPattern, details))
        totalActionPatternMap.Service
            .forEach((details: ActionDetails, actionPattern: ActionPattern) => this.ServiceActionPatternManager.add(actionPattern, details))
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
        //TODO
    }

    /**
     * Register http entrypoint
     * @param entrypoint
     * @protected
     */
    protected registerHTTPEntrypoint(entrypoint: HTTPEntrypoint): void {
        return entrypoint(this.getModule(), async (context: HTTPContext) => {
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
            const details: ActionDetails | null = this.HTTPActionPatternManager.find(context.input)
            if (!details) throw new ControllerActionNotFoundException('Controller action not found')
            const controller: Controller = await this.createScope().get(details.constructor, {
                context: context
            })
            return await controller.getMethod(As(details.method))()//TODO 调用时需要传入参数
        })
    }
}

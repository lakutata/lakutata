import {Component} from '../lib/core/Component.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {CLIContext} from '../lib/context/CLIContext.js'
import {HTTPContext} from '../lib/context/HTTPContext.js'
import {ServiceContext} from '../lib/context/ServiceContext.js'
import {ActionPattern} from '../types/ActionPattern.js'
import {Module} from '../lib/core/Module.js'
import {
    ActionHandler,
    GetModuleControllerActionMap,
    TotalActionPatternMap
} from '../lib/base/internal/ControllerEntrypoint.js'
import {PatternManager} from '../lib/base/internal/PatternManager.js'

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
            .forEach((handler: ActionHandler<CLIContext>, actionPattern: ActionPattern) => this.CLIActionPatternManager.add(actionPattern, handler))
        totalActionPatternMap.HTTP
            .forEach((handler: ActionHandler<HTTPContext>, actionPattern: ActionPattern) => this.HTTPActionPatternManager.add(actionPattern, handler))
        totalActionPatternMap.Service
            .forEach((handler: ActionHandler<ServiceContext>, actionPattern: ActionPattern) => this.ServiceActionPatternManager.add(actionPattern, handler))
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
            const handler: ActionHandler<HTTPContext> = this.HTTPActionPatternManager.find(actionPattern)
            return await handler(this.createScope(), context)
        })
    }

    /**
     * Register service entrypoint
     * @param entrypoint
     * @protected
     */
    protected registerServiceEntrypoint(entrypoint: ServiceEntrypoint): void {
        //TODO
    }
}
